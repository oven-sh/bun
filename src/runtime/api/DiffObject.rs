use core::ops::Range;
use std::borrow::Cow;

use bun_core::String;
use bun_core::strings::CodeUnits;
use bun_jsc::bindgen::{self, JsHeap, JsLocal, JsScope, to_js};
use bun_jsc::{
    ErrorCode, JSArray, JSArrayIterator, JSGlobalObject, JSMap, JSValue, JsResult,
    MarkedArgumentBuffer,
};
use bun_text_diff::patch;
use bun_text_diff::tokens::{Edit, Split, Unit, diff_ids, diff_text};

use crate::generated_bindgen::diff_object::{
    Change, FilePatch, Hunk, HunkToApply, HunksOptions, Options, PatchOptions, PatchToApply,
};

trait JsUnit: Unit {
    fn of(string: &String) -> Cow<'_, [Self]>;
}
impl JsUnit for u8 {
    fn of(string: &String) -> Cow<'_, [u8]> {
        Cow::Borrowed(string.latin1())
    }
}
impl JsUnit for u16 {
    fn of(string: &String) -> Cow<'_, [u16]> {
        if string.is_utf16() {
            Cow::Borrowed(string.utf16())
        } else {
            Cow::Owned(string.latin1().iter().map(|&unit| unit.into()).collect())
        }
    }
}

/// `$function::<u16>(..)` if any of `$strings` is UTF-16, and `$function::<u8>(..)` if none is.
macro_rules! by_width {
    ($strings:expr, $function:ident($($argument:expr),*)) => {
        if $strings.into_iter().any(String::is_utf16) {
            $function::<u16>($($argument),*)
        } else {
            $function::<u8>($($argument),*)
        }
    };
}

fn clone_units<T: Unit>(units: &[T]) -> String {
    match T::units(units) {
        CodeUnits::U8(latin1) => String::clone_latin1(latin1),
        CodeUnits::U16(utf16) => String::clone_utf16(utf16),
    }
}

fn limit<'a>(heap: &JsHeap<'a>, name: &str, value: f64) -> bindgen::Result<'a, usize> {
    if value >= 0.0 && value.trunc() == value {
        return Ok(value as usize);
    }
    Err(heap.error_with_code(
        ErrorCode::OUT_OF_RANGE,
        format_args!(
            "The value of \"options.{name}\" is out of range. It must be an integer >= 0 or Infinity. Received {}",
            bun_core::fmt::double(value)
        ),
    ))
}

fn max_edits<'a>(heap: &JsHeap<'a>, option: Option<f64>) -> bindgen::Result<'a, usize> {
    limit(heap, "maxEditLength", option.unwrap_or(f64::INFINITY))
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    Kept,
    Removed,
    Added,
}

/// `range` is in the old input if the run is removed, and in the new one if not.
struct Run {
    kind: Kind,
    range: Range<usize>,
    count: usize,
}

/// `kept_at_end` counts the tokens from the end of the last edit to `new_length`.
fn runs(
    edits: impl Iterator<Item = Edit>,
    new_length: usize,
    kept_at_end: impl FnOnce(usize) -> usize,
) -> Vec<Run> {
    let mut runs = Vec::new();
    let mut push = |kind, range: Range<usize>, count| {
        if count > 0 {
            runs.push(Run { kind, range, count });
        }
    };
    let (mut unit, mut token) = (0, 0);
    for Edit { units, tokens } in edits {
        push(Kind::Kept, unit..units.b_lo, tokens.b_lo - token);
        push(Kind::Removed, units.a_lo..units.a_hi, tokens.deleted());
        push(Kind::Added, units.b_lo..units.b_hi, tokens.inserted());
        (unit, token) = (units.b_hi, tokens.b_hi);
    }
    push(Kind::Kept, unit..new_length, kept_at_end(unit));
    runs
}

fn text_runs<T: JsUnit>(
    split: Split,
    old: &String,
    new: &String,
    max_edits: usize,
) -> Option<Vec<Run>> {
    let (a, b) = (T::of(old), T::of(new));
    let edits = diff_text(split, &a, &b, max_edits)?;
    let kept_at_end = |from| split.count(&b[from..]);
    Some(runs(edits.into_iter(), b.len(), kept_at_end))
}

