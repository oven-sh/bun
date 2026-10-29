use crate::bind::Parent;
use crate::check::errors_declaration_emit::is_reserved_word;
use crate::check::spans::{line_end, skip_trivia};
use crate::check::*;
use smallvec::SmallVec;

impl Checker<'_, '_> {
    /// TypeScript's own syntax in places where `bun run` reports a syntax error.
    pub(super) fn check_typescript_syntax_early_errors(&mut self, file: FileId) {
        if self.hir(file).is_js {
            return;
        }
        self.check_parameter_early_errors(file);
        self.check_enum_member_early_errors(file);
        self.check_this_container_early_errors(file);
    }

    /// `export { if }`, `export { "a" }`: without `from` the name on the left is a reference.
    pub(super) fn check_local_export_names(&mut self, file: FileId) {
        let hir = self.hir(file);
        for export in hir.exports.iter() {
            for item in export.items.iter() {
                let spec = &hir[item];
                let end = self.end_of_name_at(file, spec.local_pos);
                let name = (hir.text).get(spec.local_pos as usize..end as usize);
                let is_reference = name.is_some_and(|name| {
                    !name.starts_with(b"\"") && !name.starts_with(b"'") && !is_reserved_word(name)
                });
                if !is_reference && !export.has_module_specifier {
                    self.early_grammar_error_at((file, spec.local_pos, end), 1003, &[]);
                }
                for position in [spec.local_pos, spec.pos] {
                    if hir.text.get(position as usize) == Some(&b'#') {
                        self.early_grammar_error_at((file, position, 0), 1003, &[]);
                    }
                }
            }
        }
    }

    fn check_parameter_early_errors(&mut self, file: FileId) {
        let hir = self.hir(file);
        for function in hir.fns.iter().filter(|it| has_body_node(it)) {
            let this_parameter = function.this_param.some();
            if function.kind == FnKind::Setter
                && function.params.is_empty()
                && let Some(this) = this_parameter
            {
                self.early_grammar_error_on_node(file, this, 1049, &[]);
            }
            let kind = match function.flags.contains(Flags::STATIC) {
                true if function.kind == FnKind::Constructor => FnKind::Method,
                _ => function.kind,
            };
            for p in this_parameter.into_iter().chain(function.params.iter()) {
                self.check_parameter_syntax(file, kind, p);
            }
            // Only a first parameter of that name is a type.
            for p in function.params.iter() {
                if matches!(hir[hir[p].pat].kind, PatKind::Ident(known::this))
                    && kind != FnKind::Arrow
                {
                    self.early_grammar_error_on_node(file, p, 2680, &[Arg::Atom(known::this)]);
                }
            }
        }
    }

    fn check_parameter_syntax(&mut self, file: FileId, function: FnKind, p: ParamId) {
        let hir = self.hir(file);
        let parameter = &hir[p];
        let name = hir[parameter.pat].kind;
        if function == FnKind::Arrow && matches!(name, PatKind::Ident(known::this)) {
            self.early_grammar_error_on_node(file, p, 2730, &[]);
            return;
        }
        if hir.param_modifiers(p).is_empty() {
            return;
        }
        if self.check_grammar_modifiers(file, p)
            || !parameter.flags.contains(Flags::PARAMETER_PROPERTY)
        {
            return;
        }
        let code = match name {
            _ if function != FnKind::Constructor => 2369,
            _ if parameter.flags.contains(Flags::REST) => 1317,
            PatKind::Object(_) | PatKind::Array(_) => 1187,
            PatKind::Ident(known::constructor) => 2398,
            PatKind::Ident(_) | PatKind::Missing => return,
        };
        self.early_grammar_error_on_node(file, p, code, &[]);
    }

