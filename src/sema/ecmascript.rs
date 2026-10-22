//! Syntax that isn't JavaScript, even though TypeScript's parser accepts it in a JavaScript file and `checkJSSyntax`
//! doesn't report it. TypeScript's checker reports it instead. A tool that follows acorn or Babel doesn't run the
//! checker, and treats a file without a syntax error as JavaScript.

use crate::atom::known;
use crate::hir::*;
use bun_core::strings;

/// JavaScript's own modifiers (`ModifierFlagsJavaScript`). `checkJSSyntax` reports the others.
const JAVASCRIPT_MODIFIERS: Flags = Flags::EXPORT
    .union(Flags::STATIC)
    .union(Flags::ACCESSOR)
    .union(Flags::ASYNC)
    .union(Flags::DEFAULT);

/// Returns the first of `modifiers` that acorn and Babel reject on something that can have the modifiers in `allowed`:
/// one that isn't allowed, a repeated one, or `static` after another modifier. Only the modifiers in `relevant` are
/// considered.
fn misplaced(modifiers: &[Modifier], allowed: Flags, relevant: Flags) -> Option<Found> {
    let mut seen = Flags::empty();
    for modifier in modifiers {
        let ModifierKind::Keyword(flag) = modifier.kind else {
            continue;
        };
        if !relevant.intersects(flag) {
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

/// An error's position, code and argument.
type Found = (u32, u32, &'static str);

/// Returns the position of the first `sign` at or after `from`. It follows a name that starts or ends there.
fn position_of(sign: u8, text: &[u8], from: u32) -> u32 {
    let rest = text.get(from as usize..).unwrap_or_default();
    from + strings::index_of_char(rest, sign).unwrap_or(0)
}

/// Reports the errors of the checker's `checkGrammar..` functions about TypeScript-only syntax in `file`, whose text is
/// `text`:
/// - a JavaScript modifier where it isn't allowed: `class A { async a }`, `({ static a: 1 })`, `export export class A
///   {}`, and any modifier on a property of an object literal
/// - `!` after the name of a variable or a class property
/// - `?` after the name of an accessor or a constructor, `?` and `!` in an object literal
/// - a `this` parameter
/// - `declare module "a"`, `declare global`, `export as namespace a`
pub fn report_typescript_only_syntax(file: &mut FileBuilder, text: &[u8]) {
    let mut found: Vec<Found> = Vec::new();
    for (stmt, id) in file.stmts.iter().zip(0..) {
        let modifier_span = file.stmt_modifiers(StmtId(id));
        match stmt.kind {
            StmtKind::Module(module) if !matches!(file[module].name, ModuleName::Ident(_)) => {
                found.push((stmt.start, 8006, "module"));
            }
            StmtKind::ExportAsNamespace(_) => {
                found.push((stmt.start, 8006, "export as namespace"));
            }
            _ if modifier_span.is_empty() => {}
            _ => {
                let modifiers = file.modifier_list(modifier_span);
                found.extend(misplaced(
                    modifiers,
                    JAVASCRIPT_MODIFIERS,
                    JAVASCRIPT_MODIFIERS,
                ));
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
        // `checkJSSyntax` reports the `?` of a property and of a method.
        if member.flags.contains(Flags::OPTIONAL)
            && !matches!(member.kind, MemberKind::Property | MemberKind::Method)
        {
            found.push((position_of(b'?', text, member.name_pos), 8009, "?"));
        }
        let modifiers = file.modifier_list(member.modifiers);
        found.extend(misplaced(modifiers, allowed, JAVASCRIPT_MODIFIERS));
        if member.kind == MemberKind::StaticBlock {
            let is_decorator = |it: &&Modifier| matches!(it.kind, ModifierKind::Decorator(_));
            let decorator = modifiers.iter().find(is_decorator);
            found.extend(decorator.map(|it| (it.pos, 1206, "")));
        }
    }
    for prop in file.props.iter().filter(|it| it.postfix_token != 0) {
        match text.get(prop.postfix_token as usize) {
            Some(b'!') => found.push((prop.postfix_token, 1255, "")),
            // `checkJSSyntax` reports the `?` of a method.
            _ if prop.kind == PropKind::Method => {}
            _ => found.push((prop.postfix_token, 1162, "")),
        }
    }
    for &(prop, modifiers) in file.modifiers_of_props.iter() {
        // `checkJSSyntax` only looks at the modifiers of a method.
        let (allowed, relevant) = match file[prop].kind {
            PropKind::Method => (Flags::ASYNC, JAVASCRIPT_MODIFIERS),
            _ => (Flags::empty(), Flags::all()),
        };
        let modifiers = file.modifier_list(modifiers);
        found.extend(misplaced(modifiers, allowed, relevant));
    }
    for (pos, code, argument) in found {
        let arguments: &[&[u8]] = &[argument.as_bytes()];
        let arguments = if argument.is_empty() { &[] } else { arguments };
        let at = (pos, 0);
        file.diagnostics
            .push(Diagnostic::new(DiagnosticKind::Js, at, code, arguments));
    }
}