fn changes<'a, 's>(
    heap: &JsHeap<'a>,
    split: Split,
    old: &'s String,
    new: &'s String,
    options: &Options,
) -> bindgen::Result<'a, Option<impl Iterator<Item = Change> + use<'s>>> {
    let max_edits = max_edits(heap, options.max_edit_length)?;
    let runs = by_width!([old, new], text_runs(split, old, new, max_edits));
    let change = move |Run { kind, range, count }| Change {
        value: if kind == Kind::Removed { old } else { new }.shared_substring(range),
        added: kind == Kind::Added,
        removed: kind == Kind::Removed,
        count,
    };
    Ok(runs.map(|runs| runs.into_iter().map(change)))
}

macro_rules! split_by {
    ($($name:ident: $split:expr;)*) => {$(
        pub(crate) fn $name<'a, 's>(
            heap: &JsHeap<'a>,
            old: &'s String,
            new: &'s String,
            options: &Options,
        ) -> bindgen::Result<'a, Option<impl Iterator<Item = Change> + use<'s>>> {
            changes(heap, $split, old, new, options)
        }
    )*};
}
split_by! {
    lines: Split::Lines;
    words: Split::Words;
    chars: Split::Chars;
}

/// Numbers values so that two have the same number if they are `===`.
struct ValueIds {
    map: JSValue,
    distinct: u32,
}

impl ValueIds {
    /// A copy of `array`, which a getter can change, and the number of each element.
    fn read(&mut self, global: &JSGlobalObject, array: JSValue) -> JsResult<(JSValue, Vec<u32>)> {
        let Some(map) = JSMap::from_js(self.map) else {
            return Err(global.throw_out_of_memory());
        };
        let map = JSMap::opaque_mut(map.as_ptr());
        let mut elements = JSArrayIterator::init(array, global)?;
        if elements.len > i32::MAX as u32 {
            return Err(global.throw_out_of_memory());
        }
        MarkedArgumentBuffer::new(|copy| {
            let mut ids = Vec::new();
            while let Some(element) = elements.next()? {
                copy.append(element);
                if copy.size() == ids.len() {
                    return Err(global.throw_out_of_memory());
                }
                // To a `Map`, NaN is the same as NaN.
                let is_nan = element.is_number() && element.as_number().is_nan();
                if !is_nan {
                    let known = map.get(global, element)?;
                    if known.is_number() {
                        ids.push(known.as_number() as u32);
                        continue;
                    }
                    map.set(global, element, JSValue::js_number(self.distinct.into()))?;
                }
                ids.push(self.distinct);
                self.distinct += 1;
            }
            Ok((copy.construct_array(global)?, ids))
        })
    }
}

pub(crate) fn arrays<'a>(
    cx: &mut JsScope<'a>,
    old: JsLocal<'a, JSArray>,
    new: JsLocal<'a, JSArray>,
    options: &Options,
) -> bindgen::Result<'a, Option<JsLocal<'a, JSArray>>> {
    let max_edits = max_edits(&cx.heap, options.max_edit_length)?;
    let global = cx.global();
    let mut ids = ValueIds {
        map: JSMap::create(global),
        distinct: 0,
    };
    let (old, a) = ids.read(global, old.to_js())?;
    let (new, b) = ids.read(global, new.to_js())?;
    ids.map.ensure_still_alive();

    let Some(hunks) = diff_ids(&a, &b, ids.distinct as usize, max_edits) else {
        return Ok(None);
    };
    let edits = hunks.into_iter().map(|hunk| Edit {
        units: hunk,
        tokens: hunk,
    });
    let runs = runs(edits, b.len(), |from| b.len() - from);
    let changes = cx.heap.create_array(runs, |heap, run| {
        let Run { kind, range, count } = run;
        let from = if kind == Kind::Removed { old } else { new };
        // SAFETY: each index of the copies is an own data property, so reading one runs no JavaScript.
        let global = unsafe { heap.global() };
        let value = heap.create_array(range, |heap, index| {
            to_js::any(heap, from.get_index(global, index as u32)?)
        })?;
        let members = [
            ("value", value.as_value()),
            ("added", to_js::bool(heap, kind == Kind::Added)?),
            ("removed", to_js::bool(heap, kind == Kind::Removed)?),
            ("count", to_js::usize(heap, count)?),
        ];
        to_js::record(heap, members, to_js::any)
    })?;
    old.ensure_still_alive();
    new.ensure_still_alive();
    Ok(Some(changes))
}

