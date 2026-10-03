//! transform.go, the functions that only JavaScript reaches: CommonJS exports, and `this.name = e` in a class.

use super::*;
use crate::bind::{JsDeclarationKind, assignment_declaration_kind, define_property_call};

bun_core::comptime_string_set! {
    /// `textToKeyword`
    static KEYWORDS = {
        b"abstract", b"accessor", b"any", b"as", b"asserts", b"assert", b"bigint", b"boolean", b"break", b"case", b"catch", b"class",
        b"continue", b"const", b"constructor", b"debugger", b"declare", b"default", b"defer", b"delete", b"do", b"else", b"enum",
        b"export", b"extends", b"false", b"finally", b"for", b"from", b"function", b"get", b"if", b"immediate", b"implements",
        b"import", b"in", b"infer", b"instanceof", b"interface", b"intrinsic", b"is", b"keyof", b"let", b"module", b"namespace",
        b"never", b"new", b"null", b"number", b"object", b"package", b"private", b"protected", b"public", b"override", b"out",
        b"readonly", b"require", b"global", b"return", b"satisfies", b"set", b"static", b"string", b"super", b"switch", b"symbol",
        b"this", b"throw", b"true", b"try", b"type", b"typeof", b"undefined", b"unique", b"unknown", b"using", b"var", b"void",
        b"while", b"with", b"yield", b"async", b"await", b"of",
    };
}

/// The result of `getNameExpressionPreferringIdentifier`.
struct ExportName {
    /// `name.Text()`
    text: Vec<u8>,
    is_identifier: bool,
}

impl ExportName {
    /// The name as the printer emits it.
    fn written(&self) -> Vec<u8> {
        if self.is_identifier {
            self.text.clone()
        } else {
            super::super::print::quoted(&self.text, b'"', false)
        }
    }
}

