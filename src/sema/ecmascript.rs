//! What is no JavaScript, although TypeScript's parser reads it in a JavaScript file and
//! `checkJSSyntax` has nothing to say about it: its checker reports it. A tool that follows acorn
//! or Babel does not run the checker, and takes a file without a syntax error for JavaScript.

use crate::hir::*;

/// The modifiers that are JavaScript's (`ModifierFlagsJavaScript`). `checkJSSyntax` reports the others.
const JAVASCRIPT: Flags = Flags::EXPORT
    .union(Flags::STATIC)
    .union(Flags::ACCESSOR)
    .union(Flags::ASYNC)
    .union(Flags::DEFAULT);

/// The first of `modifiers` that acorn and Babel do not take for a modifier of something that can
/// have those in `allowed`: another one, one for the second time, `static` after another.
fn misplaced(modifiers: &[Modifier], allowed: Flags) -> Option<(u32, Flags)> {
    let mut seen = Flags::empty();
    for modifier in modifiers {
        let ModifierKind::Keyword(flag) = modifier.kind else {
            continue;
        };
        if !JAVASCRIPT.intersects(flag) {
            continue;
        }
        if !allowed.contains(flag)
            || seen.contains(flag)
            || flag == Flags::STATIC && !seen.is_empty()
        {
            return Some((modifier.pos, flag));
        }
        seen |= flag;
    }
    None
}

/// `checkGrammarModifiers` for the members of classes and of object literals, as far as it is
/// about the modifiers of JavaScript: `class A { async a }`, `({ static a: 1 })`.
pub fn report_misplaced_modifiers(file: &mut FileBuilder) {
    let mut found = Vec::new();
    for member in file.members.iter().filter(|it| !it.modifiers.is_empty()) {
        let allowed = match member.kind {
            // `static async constructor() {}` is a method.
            MemberKind::Method | MemberKind::Constructor => Flags::STATIC | Flags::ASYNC,
            MemberKind::Property => Flags::STATIC | Flags::ACCESSOR,
            MemberKind::Getter | MemberKind::Setter => Flags::STATIC,
            MemberKind::StaticBlock => Flags::empty(),
            _ => continue,
        };
        let modifiers = file.modifier_list(member.modifiers);
        found.extend(misplaced(modifiers, allowed));
        if member.kind == MemberKind::StaticBlock {
            let is_decorator = |it: &&Modifier| matches!(it.kind, ModifierKind::Decorator(_));
            let decorator = modifiers.iter().find(is_decorator);
            found.extend(decorator.map(|it| (it.pos, Flags::empty())));
        }
    }
    for &(prop, modifiers) in file.modifiers_of_props.iter() {
        let allowed = match file[prop].kind {
            PropKind::Method => Flags::ASYNC,
            _ => Flags::empty(),
        };
        found.extend(misplaced(file.modifier_list(modifiers), allowed));
    }
    for (pos, flag) in found {
        let (code, text) = match flag.is_empty() {
            // "Decorators are not valid here."
            true => (1206, ""),
            false => (1042, modifier_text(flag)),
        };
        let args: &[&[u8]] = &[text.as_bytes()];
        let args = if text.is_empty() { &[] } else { args };
        file.diagnostics
            .push(Diagnostic::new(DiagnosticKind::Js, (pos, 0), code, args));
    }
}