fn hunk_with<L>(hunk: patch::PatchHunk<L>, line: impl FnMut(L) -> String) -> Hunk {
    Hunk {
        old_start: hunk.old_start,
        old_lines: hunk.old_lines,
        new_start: hunk.new_start,
        new_lines: hunk.new_lines,
        lines: hunk.lines.into_iter().map(line).collect(),
    }
}

fn hunks_of<T: JsUnit>(
    old: &String,
    new: &String,
    context: usize,
    max_edits: usize,
) -> Option<Vec<Hunk>> {
    let (a, b) = (T::of(old), T::of(new));
    let edits = diff_text(Split::Lines, &a, &b, max_edits)?;
    let mut scratch = Vec::new();
    let hunks = patch::hunks(&a, &b, &edits, context).map(|hunk| {
        hunk_with(hunk, |line| {
            scratch.clear();
            line.write(&mut scratch);
            clone_units(&scratch)
        })
    });
    Some(hunks.collect())
}

pub(crate) fn hunks<'a>(
    heap: &JsHeap<'a>,
    old: &String,
    new: &String,
    options: &HunksOptions,
) -> bindgen::Result<'a, Option<Vec<Hunk>>> {
    let context = limit(heap, "context", options.context)?;
    let max_edits = max_edits(heap, options.max_edit_length)?;
    Ok(by_width!(
        [old, new],
        hunks_of(old, new, context, max_edits)
    ))
}

struct FileHeader<'a> {
    marker: &'static [u8],
    name: &'a [u8],
    header: &'a String,
}

fn format_patch<T: JsUnit>(
    old: &String,
    new: &String,
    headers: &[FileHeader<'_>],
    context: usize,
    max_edits: usize,
) -> Option<String> {
    let (a, b) = (T::of(old), T::of(new));
    let edits = diff_text(Split::Lines, &a, &b, max_edits)?;
    let mut out = Vec::new();
    // As `diff -u`: no differences, no output.
    if !edits.is_empty() {
        for file in headers {
            patch::write_file_header(&mut out, file.marker, file.name, &T::of(file.header));
        }
    }
    for hunk in patch::hunks(&a, &b, &edits, context) {
        patch::write_hunk(&mut out, &hunk);
    }
    Some(clone_units(&out))
}

fn has_line_break(string: &String) -> bool {
    (0..string.length()).any(|at| matches!(string.char_at(at), 0x0A | 0x0D))
}

pub(crate) fn create_patch<'a>(
    heap: &JsHeap<'a>,
    old: &String,
    new: &String,
    options: &PatchOptions<'_>,
) -> bindgen::Result<'a, Option<String>> {
    let context = limit(heap, "context", options.context)?;
    let max_edits = max_edits(heap, options.max_edit_length)?;
    let (old_name, new_name) = (options.old_file_name, options.new_file_name);
    let mut headers = Vec::new();
    for (marker, name, option, header) in [
        (
            b"--- ",
            old_name.or(new_name),
            "oldHeader",
            &options.old_header,
        ),
        (
            b"+++ ",
            new_name.or(old_name),
            "newHeader",
            &options.new_header,
        ),
    ] {
        let invalid = |reason: &str| {
            heap.error_with_code(
                ErrorCode::INVALID_ARG_VALUE,
                format_args!("The property 'options.{option}' {reason}"),
            )
        };
        if header.as_ref().is_some_and(has_line_break) {
            return Err(invalid("must not contain a line break"));
        }
        match (name, header) {
            (Some(name), header) => headers.push(FileHeader {
                marker,
                name,
                header: header.as_ref().unwrap_or(const { &String::EMPTY }),
            }),
            (None, Some(_)) => {
                return Err(invalid(
                    "requires 'options.oldFileName' or 'options.newFileName'",
                ));
            }
            (None, None) => {}
        }
    }
    let strings = headers.iter().map(|file| file.header).chain([old, new]);
    Ok(by_width!(
        strings,
        format_patch(old, new, &headers, context, max_edits)
    ))
}

fn parse<'a, T: Unit>(heap: &JsHeap<'a>, text: &[T]) -> bindgen::Result<'a, Vec<patch::FilePatch>> {
    patch::parse(text).map_err(|error| heap.syntax_error(format_args!("{error}")))
}

