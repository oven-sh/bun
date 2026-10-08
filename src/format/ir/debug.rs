//! Writes a document the way Prettier's `printDocToDebug` does, to compare the two by eye.

use super::element::{DedentMode, FormatElement, Interned, LineMode, PrintMode, Tag};
use super::formatter::Storage;
use std::fmt::Write;

pub(crate) fn dump(root: Interned, storage: &Storage, source: &[u8]) -> String {
    let mut out = String::new();
    dump_range(root, storage, source, 0, &mut out);
    out
}

fn dump_range(
    range: Interned,
    storage: &Storage,
    source: &[u8],
    mut depth: usize,
    out: &mut String,
) {
    let mut elements = storage.interned(range).iter();
    while let Some(element) = elements.next() {
        if let FormatElement::Skip(it) = element {
            if it.len > 0 {
                elements.nth(it.len as usize - 1);
            }
            continue;
        }
        if element.is_end_tag() {
            depth = depth.saturating_sub(1);
        }
        let _ = write!(out, "{:width$}", "", width = depth * 2);
        let text = |bytes: &[u8]| format!("{:?}", bstr::BStr::new(bytes));
        let _ = match element {
            FormatElement::Nop | FormatElement::Skip(_) => writeln!(out, "nop"),
            FormatElement::Cursor(_) => writeln!(out, "cursor"),
            FormatElement::Space => writeln!(out, "\" \""),
            FormatElement::Line(LineMode::Soft) => writeln!(out, "softline"),
            FormatElement::Line(LineMode::SoftOrSpace) => writeln!(out, "line"),
            FormatElement::Line(LineMode::Hard) => writeln!(out, "hardline"),
            FormatElement::Line(LineMode::Empty) => writeln!(out, "emptyline"),
            FormatElement::Line(LineMode::SoftOrSpaceEmpty) => writeln!(out, "line softline"),
            FormatElement::Line(LineMode::SoftEmpty) => writeln!(out, "softline softline"),
            FormatElement::ExpandParent => writeln!(out, "breakParent"),
            FormatElement::IndentedLineGroup(id) => writeln!(out, "group(id: {id:?} indent(line))"),
            FormatElement::LineSuffixBoundary => writeln!(out, "lineSuffixBoundary"),
            FormatElement::Token(token) => writeln!(out, "{}", text(token.as_bytes())),
            FormatElement::TokenIfBreaks(token) => {
                writeln!(out, "ifBreak({})", text(token.as_bytes()))
            }
            FormatElement::SourceText(it) => {
                writeln!(out, "{}", text(source.get(it.range()).unwrap_or_default()))
            }
            FormatElement::OwnedText(it) => {
                writeln!(
                    out,
                    "{}",
                    text(storage.text.get(it.range()).unwrap_or_default())
                )
            }
            FormatElement::Interned(interned) => {
                let _ = writeln!(out, "interned@{} [", interned.start);
                dump_range(*interned, storage, source, depth + 1, out);
                writeln!(out, "{:width$}]", "", width = depth * 2)
            }
            FormatElement::BestFitting(best_fitting) => {
                let _ = writeln!(out, "conditionalGroup([");
                for &variant in storage.variants(*best_fitting) {
                    dump_range(variant, storage, source, depth + 1, out);
                    let _ = writeln!(out, "{:width$},", "", width = depth * 2 + 2);
                }
                writeln!(out, "{:width$}])", "", width = depth * 2)
            }
            FormatElement::Tag(tag) => match tag {
                Tag::StartGroup(group) => {
                    let _ = write!(out, "group(");
                    if let Some(id) = group.id() {
                        let _ = write!(out, "id: {id:?} ");
                    }
                    if !group.mode().is_flat() {
                        let _ = write!(out, "shouldBreak: {:?}", group.mode());
                    }
                    writeln!(out)
                }
                Tag::StartIndent => writeln!(out, "indent("),
                Tag::StartIndentWithLine(mode) => writeln!(out, "indent({mode:?}"),
                Tag::EndIndentWithLine(mode) => writeln!(out, ") {mode:?}"),
                Tag::StartAlign(align) => writeln!(out, "align({},", align.count()),
                Tag::StartDedent(DedentMode::Level) => writeln!(out, "dedent("),
                Tag::StartDedent(DedentMode::Root) => writeln!(out, "dedentToRoot("),
                Tag::StartConditionalContent(condition) => {
                    let name = match condition.mode {
                        PrintMode::Expanded => "ifBreak(",
                        PrintMode::Flat => "ifFlat(",
                    };
                    match condition.group_id {
                        Some(id) => writeln!(out, "{name}groupId: {id:?}"),
                        None => writeln!(out, "{name}"),
                    }
                }
                Tag::StartIndentIfGroupBreaks(id) => writeln!(out, "indentIfBreak(groupId: {id:?}"),
                Tag::StartFill => writeln!(out, "fill("),
                Tag::StartEntry => writeln!(out, "entry("),
                Tag::StartLineSuffix => writeln!(out, "lineSuffix("),
                Tag::StartLabelled(label) => writeln!(out, "label({label:?},"),
                _ => writeln!(out, ")"),
            },
        };
        if element.is_start_tag() {
            depth += 1;
        }
    }
}