impl<'p> DeclarationEmit<'_, 'p> {
    /// `cjsExportAssignmentVisitor`, then the CommonJS cases of `expressionVisitor` (`visitNestedExpression`), over the whole file.
    pub(super) fn transform_commonjs_exports(&mut self) {
        let file = self.file();
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        if !hir.is_js || !self.c.files().module(file).is_commonjs() {
            return;
        }
        let by_kind = self.c.exprs_by_kind(file);
        let candidates = by_kind
            .of(ExprTag::Assign)
            .iter()
            .chain(by_kind.of(ExprTag::Call));
        let mut declarations: Vec<(ExprId, JsDeclarationKind)> = candidates
            .map(|&e| (e, assignment_declaration_kind(hir, e)))
            .filter(|&(e, _)| bound.expr_parent[e.idx()] != Parent::None)
            .collect();
        // The visitors are pre-order.
        declarations.sort_by_key(|&(e, _)| hir[e].pos);
        let saved = self.tracker.get_symbol_accessibility_diagnostic;
        for &(e, kind) in &declarations {
            if kind != JsDeclarationKind::ModuleExports {
                continue;
            }
            let ExprKind::Assign { value, .. } = hir[e].kind else {
                continue;
            };
            let input = match bound.expr_parent[e.idx()] {
                Parent::Stmt(s) => hir.node(s),
                Parent::Expr(parent) => hir.node(parent),
                _ => hir.node(e),
            };
            self.cjs_export_assignment =
                self.transform_export_assignment(input, hir.node(e), value, true);
            self.result_has_scope_marker = true;
            self.result_has_external_module_indicator = true;
            self.tracker.get_symbol_accessibility_diagnostic = saved;
        }
        // `wrapInCJSExportNamespace` puts the members one level deeper.
        let is_wrapped = self.cjs_export_assignment_name.is_some();
        for &(e, kind) in &declarations {
            let name = match kind {
                JsDeclarationKind::ExportsProperty(_) => match hir[e].kind {
                    ExprKind::Assign { target, .. } => match hir[target].kind {
                        ExprKind::Dot { name, .. } => ExportName {
                            text: self.name(name).to_vec(),
                            is_identifier: true,
                        },
                        ExprKind::Index { index, .. } => {
                            self.name_expression_preferring_identifier(index)
                        }
                        _ => continue,
                    },
                    _ => continue,
                },
                JsDeclarationKind::ObjectDefinePropertyExports => {
                    match define_property_call(hir, e) {
                        Some((_, key)) => self.name_expression_preferring_identifier(key),
                        None => continue,
                    }
                }
                _ => continue,
            };
            if is_wrapped {
                self.set_indent(self.indent + 1);
            }
            let written = self.transform_commonjs_export_worker(e, &name);
            if is_wrapped {
                self.set_indent(self.indent - 1);
            }
            self.tracker.get_symbol_accessibility_diagnostic = saved;
            if let Some(written) = written {
                let written = self.wrap_in_cjs_export_namespace(written);
                self.cjs_export_members.extend(written);
            }
        }
    }

    /// `getNameExpressionPreferringIdentifier`, of a string or numeric literal.
    fn name_expression_preferring_identifier(&mut self, e: ExprId) -> ExportName {
        let file = self.file();
        let text = match self.c.literal_key(file, e) {
            Some(key) => self.name(key).to_vec(),
            None => Vec::new(),
        };
        let is_numeric = matches!(self.c.hir(file)[e].kind, ExprKind::Number(_));
        let is_identifier = !is_numeric
            && bun_core::lexer::is_identifier(&text)
            && (!KEYWORDS.contains(&text) || text == b"default");
        ExportName {
            text,
            is_identifier,
        }
    }

    /// `node.Symbol()`, of `exports.name = e` or `Object.defineProperty(exports, "name", d)`.
    fn symbol_of_commonjs_export(&self, name: &ExportName) -> Option<Sym> {
        let files = self.c.files();
        let exports = files.exports(files.file_symbol(self.file()));
        exports
            .into_iter()
            .find(|it| self.name(it.0) == &name.text[..])
            .map(|it| it.1)
    }

    /// `transformCommonJSExportWorker`
    fn transform_commonjs_export_worker(
        &mut self,
        input: ExprId,
        name: &ExportName,
    ) -> Option<Vec<Statement>> {
        if !name.text.is_empty() && self.witnessed_cjs_exports.contains(&name.text) {
            return None;
        }
        self.witnessed_cjs_exports.push(name.text.clone());
        self.result_has_external_module_indicator = true;
        self.result_has_scope_marker = true;
        let file = self.file();
        let (hir, bound, files) = (self.c.hir(file), self.c.bound(file), self.c.files());
        let symbol = self.symbol_of_commonjs_export(name);
        let value = match hir[input].kind {
            ExprKind::Assign { value, .. } => value,
            _ => ExprId::NONE,
        };
        let is_top_level_statement = matches!(bound.expr_parent[input.idx()], Parent::Stmt(s)
            if bound.stmt_parent[s.idx()] == Parent::File);
        // `isCommonJSAliasExport`
        if value.is_some()
            && let ExprKind::Ident(source) = hir[value].kind
            && !is_parenthesized(hir, value)
            && symbol.is_some_and(|symbol| files.decls_of(symbol).len() == 1)
            && is_top_level_statement
        {
            // `transformBinaryExpressionToExportDeclaration`
            self.check_entity_name_visibility(source, hir[value].pos, Meaning::Value);
            let specifier = if name.is_identifier && self.name(source) == &name.text[..] {
                name.text.clone()
            } else {
                [self.name(source), b" as ", &name.written()[..]].concat()
            };
            let text = [b"export { ", &specifier[..], b" };"].concat();
            return Some(vec![Statement::new(StatementKind::ExportDeclaration, text)]);
        }
        let declare = |first: &[Flags], needs_declare: bool| -> Vec<Flags> {
            let declare: &[Flags] = if needs_declare {
                &[Flags::AMBIENT]
            } else {
                &[]
            };
            [first, declare].concat()
        };
        let comments = match bound.expr_parent[input.idx()] {
            Parent::Stmt(s) => self.leading_comments(hir[s].loc.pos),
            _ => Vec::new(),
        };
        if value.is_some()
            && let ExprKind::Class(class) = hir[value].kind
        {
            return Some(self.transform_commonjs_class_export(class, name, comments));
        }
        let node = hir.node(input);
        if name.is_identifier && name.text != b"default" {
            // `GetReferencedValueDeclaration(name)`: the name resolves to this assignment or to nothing.
            let scope = self.c.enclosing_scope_of_expr(file, input);
            let atom = symbol.map(|symbol| files.symbol(symbol).name);
            let resolved =
                atom.and_then(|atom| files.resolve_name(file, scope, atom, SymFlags::VALUE));
            if resolved.is_none_or(|resolved| Some(resolved) == symbol) {
                self.tracker.fallback_stack.push(node);
                let ensured = self.ensure_type(node, false);
                self.tracker.fallback_stack.pop();
                return Some(vec![Statement {
                    kind: StatementKind::Other,
                    comments: Vec::new(),
                    modifiers: declare(&[Flags::EXPORT], self.needs_declare),
                    text: [b"var ", &name.text[..], &ensured.text()[..], b";"].concat(),
                }]);
            }
        }
        // `const _default: Type; export default _default;`, `const _exported: Type; export { _exported as "name" };`
        let is_default = name.is_identifier && name.text == b"default";
        let new_id = self.unique_name(if is_default {
            b"_default"
        } else {
            b"_exported"
        });
        self.tracker.get_symbol_accessibility_diagnostic = Context::DefaultExport(node);
        self.tracker.fallback_stack.push(node);
        let ensured = self.ensure_type(node, false);
        self.tracker.fallback_stack.pop();
        let statement = Statement {
            kind: StatementKind::Other,
            comments,
            modifiers: declare(&[], self.needs_declare),
            text: [b"const ", &new_id[..], &ensured.text()[..], b";"].concat(),
        };
        let export = if is_default {
            let text = [b"export default ", &new_id[..], b";"].concat();
            Statement::new(StatementKind::ExportAssignment, text)
        } else {
            let text = [
                b"export { ",
                &new_id[..],
                b" as ",
                &name.written()[..],
                b" };",
            ]
            .concat();
            Statement::new(StatementKind::ExportDeclaration, text)
        };
        Some(vec![statement, export])
    }

    /// `transformCommonJSExportWorker`, where the right side is a class expression: a class declaration instead of a typed variable.
    fn transform_commonjs_class_export(
        &mut self,
        c: ClassId,
        name: &ExportName,
        comments: Vec<u8>,
    ) -> Vec<Statement> {
        let file = self.file();
        let own_name = self.c.hir(file)[c].name;
        let exported = |needs_declare: bool| match needs_declare {
            true => vec![Flags::EXPORT, Flags::AMBIENT],
            false => vec![Flags::EXPORT],
        };
        if own_name.is_none() {
            let class_name = match name.is_identifier {
                true => name.text.clone(),
                false => self.unique_name(b"_class"),
            };
            let mut class =
                self.transform_class_expression(c, &class_name, exported(self.needs_declare));
            class.comments = comments;
            if name.is_identifier {
                return vec![class];
            }
            let text = [
                b"export { ",
                &class_name[..],
                b" as ",
                &name.written()[..],
                b" };",
            ]
            .concat();
            return vec![
                class,
                Statement::new(StatementKind::ExportDeclaration, text),
            ];
        }
        let class_name = self.name(own_name).to_vec();
        self.tracker.watched_class_symbol = Some(self.c.class_sym(file, c));
        self.tracker.class_symbol_tracked = false;
        let names_differ = !name.is_identifier || class_name != name.text;
        // In the namespace the class is one level deeper, and whether it refers to itself is known once it is written.
        let mut class = None;
        if !names_differ {
            class =
                Some(self.transform_class_expression(c, &class_name, exported(self.needs_declare)));
        }
        let needs_isolation = names_differ || self.tracker.class_symbol_tracked;
        if needs_isolation {
            self.set_indent(self.indent + 1);
            class = Some(self.transform_class_expression(c, &class_name, vec![Flags::EXPORT]));
            self.set_indent(self.indent - 1);
        }
        self.tracker.watched_class_symbol = None;
        self.tracker.class_symbol_tracked = false;
        let Some(mut class) = class else {
            return Vec::new();
        };
        class.comments = comments;
        if !needs_isolation {
            return vec![class];
        }
        let namespace = self.unique_name(b"_ns");
        self.set_indent(self.indent + 1);
        let body = self.statements_text(&[class]);
        self.set_indent(self.indent - 1);
        let modifiers = match self.needs_declare {
            true => vec![Flags::AMBIENT],
            false => Vec::new(),
        };
        let namespace_declaration = Statement {
            kind: StatementKind::Other,
            comments: Vec::new(),
            modifiers,
            text: [
                b"namespace ",
                &namespace[..],
                b" {\n",
                &body[..],
                &self.indentation()[..],
                b"}",
            ]
            .concat(),
        };
        let alias_base = [b"_", &name.text[..]].concat();
        let alias = match name.is_identifier && bun_core::lexer::is_identifier(&alias_base) {
            true => self.unique_name(&alias_base),
            false => self.unique_name(b"_exported"),
        };
        let import = [
            b"import ",
            &alias[..],
            b" = ",
            &namespace[..],
            b".",
            &class_name[..],
            b";",
        ]
        .concat();
        let export = [
            b"export { ",
            &alias[..],
            b" as ",
            &name.written()[..],
            b" };",
        ]
        .concat();
        vec![
            namespace_declaration,
            Statement::new(StatementKind::ImportEquals, import),
            Statement::new(StatementKind::ExportDeclaration, export),
        ]
    }

    /// `wrapInCJSExportNamespace`. The members were written one level deeper.
    fn wrap_in_cjs_export_namespace(&mut self, mut members: Vec<Statement>) -> Vec<Statement> {
        let Some(name) = self.cjs_export_assignment_name.clone() else {
            return members;
        };
        // `declareStrippingVisitor`
        for member in &mut members {
            member
                .modifiers
                .retain(|&modifier| modifier != Flags::AMBIENT);
        }
        self.set_indent(self.indent + 1);
        let body = self.statements_text(&members);
        self.set_indent(self.indent - 1);
        let modifiers = if self.needs_declare {
            vec![Flags::AMBIENT]
        } else {
            Vec::new()
        };
        vec![Statement {
            kind: StatementKind::Other,
            comments: Vec::new(),
            modifiers,
            text: [
                b"namespace ",
                &name[..],
                b" {\n",
                &body[..],
                &self.indentation()[..],
                b"}",
            ]
            .concat(),
        }]
    }

    /// `transformCjsRequireVariableDeclaration`
    pub(super) fn transform_cjs_require_variable_declaration(
        &mut self,
        d: VarDeclId,
    ) -> Option<Statement> {
        let hir = self.c.hir(self.file());
        let (argument, _) = crate::bind::require_call_argument(hir, hir[d].init)?;
        // `rewriteModuleSpecifier`
        self.result_has_external_module_indicator = true;
        let (start, end) = (
            hir[argument].pos as usize,
            self.c.end_of_expr(self.file(), argument) as usize,
        );
        let specifier = &hir.text[start..end];
        match hir[hir[d].pat].kind {
            // `const x = require("something")` -> `import x = require("something")`
            PatKind::Ident(name) => {
                let text = [
                    b"import ",
                    self.name(name),
                    b" = require(",
                    specifier,
                    b");",
                ]
                .concat();
                Some(Statement::new(StatementKind::ImportEquals, text))
            }
            // `const {x, y: z} = require("something")` -> `import {x, y as z} from "something"`
            PatKind::Object(props) => {
                let mut specifiers: Vec<Vec<u8>> = Vec::new();
                for p in props.iter() {
                    let PatKind::Ident(name) = hir[hir[p].value].kind else {
                        continue;
                    };
                    specifiers.push(if hir[hir[p].value].pos == hir[p].pos {
                        self.name(name).to_vec()
                    } else {
                        let property =
                            self.text_of(Written::PropertyName(hir.property_name(hir.node(p))));
                        [&property[..], b" as ", self.name(name)].concat()
                    });
                }
                let list = match specifiers.is_empty() {
                    true => b"{}".to_vec(),
                    false => [b"{ ", &specifiers.join(&b", "[..])[..], b" }"].concat(),
                };
                let text = [b"import ", &list[..], b" from ", specifier, b";"].concat();
                Some(Statement::new(StatementKind::Import, text))
            }
            _ => None,
        }
    }

    /// `collectThisPropertyAssignments`, `visitThisPropertyAssignments`: a property declaration for each name that is only assigned to.
    pub(super) fn collect_this_property_assignments(&mut self, c: ClassId) -> Vec<Vec<u8>> {
        let file = self.file();
        let (hir, bound, files) = (self.c.hir(file), self.c.bound(file), self.c.files());
        if !hir.is_js {
            return Vec::new();
        }
        // `thisPropertyAssignmentKey`: the name, `isStatic`.
        let mut seen: Vec<(Atom, bool)> = Vec::new();
        for m in hir[c].members.iter() {
            if let Some(name) = self.c.member_name(file, hir[m].key) {
                seen.push((name, hir[m].flags.contains(Flags::STATIC)));
            }
        }
        let class = hir.node(c);
        let by_kind = self.c.exprs_by_kind(file);
        let mut assignments: Vec<ExprId> = (by_kind.of(ExprTag::Assign).iter().copied())
            .filter(|&e| assignment_declaration_kind(hir, e) == JsDeclarationKind::ThisProperty)
            .filter(|&e| bound.expr_parent[e.idx()] != Parent::None)
            .collect();
        assignments.sort_by_key(|&e| hir[e].pos);
        let has_base =
            hir[c].extends.is_some() && !matches!(hir[hir[c].extends].kind, ExprKind::Null);
        let mut collected = Vec::new();
        for e in assignments {
            let container = hir.get_this_container(hir.node(e), false, false);
            if hir.parent(container) != class {
                continue;
            }
            let is_static = hir.is_static(container)
                || hir.kind(container) == Kind::ClassStaticBlockDeclaration;
            let ExprKind::Assign { target, .. } = hir[e].kind else {
                continue;
            };
            // `GetReferencedMemberValueDeclaration`
            let symbol = bound.expr_symbol[e.idx()];
            // `HasDynamicName`: an identifier is not `IsSimpleInlineableExpression`, so `this[name] = e` declares nothing here.
            let name = match hir[target].kind {
                ExprKind::Dot { name, .. } => Some(name),
                ExprKind::Index { index, .. } if is_string_or_numeric_literal_like(hir, index) => {
                    self.c.literal_key(file, index)
                }
                _ => None,
            };
            let (Some(name), true) = (name, symbol.is_some()) else {
                continue;
            };
            if seen.contains(&(name, is_static)) {
                continue;
            }
            seen.push((name, is_static));
            let symbol = files.sym(file, symbol);
            if has_base {
                self.tracker.report_inference_fallback(self.c, file, class);
                if self.is_this_property_assignment_declaration_redundant(symbol, name) {
                    continue;
                }
            }
            if name == known::constructor {
                continue;
            }
            let written = match hir[target].kind {
                // `getLiteralTextOfNode`
                ExprKind::Index { index, .. } => hir.text
                    [hir[index].pos as usize..self.c.end_of_expr(file, index) as usize]
                    .to_vec(),
                _ if bun_core::lexer::is_identifier(self.name(name)) => self.name(name).to_vec(),
                _ => super::super::print::quoted(self.name(name), b'"', false),
            };
            let saved = self.tracker.get_symbol_accessibility_diagnostic;
            let ensured = self.ensure_type(hir.node(e), false);
            self.tracker.get_symbol_accessibility_diagnostic = saved;
            let comments = match bound.expr_parent[e.idx()] {
                Parent::Stmt(s) => self.leading_comments(hir[s].loc.pos),
                _ => Vec::new(),
            };
            let modifier: &[u8] = if is_static { b"static " } else { b"" };
            collected.push(
                [
                    &comments[..],
                    modifier,
                    &written[..],
                    &ensured.text()[..],
                    b";",
                ]
                .concat(),
            );
        }
        collected
    }

    /// `IsThisPropertyAssignmentDeclarationRedundant`
    fn is_this_property_assignment_declaration_redundant(
        &mut self,
        symbol: Sym,
        name: Atom,
    ) -> bool {
        let Some(parent) = self.c.files().parent_of_symbol(symbol) else {
            return false;
        };
        let own = self.c.declared_type(parent);
        let Some((own, own_mapper)) = self.c.get_property_of_type(own, name) else {
            return false;
        };
        let compared = PropFlags::READONLY | PropFlags::OPTIONAL;
        for &base in self.c.base_types(parent).iter() {
            let Some((inherited, mapper)) = self.c.get_property_of_type(base, name) else {
                continue;
            };
            if inherited
                .flags
                .intersects(PropFlags::ACCESSOR | PropFlags::METHOD)
            {
                return true;
            }
            if inherited.flags & compared == own.flags & compared {
                let (a, b) = (
                    self.c.type_of_prop(own, own_mapper),
                    self.c.type_of_prop(inherited, mapper),
                );
                if self.c.is_identical(a, b) {
                    return true;
                }
            }
        }
        false
    }

    /// `getTypeOfSymbol(getSymbolOfDeclaration(e))`, of an assignment or a call that is a declaration in JavaScript.
    pub(super) fn type_of_commonjs_declaration(&mut self, e: ExprId) -> Option<TypeId> {
        let file = self.file();
        let (hir, files) = (self.c.hir(file), self.c.files());
        let name = match assignment_declaration_kind(hir, e) {
            JsDeclarationKind::ThisProperty => {
                let symbol = self.c.bound(file).expr_symbol[e.idx()];
                return symbol
                    .is_some()
                    .then(|| self.c.type_of_symbol(files.sym(file, symbol)));
            }
            JsDeclarationKind::ModuleExports => {
                let symbol = files.export(files.file_symbol(file), known::export_equals)?;
                return Some(self.c.type_of_symbol(symbol));
            }
            JsDeclarationKind::ExportsProperty(_) => match hir[e].kind {
                ExprKind::Assign { target, .. } => match hir[target].kind {
                    ExprKind::Dot { name, .. } => Some(name),
                    ExprKind::Index { index, .. } => self.c.literal_key(file, index),
                    _ => None,
                },
                _ => None,
            },
            JsDeclarationKind::ObjectDefinePropertyExports => {
                define_property_call(hir, e).and_then(|(_, key)| self.c.literal_key(file, key))
            }
            _ => None,
        }?;
        let symbol = files.export(files.file_symbol(file), name)?;
        Some(self.c.type_of_symbol(symbol))
    }
}