    fn check_enum_member_early_errors(&mut self, file: FileId) {
        let hir = self.hir(file);
        for declaration in hir.enums.iter() {
            if hir.is_ambient(hir.node(declaration.stmt)) {
                continue;
            }
            let mut names: SmallVec<[Atom; 16]> = SmallVec::new();
            for member in declaration.members.iter().map(|member| &hir[member]) {
                let first = hir.text.get(member.pos as usize).copied();
                let code = match first {
                    Some(b'[') => 1164,
                    Some(b'#') => 18024,
                    Some(b'0'..=b'9' | b'.') => 2452,
                    _ if names.contains(&member.name) => 2300,
                    _ => {
                        names.push(member.name);
                        continue;
                    }
                };
                let at = (file, member.pos, self.end_of_name_at(file, member.pos));
                let name = [Arg::Atom(member.name)];
                self.early_grammar_error_at(at, code, if code == 2300 { &name } else { &[] });
            }
        }
    }

    /// `this` right in the body of a namespace or in the initializer of an enum member.
    fn check_this_container_early_errors(&mut self, file: FileId) {
        let hir = self.hir(file);
        if hir.enums.is_empty() && hir.modules.is_empty() {
            return;
        }
        let index = self.exprs_by_kind(file);
        for &this in index.of(ExprTag::This) {
            let node = hir.node(this);
            let code = match hir.kind(hir.get_this_container(node, false, false)) {
                Kind::ModuleDeclaration => 2331,
                Kind::EnumDeclaration => 2332,
                _ => continue,
            };
            if !hir.is_ambient(node) {
                self.early_grammar_error_on_node(file, this, code, &[]);
            }
        }
    }

    /// A statement of TypeScript that may only stand right in a file or right in a namespace.
    pub(super) fn check_typescript_statement_position(&mut self, file: FileId, s: StmtId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let parent = bound.parent_of_stmt(s);
        let is_module_element = matches!(parent, Parent::File | Parent::Module(_));
        let is_ambient = hir.is_ambient(hir.node(s));
        let code = match hir[s].kind {
            StmtKind::Module(m) => match hir[m].name {
                ModuleName::Global if is_ambient => return,
                ModuleName::Global if self.has_line_break_after_name(file, hir[m].name_pos) => {
                    return;
                }
                _ if !is_module_element => 1235,
                _ if is_ambient => return,
                ModuleName::Ident(_) => return,
                ModuleName::String(_) => 1035,
                ModuleName::Global => 2670,
            },
            StmtKind::ImportEquals(_) if !is_module_element => 1232,
            // What runs is a constant of that name.
            StmtKind::ImportEquals(import)
                if hir[import].name == known::let_
                    && matches!(hir[import].target, ImportEqualsTarget::Require(_))
                    && !hir[import].flags.contains(Flags::TYPE_ONLY)
                    && !is_ambient =>
            {
                let name = self.span_of_token(file, hir[import].name_pos);
                self.early_grammar_error_at(name, 2480, &[]);
                return;
            }
            StmtKind::ExportAssign(_) if !is_module_element => 1231,
            StmtKind::ExportAsNamespace(_) if !is_module_element => 1316,
            _ => return,
        };
        self.early_grammar_error_at((file, hir[s].start, 0), code, &[]);
    }

    fn has_line_break_after_name(&self, file: FileId, name: u32) -> bool {
        let text = &self.hir(file).text;
        let end = self.end_of_name_at(file, name) as usize;
        line_end(text, end) < skip_trivia(text, end)
    }

    /// `import`, `export .. from`, `export {}` and `export default` in the body of a namespace.
    pub(super) fn check_module_syntax_in_namespace(&mut self, file: FileId, s: StmtId, code: u32) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let Parent::Module(m) = bound.parent_of_stmt(s) else {
            return;
        };
        let is_type_only = match hir[s].kind {
            StmtKind::Import(import) => hir[import].type_only,
            StmtKind::ExportNamed(export) => hir[export].type_only,
            StmtKind::ExportStar { type_only, .. } => type_only,
            _ => false,
        };
        if matches!(hir[m].name, ModuleName::Ident(_))
            && !is_type_only
            && !hir.is_ambient(hir.node(s))
        {
            self.early_grammar_error_at((file, hir[s].start, 0), code, &[]);
        }
    }
}
