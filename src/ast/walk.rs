//! A read-only walk over `Stmt`, `Expr` and `Binding`: one dispatch per node, every payload matched field by field.

use crate::expr::Data as ExprData;
use crate::stmt::Data as StmtData;
use crate::{ArrayBinding, Binding, Case, Catch, EnumValue, Expr, Finally, Loc, Stmt, StmtOrExpr};
use crate::{B, E, G, S};

/// One method per variant. Its default walks the children: an override that does not call `walk_*` skips them.
pub trait Visitor<'ast>: Sized {
    #[inline]
    fn visit_stmt(&mut self, stmt: &'ast Stmt) {
        walk_stmt(self, stmt);
    }

    /// Not given a binary expression that is the left operand of one: see [`walk_e_binary`].
    #[inline]
    fn visit_expr(&mut self, expr: &'ast Expr) {
        walk_expr(self, expr);
    }

    #[inline]
    fn visit_binding(&mut self, binding: &'ast Binding) {
        walk_binding(self, binding);
    }

    /// A decorator of a class, of a class member or of a parameter.
    #[inline]
    fn visit_decorator(&mut self, decorator: &'ast Expr) {
        self.visit_expr(decorator);
    }

    /// Each statement [`walk_stmt`] walks, before the method of its kind.
    #[inline]
    fn enter_stmt(&mut self, _stmt: &'ast Stmt) {}

    /// Each expression [`walk_expr`] walks, before the method of its kind.
    #[inline]
    fn enter_expr(&mut self, _expr: &'ast Expr) {}

    /// Each binding [`walk_binding`] walks, before the method of its kind.
    #[inline]
    fn enter_binding(&mut self, _binding: &'ast Binding) {}

    #[inline]
    fn visit_s_block(&mut self, node: &'ast S::Block, _loc: Loc) {
        walk_s_block(self, node);
    }
    #[inline]
    fn visit_s_break(&mut self, _node: &'ast S::Break, _loc: Loc) {}
    #[inline]
    fn visit_s_class(&mut self, node: &'ast S::Class, _loc: Loc) {
        walk_s_class(self, node);
    }
    #[inline]
    fn visit_s_comment(&mut self, _node: &'ast S::Comment, _loc: Loc) {}
    #[inline]
    fn visit_s_continue(&mut self, _node: &'ast S::Continue, _loc: Loc) {}
    #[inline]
    fn visit_s_directive(&mut self, _node: &'ast S::Directive, _loc: Loc) {}
    #[inline]
    fn visit_s_do_while(&mut self, node: &'ast S::DoWhile, _loc: Loc) {
        walk_s_do_while(self, node);
    }
    #[inline]
    fn visit_s_enum(&mut self, node: &'ast S::Enum, _loc: Loc) {
        walk_s_enum(self, node);
    }
    #[inline]
    fn visit_s_export_clause(&mut self, _node: &'ast S::ExportClause, _loc: Loc) {}
    #[inline]
    fn visit_s_export_default(&mut self, node: &'ast S::ExportDefault, _loc: Loc) {
        walk_s_export_default(self, node);
    }
    #[inline]
    fn visit_s_export_equals(&mut self, node: &'ast S::ExportEquals, _loc: Loc) {
        walk_s_export_equals(self, node);
    }
    #[inline]
    fn visit_s_export_from(&mut self, _node: &'ast S::ExportFrom, _loc: Loc) {}
    #[inline]
    fn visit_s_export_star(&mut self, _node: &'ast S::ExportStar, _loc: Loc) {}
    #[inline]
    fn visit_s_expr(&mut self, node: &'ast S::SExpr, _loc: Loc) {
        walk_s_expr(self, node);
    }
    #[inline]
    fn visit_s_for_in(&mut self, node: &'ast S::ForIn, _loc: Loc) {
        walk_s_for_in(self, node);
    }
    #[inline]
    fn visit_s_for_of(&mut self, node: &'ast S::ForOf, _loc: Loc) {
        walk_s_for_of(self, node);
    }
    #[inline]
    fn visit_s_for(&mut self, node: &'ast S::For, _loc: Loc) {
        walk_s_for(self, node);
    }
    #[inline]
    fn visit_s_function(&mut self, node: &'ast S::Function, _loc: Loc) {
        walk_s_function(self, node);
    }
    #[inline]
    fn visit_s_if(&mut self, node: &'ast S::If, _loc: Loc) {
        walk_s_if(self, node);
    }
    #[inline]
    fn visit_s_import(&mut self, _node: &'ast S::Import, _loc: Loc) {}
    #[inline]
    fn visit_s_label(&mut self, node: &'ast S::Label, _loc: Loc) {
        walk_s_label(self, node);
    }
    #[inline]
    fn visit_s_local(&mut self, node: &'ast S::Local, _loc: Loc) {
        walk_s_local(self, node);
    }
    #[inline]
    fn visit_s_namespace(&mut self, node: &'ast S::Namespace, _loc: Loc) {
        walk_s_namespace(self, node);
    }
    #[inline]
    fn visit_s_return(&mut self, node: &'ast S::Return, _loc: Loc) {
        walk_s_return(self, node);
    }
    #[inline]
    fn visit_s_switch(&mut self, node: &'ast S::Switch, _loc: Loc) {
        walk_s_switch(self, node);
    }
    #[inline]
    fn visit_s_throw(&mut self, node: &'ast S::Throw, _loc: Loc) {
        walk_s_throw(self, node);
    }
    #[inline]
    fn visit_s_try(&mut self, node: &'ast S::Try, _loc: Loc) {
        walk_s_try(self, node);
    }
    #[inline]
    fn visit_s_while(&mut self, node: &'ast S::While, _loc: Loc) {
        walk_s_while(self, node);
    }
    #[inline]
    fn visit_s_with(&mut self, node: &'ast S::With, _loc: Loc) {
        walk_s_with(self, node);
    }
    #[inline]
    fn visit_s_type_script(&mut self, _node: &'ast S::TypeScript, _loc: Loc) {}
    #[inline]
    fn visit_s_empty(&mut self, _node: &'ast S::Empty, _loc: Loc) {}
    #[inline]
    fn visit_s_debugger(&mut self, _node: &'ast S::Debugger, _loc: Loc) {}
    /// The value of a file that is not code (JSON, TOML, text): no `Expr`, so nothing of it is walked.
    #[inline]
    fn visit_s_lazy_export(&mut self, _data: &'ast ExprData, _loc: Loc) {}

    #[inline]
    fn visit_e_array(&mut self, node: &'ast E::Array, _loc: Loc) {
        walk_e_array(self, node);
    }
    #[inline]
    fn visit_e_unary(&mut self, node: &'ast E::Unary, _loc: Loc) {
        walk_e_unary(self, node);
    }
    /// Returns what [`walk_e_binary`] returns, or `None` to skip what is left of the chain.
    #[inline]
    fn visit_e_binary(&mut self, node: &'ast E::Binary, _loc: Loc) -> Option<&'ast Expr> {
        walk_e_binary(self, node)
    }
    #[inline]
    fn visit_e_class(&mut self, node: &'ast E::Class, _loc: Loc) {
        walk_e_class(self, node);
    }
    #[inline]
    fn visit_e_new(&mut self, node: &'ast E::New, _loc: Loc) {
        walk_e_new(self, node);
    }
    #[inline]
    fn visit_e_function(&mut self, node: &'ast E::Function, _loc: Loc) {
        walk_e_function(self, node);
    }
    #[inline]
    fn visit_e_call(&mut self, node: &'ast E::Call, _loc: Loc) {
        walk_e_call(self, node);
    }
    #[inline]
    fn visit_e_dot(&mut self, node: &'ast E::Dot, _loc: Loc) {
        walk_e_dot(self, node);
    }
    #[inline]
    fn visit_e_index(&mut self, node: &'ast E::Index, _loc: Loc) {
        walk_e_index(self, node);
    }
    #[inline]
    fn visit_e_arrow(&mut self, node: &'ast E::Arrow, _loc: Loc) {
        walk_e_arrow(self, node);
    }
    #[inline]
    fn visit_e_jsx_element(&mut self, node: &'ast E::JSXElement, _loc: Loc) {
        walk_e_jsx_element(self, node);
    }
    #[inline]
    fn visit_e_object(&mut self, node: &'ast E::Object, _loc: Loc) {
        walk_e_object(self, node);
    }
    #[inline]
    fn visit_e_object_json(&mut self, _node: &'ast E::ObjectJSON, _loc: Loc) {}
    #[inline]
    fn visit_e_array_json(&mut self, _node: &'ast E::ArrayJSON, _loc: Loc) {}
    #[inline]
    fn visit_e_spread(&mut self, node: &'ast E::Spread, _loc: Loc) {
        walk_e_spread(self, node);
    }
    #[inline]
    fn visit_e_template(&mut self, node: &'ast E::Template, _loc: Loc) {
        walk_e_template(self, node);
    }
    #[inline]
    fn visit_e_reg_exp(&mut self, _node: &'ast E::RegExp, _loc: Loc) {}
    #[inline]
    fn visit_e_await(&mut self, node: &'ast E::Await, _loc: Loc) {
        walk_e_await(self, node);
    }
    #[inline]
    fn visit_e_yield(&mut self, node: &'ast E::Yield, _loc: Loc) {
        walk_e_yield(self, node);
    }
    #[inline]
    fn visit_e_if(&mut self, node: &'ast E::If, _loc: Loc) {
        walk_e_if(self, node);
    }
    #[inline]
    fn visit_e_import(&mut self, node: &'ast E::Import, _loc: Loc) {
        walk_e_import(self, node);
    }
    #[inline]
    fn visit_e_identifier(&mut self, _node: &'ast E::Identifier, _loc: Loc) {}
    #[inline]
    fn visit_e_import_identifier(&mut self, _node: &'ast E::ImportIdentifier, _loc: Loc) {}
    #[inline]
    fn visit_e_private_identifier(&mut self, _node: &'ast E::PrivateIdentifier, _loc: Loc) {}
    #[inline]
    fn visit_e_commonjs_export_identifier(
        &mut self,
        _node: &'ast E::CommonJSExportIdentifier,
        _loc: Loc,
    ) {
    }
    #[inline]
    fn visit_e_boolean(&mut self, _node: &'ast E::Boolean, _loc: Loc) {}
    #[inline]
    fn visit_e_branch_boolean(&mut self, _node: &'ast E::Boolean, _loc: Loc) {}
    #[inline]
    fn visit_e_number(&mut self, _node: &'ast E::Number, _loc: Loc) {}
    #[inline]
    fn visit_e_big_int(&mut self, _node: &'ast E::BigInt, _loc: Loc) {}
    #[inline]
    fn visit_e_string(&mut self, _node: &'ast E::EString, _loc: Loc) {}
    #[inline]
    fn visit_e_require_string(&mut self, _node: &'ast E::RequireString, _loc: Loc) {}
    #[inline]
    fn visit_e_require_resolve_string(&mut self, _node: &'ast E::RequireResolveString, _loc: Loc) {}
    #[inline]
    fn visit_e_require_call_target(&mut self, _loc: Loc) {}
    #[inline]
    fn visit_e_require_resolve_call_target(&mut self, _loc: Loc) {}
    #[inline]
    fn visit_e_missing(&mut self, _node: &'ast E::Missing, _loc: Loc) {}
    #[inline]
    fn visit_e_this(&mut self, _node: &'ast E::This, _loc: Loc) {}
    #[inline]
    fn visit_e_super(&mut self, _node: &'ast E::Super, _loc: Loc) {}
    #[inline]
    fn visit_e_null(&mut self, _node: &'ast E::Null, _loc: Loc) {}
    #[inline]
    fn visit_e_undefined(&mut self, _node: &'ast E::Undefined, _loc: Loc) {}
    #[inline]
    fn visit_e_new_target(&mut self, _node: &'ast E::NewTarget, _loc: Loc) {}
    #[inline]
    fn visit_e_import_meta(&mut self, _node: &'ast E::ImportMeta, _loc: Loc) {}
    #[inline]
    fn visit_e_import_meta_main(&mut self, _node: &'ast E::ImportMetaMain, _loc: Loc) {}
    #[inline]
    fn visit_e_require_main(&mut self, _loc: Loc) {}
    #[inline]
    fn visit_e_special(&mut self, _node: &'ast E::Special, _loc: Loc) {}
    #[inline]
    fn visit_e_inlined_enum(&mut self, node: &'ast E::InlinedEnum, _loc: Loc) {
        walk_e_inlined_enum(self, node);
    }
    #[inline]
    fn visit_e_name_of_symbol(&mut self, _node: &'ast E::NameOfSymbol, _loc: Loc) {}

    #[inline]
    fn visit_b_identifier(&mut self, _node: &'ast B::Identifier, _loc: Loc) {}
    #[inline]
    fn visit_b_array(&mut self, node: &'ast B::Array, _loc: Loc) {
        walk_b_array(self, node);
    }
    #[inline]
    fn visit_b_object(&mut self, node: &'ast B::Object, _loc: Loc) {
        walk_b_object(self, node);
    }
    #[inline]
    fn visit_b_missing(&mut self, _node: &'ast B::Missing, _loc: Loc) {}
}

pub fn walk_stmt<'ast, V: Visitor<'ast>>(visitor: &mut V, stmt: &'ast Stmt) {
    visitor.enter_stmt(stmt);
    let Stmt { loc, data } = stmt;
    let loc = *loc;
    match data {
        StmtData::SBlock(s) => visitor.visit_s_block(s, loc),
        StmtData::SBreak(s) => {
            let S::Break { label: _ } = &**s;
            visitor.visit_s_break(s, loc);
        }
        StmtData::SClass(s) => visitor.visit_s_class(s, loc),
        StmtData::SComment(s) => {
            let S::Comment { text: _ } = &**s;
            visitor.visit_s_comment(s, loc);
        }
        StmtData::SContinue(s) => {
            let S::Continue { label: _ } = &**s;
            visitor.visit_s_continue(s, loc);
        }
        StmtData::SDirective(s) => {
            let S::Directive { value: _ } = &**s;
            visitor.visit_s_directive(s, loc);
        }
        StmtData::SDoWhile(s) => visitor.visit_s_do_while(s, loc),
        StmtData::SEnum(s) => visitor.visit_s_enum(s, loc),
        StmtData::SExportClause(s) => {
            let S::ExportClause {
                items: _,
                is_single_line: _,
            } = &**s;
            visitor.visit_s_export_clause(s, loc);
        }
        StmtData::SExportDefault(s) => visitor.visit_s_export_default(s, loc),
        StmtData::SExportEquals(s) => visitor.visit_s_export_equals(s, loc),
        StmtData::SExportFrom(s) => {
            let S::ExportFrom {
                items: _,
                namespace_ref: _,
                import_record_index: _,
                is_single_line: _,
            } = &**s;
            visitor.visit_s_export_from(s, loc);
        }
        StmtData::SExportStar(s) => {
            let S::ExportStar {
                namespace_ref: _,
                alias: _,
                import_record_index: _,
            } = &**s;
            visitor.visit_s_export_star(s, loc);
        }
        StmtData::SExpr(s) => visitor.visit_s_expr(s, loc),
        StmtData::SForIn(s) => visitor.visit_s_for_in(s, loc),
        StmtData::SForOf(s) => visitor.visit_s_for_of(s, loc),
        StmtData::SFor(s) => visitor.visit_s_for(s, loc),
        StmtData::SFunction(s) => visitor.visit_s_function(s, loc),
        StmtData::SIf(s) => visitor.visit_s_if(s, loc),
        StmtData::SImport(s) => {
            let S::Import {
                namespace_ref: _,
                default_name: _,
                items: _,
                star_name_loc: _,
                import_record_index: _,
                is_single_line: _,
                phase_defer: _,
            } = &**s;
            visitor.visit_s_import(s, loc);
        }
        StmtData::SLabel(s) => visitor.visit_s_label(s, loc),
        StmtData::SLocal(s) => visitor.visit_s_local(s, loc),
        StmtData::SNamespace(s) => visitor.visit_s_namespace(s, loc),
        StmtData::SReturn(s) => visitor.visit_s_return(s, loc),
        StmtData::SSwitch(s) => visitor.visit_s_switch(s, loc),
        StmtData::SThrow(s) => visitor.visit_s_throw(s, loc),
        StmtData::STry(s) => visitor.visit_s_try(s, loc),
        StmtData::SWhile(s) => visitor.visit_s_while(s, loc),
        StmtData::SWith(s) => visitor.visit_s_with(s, loc),
        StmtData::STypeScript(s @ S::TypeScript {}) => visitor.visit_s_type_script(s, loc),
        StmtData::SEmpty(s @ S::Empty {}) => visitor.visit_s_empty(s, loc),
        StmtData::SDebugger(s @ S::Debugger {}) => visitor.visit_s_debugger(s, loc),
        StmtData::SLazyExport(data) => visitor.visit_s_lazy_export(data, loc),
    }
}

pub fn walk_expr<'ast, V: Visitor<'ast>>(visitor: &mut V, expr: &'ast Expr) {
    visitor.enter_expr(expr);
    let Expr { loc, data } = expr;
    let loc = *loc;
    match data {
        ExprData::EArray(e) => visitor.visit_e_array(e, loc),
        ExprData::EUnary(e) => visitor.visit_e_unary(e, loc),
        ExprData::EBinary(e) => {
            let mut link: &'ast E::Binary = e;
            let mut link_loc = loc;
            while let Some(left) = visitor.visit_e_binary(link, link_loc) {
                let ExprData::EBinary(inner) = &left.data else {
                    visitor.visit_expr(left);
                    break;
                };
                visitor.enter_expr(left);
                link = inner;
                link_loc = left.loc;
            }
        }
        ExprData::EClass(e) => visitor.visit_e_class(e, loc),
        ExprData::ENew(e) => visitor.visit_e_new(e, loc),
        ExprData::EFunction(e) => visitor.visit_e_function(e, loc),
        ExprData::ECall(e) => visitor.visit_e_call(e, loc),
        ExprData::EDot(e) => visitor.visit_e_dot(e, loc),
        ExprData::EIndex(e) => visitor.visit_e_index(e, loc),
        ExprData::EArrow(e) => visitor.visit_e_arrow(e, loc),
        ExprData::EJsxElement(e) => visitor.visit_e_jsx_element(e, loc),
        ExprData::EObject(e) => visitor.visit_e_object(e, loc),
        // These three keep fields of their own, so they cannot be matched here: none of them is a node.
        ExprData::EObjectJSON(e) => visitor.visit_e_object_json(e, loc),
        ExprData::EArrayJSON(e) => visitor.visit_e_array_json(e, loc),
        ExprData::ENumber(e) => visitor.visit_e_number(e, loc),
        ExprData::ESpread(e) => visitor.visit_e_spread(e, loc),
        ExprData::ETemplate(e) => visitor.visit_e_template(e, loc),
        ExprData::ERegExp(e) => {
            let E::RegExp {
                value: _,
                flags_offset: _,
            } = &**e;
            visitor.visit_e_reg_exp(e, loc);
        }
        ExprData::EAwait(e) => visitor.visit_e_await(e, loc),
        ExprData::EYield(e) => visitor.visit_e_yield(e, loc),
        ExprData::EIf(e) => visitor.visit_e_if(e, loc),
        ExprData::EImport(e) => visitor.visit_e_import(e, loc),
        ExprData::EIdentifier(e @ E::Identifier { ref_: _ }) => visitor.visit_e_identifier(e, loc),
        ExprData::EImportIdentifier(e @ E::ImportIdentifier { ref_: _ }) => {
            visitor.visit_e_import_identifier(e, loc);
        }
        ExprData::EPrivateIdentifier(e @ E::PrivateIdentifier { ref_: _ }) => {
            visitor.visit_e_private_identifier(e, loc);
        }
        ExprData::ECommonjsExportIdentifier(e @ E::CommonJSExportIdentifier { ref_: _ }) => {
            visitor.visit_e_commonjs_export_identifier(e, loc);
        }
        ExprData::EBoolean(e @ E::Boolean { value: _ }) => visitor.visit_e_boolean(e, loc),
        ExprData::EBranchBoolean(e @ E::Boolean { value: _ }) => {
            visitor.visit_e_branch_boolean(e, loc);
        }
        ExprData::EBigInt(e) => {
            let E::BigInt { value: _ } = &**e;
            visitor.visit_e_big_int(e, loc);
        }
        ExprData::EString(e) => {
            let E::EString {
                data: _,
                next: _,
                end: _,
                rope_len: _,
                prefer_template: _,
                is_utf16: _,
                toml_datetime: _,
            } = &**e;
            visitor.visit_e_string(e, loc);
        }
        ExprData::ERequireString(
            e @ E::RequireString {
                import_record_index: _,
                unwrapped_id: _,
            },
        ) => visitor.visit_e_require_string(e, loc),
        ExprData::ERequireResolveString(
            e @ E::RequireResolveString {
                import_record_index: _,
            },
        ) => visitor.visit_e_require_resolve_string(e, loc),
        ExprData::ERequireCallTarget => visitor.visit_e_require_call_target(loc),
        ExprData::ERequireResolveCallTarget => visitor.visit_e_require_resolve_call_target(loc),
        ExprData::EMissing(e @ E::Missing) => visitor.visit_e_missing(e, loc),
        ExprData::EThis(e @ E::This) => visitor.visit_e_this(e, loc),
        ExprData::ESuper(e @ E::Super) => visitor.visit_e_super(e, loc),
        ExprData::ENull(e @ E::Null) => visitor.visit_e_null(e, loc),
        ExprData::EUndefined(e @ E::Undefined) => visitor.visit_e_undefined(e, loc),
        ExprData::ENewTarget(e @ E::NewTarget { range: _ }) => visitor.visit_e_new_target(e, loc),
        ExprData::EImportMeta(e @ E::ImportMeta) => visitor.visit_e_import_meta(e, loc),
        ExprData::EImportMetaMain(e @ E::ImportMetaMain { inverted: _ }) => {
            visitor.visit_e_import_meta_main(e, loc);
        }
        ExprData::ERequireMain => visitor.visit_e_require_main(loc),
        ExprData::ESpecial(e) => {
            match e {
                E::Special::ModuleExports
                | E::Special::HotEnabled
                | E::Special::HotDisabled
                | E::Special::HotData
                | E::Special::HotAccept
                | E::Special::HotAcceptVisited
                | E::Special::ResolvedSpecifierString(_) => {}
            }
            visitor.visit_e_special(e, loc);
        }
        ExprData::EInlinedEnum(e) => visitor.visit_e_inlined_enum(e, loc),
        ExprData::ENameOfSymbol(e) => {
            let E::NameOfSymbol {
                ref_: _,
                has_property_key_comment: _,
            } = &**e;
            visitor.visit_e_name_of_symbol(e, loc);
        }
    }
}

pub fn walk_binding<'ast, V: Visitor<'ast>>(visitor: &mut V, binding: &'ast Binding) {
    visitor.enter_binding(binding);
    let Binding { loc, data } = binding;
    let loc = *loc;
    match data {
        B::B::BIdentifier(b) => {
            let B::Identifier { r#ref: _ } = &**b;
            visitor.visit_b_identifier(b, loc);
        }
        B::B::BArray(b) => visitor.visit_b_array(b, loc),
        B::B::BObject(b) => visitor.visit_b_object(b, loc),
        B::B::BMissing(b @ B::Missing {}) => visitor.visit_b_missing(b, loc),
    }
}

#[inline]
pub fn walk_s_block<'ast, V: Visitor<'ast>>(visitor: &mut V, node: &'ast S::Block) {
    let S::Block {
        stmts,
        close_brace_loc: _,
    } = node;
    walk_stmts(visitor, stmts.slice());
}

#[inline]
pub fn walk_s_class<'ast, V: Visitor<'ast>>(visitor: &mut V, node: &'ast S::Class) {
    let S::Class {
        class,
        is_export: _,
    } = node;
    walk_class(visitor, class);
}

#[inline]
pub fn walk_s_do_while<'ast, V: Visitor<'ast>>(visitor: &mut V, node: &'ast S::DoWhile) {
    let S::DoWhile { body, test } = node;
    visitor.visit_stmt(body);
    visitor.visit_expr(test);
}

#[inline]
pub fn walk_s_enum<'ast, V: Visitor<'ast>>(visitor: &mut V, node: &'ast S::Enum) {
    let S::Enum {
        name: _,
        arg: _,
        values,
        is_export: _,
    } = node;
    for value in values.slice() {
        let EnumValue {
            loc: _,
            ref_: _,
            name: _,
            value,
        } = value;
        walk_optional_expr(visitor, value);
    }
}

#[inline]
pub fn walk_s_export_default<'ast, V: Visitor<'ast>>(
    visitor: &mut V,
    node: &'ast S::ExportDefault,
) {
    let S::ExportDefault {
        default_name: _,
        value,
    } = node;
    match value {
        StmtOrExpr::Stmt(stmt) => visitor.visit_stmt(stmt),
        StmtOrExpr::Expr(expr) => visitor.visit_expr(expr),
    }
}

#[inline]
pub fn walk_s_export_equals<'ast, V: Visitor<'ast>>(visitor: &mut V, node: &'ast S::ExportEquals) {
    let S::ExportEquals { value } = node;
    visitor.visit_expr(value);
}

#[inline]
pub fn walk_s_expr<'ast, V: Visitor<'ast>>(visitor: &mut V, node: &'ast S::SExpr) {
    let S::SExpr {
        value,
        does_not_affect_tree_shaking: _,
    } = node;
    visitor.visit_expr(value);
}

#[inline]
pub fn walk_s_for_in<'ast, V: Visitor<'ast>>(visitor: &mut V, node: &'ast S::ForIn) {
    let S::ForIn { init, value, body } = node;
    visitor.visit_stmt(init);
    visitor.visit_expr(value);
    visitor.visit_stmt(body);
}

#[inline]
pub fn walk_s_for_of<'ast, V: Visitor<'ast>>(visitor: &mut V, node: &'ast S::ForOf) {
    let S::ForOf {
        is_await: _,
        init,
        value,
        body,
    } = node;
    visitor.visit_stmt(init);
    visitor.visit_expr(value);
    visitor.visit_stmt(body);
}

#[inline]
pub fn walk_s_for<'ast, V: Visitor<'ast>>(visitor: &mut V, node: &'ast S::For) {
    let S::For {
        init,
        test,
        update,
        body,
    } = node;
    if let Some(init) = init {
        visitor.visit_stmt(init);
    }
    walk_optional_expr(visitor, test);
    walk_optional_expr(visitor, update);
    visitor.visit_stmt(body);
}

#[inline]
pub fn walk_s_function<'ast, V: Visitor<'ast>>(visitor: &mut V, node: &'ast S::Function) {
    let S::Function { func } = node;
    walk_fn(visitor, func);
}

#[inline]
pub fn walk_s_if<'ast, V: Visitor<'ast>>(visitor: &mut V, node: &'ast S::If) {
    let S::If { test, yes, no } = node;
    visitor.visit_expr(test);
    visitor.visit_stmt(yes);
    if let Some(no) = no {
        visitor.visit_stmt(no);
    }
}

#[inline]
pub fn walk_s_label<'ast, V: Visitor<'ast>>(visitor: &mut V, node: &'ast S::Label) {
    let S::Label { name: _, stmt } = node;
    visitor.visit_stmt(stmt);
}

#[inline]
pub fn walk_s_local<'ast, V: Visitor<'ast>>(visitor: &mut V, node: &'ast S::Local) {
    let S::Local {
        kind: _,
        decls,
        is_export: _,
        origin: _,
    } = node;
    for decl in decls.iter() {
        let G::Decl { binding, value } = decl;
        visitor.visit_binding(binding);
        walk_optional_expr(visitor, value);
    }
}

#[inline]
pub fn walk_s_namespace<'ast, V: Visitor<'ast>>(visitor: &mut V, node: &'ast S::Namespace) {
    let S::Namespace {
        name: _,
        arg: _,
        stmts,
        is_export: _,
    } = node;
    walk_stmts(visitor, stmts.slice());
}

#[inline]
pub fn walk_s_return<'ast, V: Visitor<'ast>>(visitor: &mut V, node: &'ast S::Return) {
    let S::Return { value } = node;
    walk_optional_expr(visitor, value);
}

#[inline]
pub fn walk_s_switch<'ast, V: Visitor<'ast>>(visitor: &mut V, node: &'ast S::Switch) {
    let S::Switch {
        test,
        body_loc: _,
        cases,
    } = node;
    visitor.visit_expr(test);
    for case in cases.slice() {
        let Case {
            loc: _,
            value,
            body,
        } = case;
        walk_optional_expr(visitor, value);
        walk_stmts(visitor, body.slice());
    }
}

#[inline]
pub fn walk_s_throw<'ast, V: Visitor<'ast>>(visitor: &mut V, node: &'ast S::Throw) {
    let S::Throw { value } = node;
    visitor.visit_expr(value);
}

#[inline]
pub fn walk_s_try<'ast, V: Visitor<'ast>>(visitor: &mut V, node: &'ast S::Try) {
    let S::Try {
        body_loc: _,
        body,
        catch,
        finally,
    } = node;
    walk_stmts(visitor, body.slice());
    if let Some(Catch {
        loc: _,
        binding,
        body,
        body_loc: _,
    }) = catch
    {
        if let Some(binding) = binding {
            visitor.visit_binding(binding);
        }
        walk_stmts(visitor, body.slice());
    }
    if let Some(Finally { loc: _, stmts }) = finally {
        walk_stmts(visitor, stmts.slice());
    }
}

#[inline]
pub fn walk_s_while<'ast, V: Visitor<'ast>>(visitor: &mut V, node: &'ast S::While) {
    let S::While { test, body } = node;
    visitor.visit_expr(test);
    visitor.visit_stmt(body);
}

#[inline]
pub fn walk_s_with<'ast, V: Visitor<'ast>>(visitor: &mut V, node: &'ast S::With) {
    let S::With {
        value,
        body,
        body_loc: _,
    } = node;
    visitor.visit_expr(value);
    visitor.visit_stmt(body);
}

#[inline]
pub fn walk_e_array<'ast, V: Visitor<'ast>>(visitor: &mut V, node: &'ast E::Array) {
    let E::Array {
        items,
        comma_after_spread: _,
        is_single_line: _,
        is_parenthesized: _,
        was_originally_macro: _,
        close_bracket_loc: _,
    } = node;
    walk_exprs(visitor, items);
}

#[inline]
pub fn walk_e_unary<'ast, V: Visitor<'ast>>(visitor: &mut V, node: &'ast E::Unary) {
    let E::Unary {
        op: _,
        value,
        flags: _,
    } = node;
    visitor.visit_expr(value);
}

/// Walks `right`, then `left` unless it is a binary expression: that one is returned, for the loop of [`walk_expr`].
#[inline]
#[must_use = "a left operand that is returned is not walked yet"]
pub fn walk_e_binary<'ast, V: Visitor<'ast>>(
    visitor: &mut V,
    node: &'ast E::Binary,
) -> Option<&'ast Expr> {
    let E::Binary { left, right, op: _ } = node;
    visitor.visit_expr(right);
    if matches!(left.data, ExprData::EBinary(_)) {
        return Some(left);
    }
    visitor.visit_expr(left);
    None
}

#[inline]
pub fn walk_e_class<'ast, V: Visitor<'ast>>(visitor: &mut V, node: &'ast E::Class) {
    walk_class(visitor, node);
}

#[inline]
pub fn walk_e_new<'ast, V: Visitor<'ast>>(visitor: &mut V, node: &'ast E::New) {
    let E::New {
        target,
        args,
        can_be_unwrapped_if_unused: _,
        close_parens_loc: _,
    } = node;
    visitor.visit_expr(target);
    walk_exprs(visitor, args);
}

#[inline]
pub fn walk_e_function<'ast, V: Visitor<'ast>>(visitor: &mut V, node: &'ast E::Function) {
    let E::Function { func } = node;
    walk_fn(visitor, func);
}

#[inline]
pub fn walk_e_call<'ast, V: Visitor<'ast>>(visitor: &mut V, node: &'ast E::Call) {
    let E::Call {
        target,
        args,
        optional_chain: _,
        is_direct_eval: _,
        close_paren_loc: _,
        can_be_unwrapped_if_unused: _,
        was_jsx_element: _,
    } = node;
    visitor.visit_expr(target);
    walk_exprs(visitor, args);
}

#[inline]
pub fn walk_e_dot<'ast, V: Visitor<'ast>>(visitor: &mut V, node: &'ast E::Dot) {
    let E::Dot {
        target,
        name: _,
        name_loc: _,
        optional_chain: _,
        can_be_removed_if_unused: _,
        call_can_be_unwrapped_if_unused: _,
        is_import_property_use: _,
    } = node;
    visitor.visit_expr(target);
}

#[inline]
pub fn walk_e_index<'ast, V: Visitor<'ast>>(visitor: &mut V, node: &'ast E::Index) {
    let E::Index {
        index,
        target,
        optional_chain: _,
        is_import_property_use: _,
    } = node;
    visitor.visit_expr(target);
    visitor.visit_expr(index);
}

#[inline]
pub fn walk_e_arrow<'ast, V: Visitor<'ast>>(visitor: &mut V, node: &'ast E::Arrow) {
    let E::Arrow {
        args,
        body,
        is_async: _,
        has_rest_arg: _,
        prefer_expr: _,
        has_react_hooks_suppression: _,
    } = node;
    walk_args(visitor, args.slice());
    walk_fn_body(visitor, body);
}

#[inline]
pub fn walk_e_jsx_element<'ast, V: Visitor<'ast>>(visitor: &mut V, node: &'ast E::JSXElement) {
    let E::JSXElement {
        tag,
        properties,
        children,
        key_prop_index: _,
        flags: _,
        close_tag_loc: _,
    } = node;
    walk_optional_expr(visitor, tag);
    for property in properties.iter() {
        walk_property(visitor, property);
    }
    walk_exprs(visitor, children);
}

#[inline]
pub fn walk_e_object<'ast, V: Visitor<'ast>>(visitor: &mut V, node: &'ast E::Object) {
    let E::Object {
        properties,
        comma_after_spread: _,
        is_single_line: _,
        is_parenthesized: _,
        was_originally_macro: _,
        close_brace_loc: _,
    } = node;
    for property in properties.iter() {
        walk_property(visitor, property);
    }
}

#[inline]
pub fn walk_e_spread<'ast, V: Visitor<'ast>>(visitor: &mut V, node: &'ast E::Spread) {
    let E::Spread { value } = node;
    visitor.visit_expr(value);
}

#[inline]
pub fn walk_e_template<'ast, V: Visitor<'ast>>(visitor: &mut V, node: &'ast E::Template) {
    let E::Template {
        tag,
        parts,
        head: _,
    } = node;
    walk_optional_expr(visitor, tag);
    for part in parts.slice() {
        let E::TemplatePart {
            value,
            tail_loc: _,
            tail: _,
        } = part;
        visitor.visit_expr(value);
    }
}

#[inline]
pub fn walk_e_await<'ast, V: Visitor<'ast>>(visitor: &mut V, node: &'ast E::Await) {
    let E::Await { value } = node;
    visitor.visit_expr(value);
}

#[inline]
pub fn walk_e_yield<'ast, V: Visitor<'ast>>(visitor: &mut V, node: &'ast E::Yield) {
    let E::Yield { value, is_star: _ } = node;
    walk_optional_expr(visitor, value);
}

#[inline]
pub fn walk_e_if<'ast, V: Visitor<'ast>>(visitor: &mut V, node: &'ast E::If) {
    let E::If { test, yes, no } = node;
    visitor.visit_expr(test);
    visitor.visit_expr(yes);
    visitor.visit_expr(no);
}

#[inline]
pub fn walk_e_import<'ast, V: Visitor<'ast>>(visitor: &mut V, node: &'ast E::Import) {
    let E::Import {
        expr,
        options,
        import_record_index: _,
        namespace_ref: _,
    } = node;
    visitor.visit_expr(expr);
    visitor.visit_expr(options);
}

#[inline]
pub fn walk_e_inlined_enum<'ast, V: Visitor<'ast>>(visitor: &mut V, node: &'ast E::InlinedEnum) {
    let E::InlinedEnum { value, comment: _ } = node;
    visitor.visit_expr(value);
}

#[inline]
pub fn walk_b_array<'ast, V: Visitor<'ast>>(visitor: &mut V, node: &'ast B::Array) {
    let B::Array {
        items,
        has_spread: _,
        is_single_line: _,
    } = node;
    for item in items.slice() {
        let ArrayBinding {
            binding,
            default_value,
        } = item;
        visitor.visit_binding(binding);
        walk_optional_expr(visitor, default_value);
    }
}

#[inline]
pub fn walk_b_object<'ast, V: Visitor<'ast>>(visitor: &mut V, node: &'ast B::Object) {
    let B::Object {
        properties,
        is_single_line: _,
    } = node;
    for property in properties.slice() {
        let B::Property {
            flags: _,
            key,
            value,
            default_value,
        } = property;
        visitor.visit_expr(key);
        visitor.visit_binding(value);
        walk_optional_expr(visitor, default_value);
    }
}

#[inline]
fn walk_stmts<'ast, V: Visitor<'ast>>(visitor: &mut V, stmts: &'ast [Stmt]) {
    for stmt in stmts {
        visitor.visit_stmt(stmt);
    }
}

#[inline]
fn walk_exprs<'ast, V: Visitor<'ast>>(visitor: &mut V, exprs: &'ast [Expr]) {
    for expr in exprs {
        visitor.visit_expr(expr);
    }
}

#[inline]
fn walk_optional_expr<'ast, V: Visitor<'ast>>(visitor: &mut V, expr: &'ast Option<Expr>) {
    if let Some(expr) = expr {
        visitor.visit_expr(expr);
    }
}

#[inline]
fn walk_decorators<'ast, V: Visitor<'ast>>(visitor: &mut V, decorators: &'ast [Expr]) {
    for decorator in decorators {
        visitor.visit_decorator(decorator);
    }
}

#[inline]
fn walk_args<'ast, V: Visitor<'ast>>(visitor: &mut V, args: &'ast [G::Arg]) {
    for arg in args {
        let G::Arg {
            ts_decorators,
            binding,
            default,
            is_typescript_ctor_field: _,
            ts_metadata: _,
        } = arg;
        walk_decorators(visitor, ts_decorators);
        visitor.visit_binding(binding);
        walk_optional_expr(visitor, default);
    }
}

#[inline]
fn walk_fn_body<'ast, V: Visitor<'ast>>(visitor: &mut V, body: &'ast G::FnBody) {
    let G::FnBody { loc: _, stmts } = body;
    walk_stmts(visitor, stmts.slice());
}

#[inline]
fn walk_fn<'ast, V: Visitor<'ast>>(visitor: &mut V, func: &'ast G::Fn) {
    let G::Fn {
        name: _,
        open_parens_loc: _,
        args,
        body,
        arguments_ref: _,
        flags: _,
        return_ts_metadata: _,
    } = func;
    walk_args(visitor, args.slice());
    walk_fn_body(visitor, body);
}

#[inline]
fn walk_class<'ast, V: Visitor<'ast>>(visitor: &mut V, class: &'ast G::Class) {
    let G::Class {
        class_keyword: _,
        ts_decorators,
        class_name: _,
        extends,
        body_loc: _,
        close_brace_loc: _,
        properties,
        has_decorators: _,
        should_lower_standard_decorators: _,
    } = class;
    walk_decorators(visitor, ts_decorators);
    walk_optional_expr(visitor, extends);
    for property in properties.slice() {
        walk_property(visitor, property);
    }
}

#[inline]
fn walk_property<'ast, V: Visitor<'ast>>(visitor: &mut V, property: &'ast G::Property) {
    let G::Property {
        initializer,
        kind: _,
        flags: _,
        class_static_block,
        ts_decorators,
        key,
        value,
        ts_metadata: _,
    } = property;
    walk_decorators(visitor, ts_decorators);
    walk_optional_expr(visitor, key);
    walk_optional_expr(visitor, value);
    walk_optional_expr(visitor, initializer);
    if let Some(block) = class_static_block {
        let G::ClassStaticBlock { stmts, loc: _ } = &**block;
        walk_stmts(visitor, stmts);
    }
}
