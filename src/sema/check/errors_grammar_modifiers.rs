//! `checkGrammarModifiers` (TypeScript 7.0.2, grammarchecks.go), on `node.Modifiers()` as the tree has it.

use super::errors::Diagnostic;
use super::*;
use crate::bind::Parent;

/// What `grammarErrorOnNode` is given: where the node is, the code of the message, and its arguments. `""`: no argument.
#[derive(Copy, Clone)]
pub(super) struct GrammarError {
    pub(super) start: u32,
    pub(super) code: u32,
    pub(super) args: [&'static str; 2],
}

const ACCESSIBILITY: Flags = Flags::PUBLIC.union(Flags::PRIVATE).union(Flags::PROTECTED);

/// `scanner.TokenToString(modifier.Kind)`
fn modifier_text(modifier: Flags) -> &'static str {
    const TEXTS: [(Flags, &str); 15] = [
        (Flags::ABSTRACT, "abstract"),
        (Flags::ACCESSOR, "accessor"),
        (Flags::ASYNC, "async"),
        (Flags::CONST, "const"),
        (Flags::AMBIENT, "declare"),
        (Flags::DEFAULT, "default"),
        (Flags::EXPORT, "export"),
        (Flags::IN, "in"),
        (Flags::OUT, "out"),
        (Flags::OVERRIDE, "override"),
        (Flags::PRIVATE, "private"),
        (Flags::PROTECTED, "protected"),
        (Flags::PUBLIC, "public"),
        (Flags::READONLY, "readonly"),
        (Flags::STATIC, "static"),
    ];
    TEXTS
        .iter()
        .find(|text| text.0 == modifier)
        .map_or("", |text| text.1)
}

