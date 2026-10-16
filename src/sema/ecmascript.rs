//! What is no JavaScript, although TypeScript's parser reads it in a JavaScript file and
//! `checkJSSyntax` has nothing to say about it: its checker reports it. A tool that follows acorn
//! or Babel does not run the checker, and takes a file without a syntax error for JavaScript.

use crate::atom::known;
use crate::hir::*;
use bun_core::strings;

/// The modifiers that are JavaScript's (`ModifierFlagsJavaScript`). `checkJSSyntax` reports the others.
const JAVASCRIPT: Flags = Flags::EXPORT
    .union(Flags::STATIC)
    .union(Flags::ACCESSOR)
    .union(Flags::ASYNC)
    .union(Flags::DEFAULT);

/// The first of `modifiers` that acorn and Babel do not take for a modifier of something that can
/// have those in `allowed`: another one, one for the second time, `static` after another. Only
/// those in `looked_at` count.
fn misplaced(modifiers: &[Modifier], allowed: Flags, looked_at: Flags) -> Option<Found> {
    let mut seen = Flags::empty();
    for modifier in modifiers {
        let ModifierKind::Keyword(flag) = modifier.kind else {
            continue;
        };
        if !looked_at.intersects(flag) {
            continue;
        }
        if !allowed.contains(flag)
            || seen.contains(flag)
            || flag == Flags::STATIC && !seen.is_empty()
        {
            return Some((modifier.pos, 1042, modifier_text(flag)));
        }
        seen |= flag;
    }
    None
}

/// The position, the code and the argument of an error.
type Found = (u32, u32, &'static str);

/// Where the first `sign` from `from` on is. It follows a name that starts or ends there.
fn position_of(sign: u8, text: &[u8], from: u32) -> u32 {
    let rest = text.get(from as usize..).unwrap_or_default();
    from + strings::index_of_char(rest, sign).unwrap_or(0)
}

/// The errors of the checker's `checkGrammar..` about syntax that only TypeScript has, in the file
/// `file` with the text `text`:
/// - a modifier of JavaScript where it cannot be: `class A { async a }`, `({ static a: 1 })`,
///   `export export class A {}`, and any modifier of a property of an object literal
/// - `!` after the name of a variable or of a property of a class
/// - `?` after the name of an accessor or a constructor, `?` and `!` in an object literal
/// - a parameter `this`
/// - `declare module "a"`, `declare global`, `export as namespace a`
pub fn report_syntax_of_typescript(file: &mut FileBuilder, text: &[u8]) {
    let mut found: Vec<Found> = Vec::new();
    for stmt in file.stmts.iter() {
        match stmt.kind {
            StmtKind::Module(module) if !matches!(file[module].name, ModuleName::Ident(_)) => {
                found.push((stmt.start, 8006, "module"));
            }
            StmtKind::ExportAsNamespace(_) => {
                found.push((stmt.start, 8006, "export as namespace"));
            }
            _ if stmt.modifiers.is_empty() => {}
            _ => {
                let modifiers = file.modifier_list(stmt.modifiers);
                found.extend(misplaced(modifiers, JAVASCRIPT, JAVASCRIPT));
            }
        }
    }
    for declaration in file.var_decls.iter() {
        if declaration.flags.contains(Flags::DEFINITE) {
            let name_end = file[declaration.pat].end;
            found.push((position_of(b'!', text, name_end), 1255, ""));
        }
    }
    for param in file.params.iter() {
        let name = file[param.pat];
        if matches!(name.kind, PatKind::Ident(known::this)) {
            found.push((name.pos, 1003, ""));
        }
    }
    for member in file.members.iter() {
        let allowed = match member.kind {
            // `static async constructor() {}` is a method.
            MemberKind::Method | MemberKind::Constructor => Flags::STATIC | Flags::ASYNC,
            MemberKind::Property => Flags::STATIC | Flags::ACCESSOR,
            MemberKind::Getter | MemberKind::Setter => Flags::STATIC,
            MemberKind::StaticBlock => Flags::empty(),
            _ => continue,
        };
        if member.flags.contains(Flags::DEFINITE) {
            found.push((position_of(b'!', text, member.name_pos), 1255, ""));
        }
        // `checkJSSyntax` reports that of a property and of a method.
        if member.flags.contains(Flags::OPTIONAL)
            && !matches!(member.kind, MemberKind::Property | MemberKind::Method)
        {
            found.push((position_of(b'?', text, member.name_pos), 8009, "?"));
        }
        let modifiers = file.modifier_list(member.modifiers);
        found.extend(misplaced(modifiers, allowed, JAVASCRIPT));
        if member.kind == MemberKind::StaticBlock {
            let is_decorator = |it: &&Modifier| matches!(it.kind, ModifierKind::Decorator(_));
            let decorator = modifiers.iter().find(is_decorator);
            found.extend(decorator.map(|it| (it.pos, 1206, "")));
        }
    }
    for prop in file.props.iter().filter(|it| it.postfix_token != 0) {
        match text.get(prop.postfix_token as usize) {
            Some(b'!') => found.push((prop.postfix_token, 1255, "")),
            // `checkJSSyntax` reports that of a method.
            _ if prop.kind == PropKind::Method => {}
            _ => found.push((prop.postfix_token, 1162, "")),
        }
    }
    for &(prop, modifiers) in file.modifiers_of_props.iter() {
        // `checkJSSyntax` looks at the modifiers of a method only.
        let (allowed, looked_at) = match file[prop].kind {
            PropKind::Method => (Flags::ASYNC, JAVASCRIPT),
            _ => (Flags::empty(), Flags::all()),
        };
        let modifiers = file.modifier_list(modifiers);
        found.extend(misplaced(modifiers, allowed, looked_at));
    }
    for (pos, code, argument) in found {
        let arguments: &[&[u8]] = &[argument.as_bytes()];
        let arguments = if argument.is_empty() { &[] } else { arguments };
        let at = (pos, 0);
        file.diagnostics
            .push(Diagnostic::new(DiagnosticKind::Js, at, code, arguments));
    }
}
