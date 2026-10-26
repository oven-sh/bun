//! The functions of transform.go that only JavaScript reaches: CommonJS exports, and `this.name = e` in a class.

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
    fn printed_name(&self) -> Vec<u8> {
        if self.is_identifier {
            self.text.clone()
        } else {
            super::super::print::quoted(&self.text, b'"', false)
        }
    }

    /// `export { local as name };`
    fn export_of(&self, local: &[u8]) -> Statement {
        let text = cat!(b"export { ", local, b" as ", self.printed_name(), b" };");
        Statement::new(StatementKind::ExportDeclaration, text)
    }
}

impl<'p> DeclarationEmit<'_, 'p, '_> {
    /// `cjsExportAssignmentVisitor`, then the CommonJS cases of `expressionVisitor` (`visitNestedExpression`), over the
    /// whole file. They run before any statement is visited, so `needsDeclare` is true.
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
            .filter(|&(e, _)| bound.parent_of_expr(e) != Parent::None)
            .collect();
        // The visitors are pre-order.
        declarations.shared_sort_by_key(|&(e, _)| hir[e].pos);
        let saved = self.tracker.get_symbol_accessibility_diagnostic;
        for &(e, kind) in &declarations {
            if kind != JsDeclarationKind::ModuleExports {
                continue;
            }
            let ExprKind::Assign { value, .. } = hir[e].kind else {
                continue;
            };
            let input = match bound.parent_of_expr(e) {
                Parent::Stmt(s) => hir.node(s),
                Parent::Expr(parent) => hir.node(parent),
                _ => hir.node(e),
            };
            self.cjs_export_assignment =
                self.transform_export_assignment(input, hir.node(e), value, true);
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
            let export_statements = self.transform_commonjs_export_worker(e, &name);
            if is_wrapped {
                self.set_indent(self.indent - 1);
            }
            self.tracker.get_symbol_accessibility_diagnostic = saved;
            if let Some(export_statements) = export_statements {
                let export_statements = self.wrap_in_cjs_export_namespace(export_statements);
                self.cjs_export_members.extend(export_statements);
            }
        }
    }

    /// `getNameExpressionPreferringIdentifier` for a string or numeric literal.
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

    /// `node.Symbol()` of `exports.name = e` or `Object.defineProperty(exports, "name", d)`.
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
        let is_top_level_statement = matches!(bound.parent_of_expr(input), Parent::Stmt(s)
            if bound.parent_of_stmt(s) == Parent::File);
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
                [self.name(source), b" as ", &name.printed_name()[..]].concat()
            };
            let text = [b"export { ", &specifier[..], b" };"].concat();
            return Some(vec![Statement::new(StatementKind::ExportDeclaration, text)]);
        }
        let comments = match bound.parent_of_expr(input) {
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
                    modifiers: vec![Flags::EXPORT, Flags::AMBIENT],
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
            modifiers: vec![Flags::AMBIENT],
            text: [b"const ", &new_id[..], &ensured.text()[..], b";"].concat(),
        };
        let export = if is_default {
            let text = [b"export default ", &new_id[..], b";"].concat();
            Statement::new(StatementKind::ExportAssignment, text)
        } else {
            name.export_of(&new_id)
        };
        Some(vec![statement, export])
    }

    /// `transformCommonJSExportWorker`, where the right side is a class expression: emits a class declaration instead
    /// of a typed variable.
    fn transform_commonjs_class_export(
        &mut self,
        c: ClassId,
        name: &ExportName,
        comments: Vec<u8>,
    ) -> Vec<Statement> {
        let file = self.file();
        let own_name = self.c.hir(file)[c].name;
        let exported = vec![Flags::EXPORT, Flags::AMBIENT];
        if own_name.is_none() {
            let class_name = match name.is_identifier {
                true => name.text.clone(),
                false => self.unique_name(b"_class"),
            };
            let mut class = self.transform_class_expression(c, &class_name, exported);
            class.comments = comments;
            if name.is_identifier {
                return vec![class];
            }
            return vec![class, name.export_of(&class_name)];
        }
        let class_name = self.name(own_name).to_vec();
        self.tracker.watched_class_symbol = Some(self.c.class_sym(file, c));
        self.tracker.class_symbol_tracked = false;
        let names_differ = !name.is_identifier || class_name != name.text;
        // In the namespace the class is one level deeper, and whether it refers to itself is only known once it's
        // emitted.
        let mut class = None;
        if !names_differ {
            class = Some(self.transform_class_expression(c, &class_name, exported));
        }
        let needs_isolation = names_differ || self.tracker.class_symbol_tracked;
        if needs_isolation {
            self.set_indent(self.indent + 1);
            class = Some(self.transform_class_expression(c, &class_name, vec![Flags::EXPORT]));
            self.set_indent(self.indent - 1);
        }
        self.tracker.watched_class_symbol = None;
        let Some(mut class) = class else {
            return Vec::new();
        };
        class.comments = comments;
        if !needs_isolation {
            return vec![class];
        }
        let namespace = self.unique_name(b"_ns");
        let namespace_declaration =
            self.namespace_declaration(vec![Flags::AMBIENT], &namespace, &[class]);
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
        vec![
            namespace_declaration,
            Statement::new(StatementKind::ImportEquals, import),
            name.export_of(&alias),
        ]
    }

    /// `wrapInCJSExportNamespace`. The members were emitted one level deeper.
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
        vec![self.namespace_declaration(vec![Flags::AMBIENT], &name, &members)]
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
        let specifier = self.c.get_text_of_node(self.file(), hir.node(argument));
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
                            self.text_of(ReusedNode::PropertyName(hir.property_name(hir.node(p))));
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

    /// `collectThisPropertyAssignments`, `visitThisPropertyAssignments`: a property declaration for each name that's
    /// only assigned to.
    pub(super) fn collect_this_property_assignments(&mut self, c: ClassId) -> Vec<Vec<u8>> {
        let file = self.file();
        let (hir, bound, files) = (self.c.hir(file), self.c.bound(file), self.c.files());
        if !hir.is_js {
            return Vec::new();
        }
        // `thisPropertyAssignmentKey`: the name, `isStatic`. `getThisPropertyAssignmentKey`: a name that's dynamic, or
        // whose text `TryGetTextOfPropertyName` can't get (`[+1]`), gets a unique key, which no assignment matches.
        let mut seen: Vec<(Atom, bool)> = Vec::new();
        for m in hir[c].members.iter() {
            if let Some(name) = hir[m].key.name() {
                seen.push((name, hir[m].flags.contains(Flags::STATIC)));
            }
        }
        let class = hir.node(c);
        let by_kind = self.c.exprs_by_kind(file);
        let mut assignments: Vec<ExprId> = (by_kind.of(ExprTag::Assign).iter().copied())
            .filter(|&e| assignment_declaration_kind(hir, e) == JsDeclarationKind::ThisProperty)
            .filter(|&e| bound.parent_of_expr(e) != Parent::None)
            .collect();
        assignments.shared_sort_by_key(|&e| hir[e].pos);
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
            let symbol = bound.symbol_of_expr(e);
            // `HasDynamicName`: an identifier isn't `IsSimpleInlineableExpression`, so `this[name] = e` doesn't declare
            // anything here.
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
            let name_text = match hir[target].kind {
                // `getLiteralTextOfNode`
                ExprKind::Index { index, .. } => {
                    self.c.get_text_of_node(file, hir.node(index)).to_vec()
                }
                _ if bun_core::lexer::is_identifier(self.name(name)) => self.name(name).to_vec(),
                _ => super::super::print::quoted(self.name(name), b'"', false),
            };
            let saved = self.tracker.get_symbol_accessibility_diagnostic;
            let ensured = self.ensure_type(hir.node(e), false);
            self.tracker.get_symbol_accessibility_diagnostic = saved;
            let comments = match bound.parent_of_expr(e) {
                Parent::Stmt(s) => self.leading_comments(hir[s].loc.pos),
                _ => Vec::new(),
            };
            let modifier: &[u8] = if is_static { b"static " } else { b"" };
            collected.push(
                [
                    &comments[..],
                    modifier,
                    &name_text[..],
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

    /// `getTypeOfSymbol(getSymbolOfDeclaration(e))` for an assignment or a call that's a declaration in JavaScript.
    pub(super) fn type_of_commonjs_declaration(&mut self, e: ExprId) -> Option<TypeId> {
        let file = self.file();
        let (hir, files) = (self.c.hir(file), self.c.files());
        let name = match assignment_declaration_kind(hir, e) {
            JsDeclarationKind::ThisProperty => {
                let symbol = self.c.bound(file).symbol_of_expr(e);
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