impl Checker<'_> {
    /// `checkGrammarModifiers`, of every statement that has modifiers.
    pub(super) fn check_grammar_modifiers(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // `grammarErrorOnNode`
        if has_parse_diagnostics(hir) {
            return;
        }
        for (s, statement) in hir.stmts.iter().enumerate() {
            if statement.modifiers.is_empty() || matches!(bound.stmt_parent[s], Parent::None) {
                continue;
            }
            let error = self.grammar_error_in_modifiers(file, StmtId(s as u32));
            // `checkGrammarClassDeclarationHeritageClauses`, `checkInterfaceDeclaration`: `!c.checkGrammarModifiers(node) && ..`. The
            // front end reports the clauses.
            if error.is_some() {
                let members = match statement.kind {
                    StmtKind::Class(c) => hir[c].members,
                    StmtKind::Interface(i) => hir[i].members,
                    _ => Span::EMPTY,
                };
                let first_member = members.iter().next().map(|m| hir[m].start);
                let header = statement.start..first_member.unwrap_or(statement.loc.end);
                out.retain(|d| !matches!(d.code, 1097 | 1172..=1176) || !header.contains(&d.start));
            }
            // `checkImportDeclaration`, `checkExportDeclaration`, `checkExportAssignment`: these take none.
            let takes_none = match (statement.kind, bound.stmt_parent[s]) {
                (StmtKind::Import(_), Parent::File | Parent::Module(_)) => 1191,
                (
                    StmtKind::ExportNamed(_) | StmtKind::ExportStar { .. },
                    Parent::File | Parent::Module(_),
                ) => 1193,
                (StmtKind::ExportDefault(_) | StmtKind::ExportAssign(_), Parent::File) => 1120,
                (StmtKind::ExportDefault(_) | StmtKind::ExportAssign(_), Parent::Module(m))
                    if !matches!(hir[m].name, ModuleName::Ident(_)) =>
                {
                    1120
                }
                _ => 0,
            };
            let Some(error) = error.or((takes_none != 0).then_some(GrammarError {
                start: statement.start,
                code: takes_none,
                args: ["", ""],
            })) else {
                continue;
            };
            let GrammarError { start, code, args } = error;
            out.push(Diagnostic { start, code });
            let args = args.iter().filter(|arg| !arg.is_empty());
            self.note(start, 0, code, args.map(|&arg| arg.to_owned()).collect());
        }
    }

    /// What `checkGrammarModifiers(node)` reports of the statement `s`. The arms for members, parameters and type parameters are
    /// still `modifier_error` in js_parser/sema/type_syntax.rs.
    pub(super) fn grammar_error_in_modifiers(
        &self,
        file: FileId,
        s: StmtId,
    ) -> Option<GrammarError> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if s.is_none() || hir[s].modifiers.is_empty() {
            return None;
        }
        let Stmt {
            kind, modifiers, ..
        } = hir[s];
        let parent = bound.stmt_parent[s.idx()];
        // `node.Parent.Kind == KindModuleBlock || node.Parent.Kind == KindSourceFile`
        let is_module_element = matches!(parent, Parent::File | Parent::Module(_));
        let keywords =
            hir.modifier_list(modifiers)
                .iter()
                .filter_map(|modifier| match modifier.kind {
                    ModifierKind::Keyword(flag) => Some((flag, modifier.pos)),
                    ModifierKind::Decorator(_) => None,
                });
        // `container.Kind == KindModuleDeclaration && !IsAmbientModule(container)`
        let is_in_namespace =
            matches!(parent, Parent::Module(m) if matches!(hir[m].name, ModuleName::Ident(_)));
        // `reportObviousModifierErrors`, `findFirstIllegalModifier`: the only modifier that may come first.
        let allowed_first = match kind {
            // `checkGrammarModuleElementContext`: elsewhere these are given up on before their modifiers are looked at.
            StmtKind::Module(_)
            | StmtKind::Import(_)
            | StmtKind::ImportEquals(_)
            | StmtKind::ExportNamed(_)
            | StmtKind::ExportStar { .. }
                if is_module_element =>
            {
                None
            }
            // `checkExportAssignment`: so is one in a namespace.
            StmtKind::ExportDefault(_) | StmtKind::ExportAssign(_)
                if is_module_element && !is_in_namespace =>
            {
                None
            }
            StmtKind::Fn(_)
            | StmtKind::Class(_)
            | StmtKind::Enum(_)
            | StmtKind::Interface(_)
            | StmtKind::TypeAlias(_)
            | StmtKind::Var(_)
                if is_module_element =>
            {
                None
            }
            StmtKind::Fn(_) => Some(Flags::ASYNC),
            StmtKind::Class(_) => Some(Flags::ABSTRACT),
            StmtKind::Enum(_) => Some(Flags::CONST),
            StmtKind::Interface(_) | StmtKind::TypeAlias(_) | StmtKind::Var(_) => {
                Some(Flags::empty())
            }
            // The binder objects to those of `export as namespace N`. Nothing else has any.
            _ => return None,
        };
        // `reportObviousDecoratorErrors`. Those of a class are not in the list yet.
        let is_decorator =
            |modifier: &&Modifier| matches!(modifier.kind, ModifierKind::Decorator(_));
        if let Some(decorator) = hir.modifier_list(modifiers).iter().find(is_decorator) {
            return Some(GrammarError {
                start: decorator.pos,
                code: 1206,
                args: ["", ""],
            });
        }
        if let (Some(allowed), Some((first, start))) = (allowed_first, keywords.clone().next())
            && first != allowed
        {
            return Some(GrammarError {
                start,
                code: 1184,
                args: ["", ""],
            });
        }
        // `node.Flags&NodeFlagsAmbient`
        let is_ambient = match kind {
            StmtKind::Var(decls) => decls.iter().next().map_or(Flags::empty(), |d| hir[d].flags),
            StmtKind::Fn(f) => hir[f].flags,
            StmtKind::Class(c) => hir[c].flags,
            StmtKind::Enum(e) => hir[e].flags,
            StmtKind::ImportEquals(i) => hir[i].flags,
            _ => Flags::empty(),
        }
        .contains(Flags::AMBIENT);
        // `node.Parent.Flags&NodeFlagsAmbient`
        let is_parent_ambient = match parent {
            Parent::File => hir.kind == FileKind::Declaration,
            Parent::Module(m) => hir[m].flags.contains(Flags::AMBIENT),
            _ => false,
        };
        // `blockScopeKind`: the code for a modifier that a `using` or an `await using` declaration cannot have.
        let on_using = match kind {
            StmtKind::Var(decls) => match decls.iter().next().map(|d| hir[d].kind) {
                Some(VarKind::Using) => 1491,
                Some(VarKind::AwaitUsing) => 1495,
                _ => 0,
            },
            _ => 0,
        };
        let (mut seen, mut last_declare, mut last_async) = (Flags::empty(), 0, 0);
        for (modifier, start) in keywords {
            // `modifier.Flags&NodeFlagsReparsed == 0`
            let is_written = !modifier.contains(Flags::REPARSED);
            let modifier = modifier.difference(Flags::REPARSED);
            let text = modifier_text(modifier);
            let error =
                |code: u32, args: [&'static str; 2]| Some(GrammarError { start, code, args });
            // The first of `later` that has been seen: `modifier` must precede it.
            let follows = |later: &[Flags]| {
                later
                    .iter()
                    .find(|&&other| is_written && seen.contains(other))
                    .map(|&other| modifier_text(other))
            };
            if modifier == Flags::OVERRIDE {
                if seen.contains(Flags::OVERRIDE) {
                    return error(1030, [text, ""]);
                } else if seen.contains(Flags::AMBIENT) {
                    return error(1243, [text, "declare"]);
                } else if let Some(later) =
                    follows(&[Flags::READONLY, Flags::ACCESSOR, Flags::ASYNC])
                {
                    return error(1029, [text, later]);
                }
            } else if ACCESSIBILITY.contains(modifier) {
                if seen.intersects(ACCESSIBILITY) {
                    return error(1028, ["", ""]);
                } else if let Some(later) = follows(&[
                    Flags::OVERRIDE,
                    Flags::STATIC,
                    Flags::ACCESSOR,
                    Flags::READONLY,
                    Flags::ASYNC,
                ]) {
                    return error(1029, [text, later]);
                } else if is_module_element {
                    return error(1044, [text, ""]);
                } else if seen.contains(Flags::ABSTRACT) {
                    if modifier == Flags::PRIVATE {
                        return error(1243, [text, "abstract"]);
                    } else if is_written {
                        return error(1029, [text, "abstract"]);
                    }
                }
            } else if modifier == Flags::STATIC {
                if seen.contains(Flags::STATIC) {
                    return error(1030, [text, ""]);
                } else if let Some(later) =
                    follows(&[Flags::READONLY, Flags::ASYNC, Flags::ACCESSOR])
                {
                    return error(1029, [text, later]);
                } else if is_module_element {
                    return error(1044, [text, ""]);
                } else if seen.contains(Flags::ABSTRACT) {
                    return error(1243, [text, "abstract"]);
                } else if let Some(later) = follows(&[Flags::OVERRIDE]) {
                    return error(1029, [text, later]);
                }
            } else if modifier == Flags::ACCESSOR {
                if seen.contains(Flags::ACCESSOR) {
                    return error(1030, [text, ""]);
                } else if seen.contains(Flags::READONLY) {
                    return error(1243, [text, "readonly"]);
                } else if seen.contains(Flags::AMBIENT) {
                    return error(1243, [text, "declare"]);
                }
                return error(1275, ["", ""]);
            } else if modifier == Flags::READONLY {
                if seen.contains(Flags::READONLY) {
                    return error(1030, [text, ""]);
                }
                return error(1024, ["", ""]);
            } else if modifier == Flags::EXPORT {
                if self.files().options.verbatim_module_syntax
                    && !is_ambient
                    && !matches!(
                        kind,
                        StmtKind::TypeAlias(_) | StmtKind::Interface(_) | StmtKind::Module(_)
                    )
                    && parent == Parent::File
                    && self.xm_emits_commonjs(file)
                {
                    return error(1287, ["", ""]);
                }
                if seen.contains(Flags::EXPORT) {
                    return error(1030, [text, ""]);
                } else if let Some(later) =
                    follows(&[Flags::AMBIENT, Flags::ABSTRACT, Flags::ASYNC])
                {
                    return error(1029, [text, later]);
                } else if on_using != 0 {
                    return error(on_using, [text, ""]);
                }
            } else if modifier == Flags::DEFAULT {
                if is_in_namespace {
                    return error(1319, ["", ""]);
                } else if on_using != 0 {
                    return error(on_using, [text, ""]);
                } else if !seen.contains(Flags::EXPORT) && is_written {
                    return error(1029, ["export", text]);
                }
            } else if modifier == Flags::AMBIENT {
                if seen.contains(Flags::AMBIENT) {
                    return error(1030, [text, ""]);
                } else if seen.contains(Flags::ASYNC) {
                    return error(1040, ["async", ""]);
                } else if seen.contains(Flags::OVERRIDE) {
                    return error(1040, ["override", ""]);
                } else if on_using != 0 {
                    return error(on_using, [text, ""]);
                } else if is_parent_ambient && matches!(parent, Parent::Module(_)) {
                    return error(1038, ["", ""]);
                } else if seen.contains(Flags::ACCESSOR) {
                    return error(1243, [text, "accessor"]);
                }
                last_declare = start;
            } else if modifier == Flags::ABSTRACT {
                if seen.contains(Flags::ABSTRACT) {
                    return error(1030, [text, ""]);
                } else if !matches!(kind, StmtKind::Class(_)) {
                    return error(1242, ["", ""]);
                }
            } else if modifier == Flags::ASYNC {
                if seen.contains(Flags::ASYNC) {
                    return error(1030, [text, ""]);
                } else if seen.contains(Flags::AMBIENT) || is_parent_ambient {
                    return error(1040, [text, ""]);
                } else if seen.contains(Flags::ABSTRACT) {
                    return error(1243, [text, "abstract"]);
                }
                last_async = start;
            } else if modifier == Flags::IN || modifier == Flags::OUT {
                return error(1274, [text, ""]);
            }
            seen |= modifier;
        }
        if matches!(kind, StmtKind::Import(_) | StmtKind::ImportEquals(_))
            && seen.contains(Flags::AMBIENT)
        {
            return Some(GrammarError {
                start: last_declare,
                code: 1079,
                args: ["declare", ""],
            });
        }
        // `checkGrammarAsyncModifier`
        (seen.contains(Flags::ASYNC) && !matches!(kind, StmtKind::Fn(_))).then_some(GrammarError {
            start: last_async,
            code: 1042,
            args: ["async", ""],
        })
    }
}