pub(crate) fn parse_patch<'a, 's>(
    heap: &JsHeap<'a>,
    text: &'s String,
) -> bindgen::Result<'a, impl Iterator<Item = FilePatch> + use<'s>> {
    let files = if text.is_utf16() {
        parse(heap, text.utf16())?
    } else {
        parse(heap, text.latin1())?
    };
    let name = |name: Option<patch::Name>| name.map(|name| String::clone_utf16(&name));
    let flag = |is_set: bool| is_set.then_some(true);
    let hunk = move |hunk| hunk_with(hunk, |line| text.shared_substring(line));
    Ok(files.into_iter().map(move |file| FilePatch {
        index: name(file.index),
        old_file_name: name(file.old_file_name),
        old_header: name(file.old_header),
        new_file_name: name(file.new_file_name),
        new_header: name(file.new_header),
        old_mode: name(file.old_mode),
        new_mode: name(file.new_mode),
        is_git: flag(file.is_git),
        is_rename: flag(file.is_rename),
        is_copy: flag(file.is_copy),
        is_create: flag(file.is_create),
        is_delete: flag(file.is_delete),
        is_binary: flag(file.is_binary),
        hunks: file.hunks.into_iter().map(hunk).collect(),
    }))
}

fn apply<'a, T: JsUnit>(
    heap: &JsHeap<'a>,
    source: &String,
    hunks: &[patch::HunkToApply<'_, T>],
) -> bindgen::Result<'a, Option<String>> {
    match patch::apply(&T::of(source), hunks) {
        Ok(patched) => Ok(patched.map(|patched| clone_units(&patched))),
        Err(patch::InvalidOperation { hunk, line }) => Err(heap.error_with_code(
            ErrorCode::INVALID_ARG_VALUE,
            format_args!(
                "The property 'patch[{hunk}].lines[{line}]' must start with \" \", \"-\", \"+\" or \"\\\""
            ),
        )),
    }
}

fn apply_text<'a, T: JsUnit>(
    heap: &JsHeap<'a>,
    source: &String,
    text: &String,
) -> bindgen::Result<'a, Option<String>> {
    let text = T::of(text);
    let files = parse(heap, &text)?;
    let [file] = &files[..] else {
        return Err(heap.error_with_code(
            ErrorCode::INVALID_ARG_VALUE,
            format_args!(
                "The argument 'patch' must change one file. Received a patch for {} files",
                files.len()
            ),
        ));
    };
    if file.is_binary {
        return Err(heap.error_with_code(
            ErrorCode::INVALID_ARG_VALUE,
            format_args!("The argument 'patch' must change a text file. Received a binary patch"),
        ));
    }
    let hunks = file.hunks.iter().map(|hunk| patch::HunkToApply {
        old_start: hunk.old_start as u32,
        lines: hunk.lines.iter().map(|line| &text[line.clone()]).collect(),
    });
    apply(heap, source, &hunks.collect::<Vec<_>>())
}

fn apply_hunks<'a, T: JsUnit>(
    heap: &JsHeap<'a>,
    source: &String,
    hunks: &[HunkToApply],
) -> bindgen::Result<'a, Option<String>> {
    let lines = hunks.iter().map(|hunk| hunk.lines.iter().map(T::of));
    let lines: Vec<Vec<Cow<'_, [T]>>> = lines.map(Iterator::collect).collect();
    let hunks = hunks.iter().zip(&lines);
    let hunks = hunks.map(|(hunk, lines)| patch::HunkToApply {
        old_start: hunk.old_start,
        lines: lines.iter().map(|line| &**line).collect(),
    });
    apply(heap, source, &hunks.collect::<Vec<_>>())
}

pub(crate) fn apply_patch<'a>(
    heap: &JsHeap<'a>,
    source: &String,
    patch: PatchToApply,
) -> bindgen::Result<'a, Option<String>> {
    match patch {
        PatchToApply::Text(text) => by_width!([source, &text], apply_text(heap, source, &text)),
        PatchToApply::Hunks(hunks) => {
            let strings = hunks.iter().flat_map(|hunk| &hunk.lines).chain([source]);
            by_width!(strings, apply_hunks(heap, source, &hunks))
        }
    }
}
