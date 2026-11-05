//! Functions, methods and parameters (function.js, function-parameters.js).

use crate::arena::SUB_SHIFT;
use crate::ast::{
    EXT_AT, F_ASYNC, F_CHAIN, F_COMPUTED, F_EXT, F_GENERATOR, F_METHOD, F_OPTIONAL, F_REST,
    F_STATIC, F_THIS, FN_PREDICATE, FN_RETURN_TYPE, FN_TYPE_PARAMETERS, M_GET, M_MASK, M_SET,
    MOD_DECLARE, TO_KEYOF, V_CONST, V_MASK, k,
};
use crate::options::TRAILING_COMMA_ALL;
use crate::print::core::{ARG_EXPAND_LAST, ARG_SHARE};
use crate::print::statics::{
    _ARROW_, ASYNC_, COLON_SPACE, COMMA, DECLARE_, ELLIPSIS, FUNCTION, GET_, HOOK, LPAREN,
    QUESTION, RPAREN, SEMI, SET_, SPACE, STAR,
};
use crate::{Quick, R, Words, rare};

impl Quick {
    pub(crate) fn should_hug_the_only_function_parameter(&self, fn_: i32) -> bool {
        if fn_ == 0 {
            return false;
        }
        let params = self.n.at(fn_ + 6);
        if self.n.at(params) != 1 {
            return false;
        }
        let parameter = self.n.at(params + 1);
        if self.has_comment(parameter) {
            return false;
        }
        let k = self.n.at(parameter) & 0xff;
        if k == k::ObjectPattern || k == k::ArrayPattern {
            return true;
        }
        if k == k::Identifier {
            if (self.n.at(parameter) & F_EXT) == 0 {
                return false;
            }
            let annotation = self.n.at(parameter + 4);
            return annotation != 0 && self.is_object_type(self.n.at(annotation + 4));
        }
        if k == k::FunctionTypeParam {
            return self.is_object_type(self.n.at(parameter + 5))
                && (self.n.at(parameter) & F_REST) == 0;
        }
        if k == k::AssignmentPattern {
            let lk = self.n.at(self.n.at(parameter + 4)) & 0xff;
            if lk != k::ObjectPattern && lk != k::ArrayPattern {
                return false;
            }
            let right = self.n.at(parameter + 5);
            let rk = self.n.at(right) & 0xff;
            return rk == k::Identifier
                || ((rk == k::ObjectExpression || rk == k::ArrayExpression)
                    && self.n.at(self.n.at(right + 4)) == 0);
        }
        return false;
    }

    pub(crate) fn is_decorated_function(&self, fn_: i32) -> bool {
        if (self.n.at(fn_) & 0xff) != k::ArrowFunctionExpression
            || (self.n.at(self.n.at(fn_ + 5)) & 0xff) != k::BlockStatement
        {
            return false;
        }
        let call_node = self.n.at(fn_ + 3);
        if (self.n.at(call_node) & (0xff | F_CHAIN)) != k::CallExpression
            || self.n.at(call_node + 4) == fn_
            || self.n.at(self.n.at(call_node + 5)) != 1
        {
            return false;
        }
        let callee = self.n.at(call_node + 4);
        if (self.n.at(callee) & (0xff | F_CHAIN)) != k::CallExpression {
            return false;
        }
        let decorator = self.n.at(callee + 4);
        let dk = self.n.at(decorator) & 0xff;
        if !(dk == k::Identifier
            || ((self.n.at(decorator) & (0xff | F_CHAIN | F_COMPUTED)) == k::MemberExpression
                && (self.n.at(self.n.at(decorator + 4)) & 0xff) == k::Identifier
                && (self.n.at(self.n.at(decorator + 5)) & 0xff) == k::Identifier))
        {
            return false;
        }
        let owner = self.n.at(call_node + 3);
        let ok = self.n.at(owner) & 0xff;
        let mut matches = false;
        if ok == k::VariableDeclarator {
            matches = self.n.at(owner + 5) == call_node;
        } else if ok == k::ExportDefaultDeclaration || ok == k::ExportAssignment {
            matches = true;
        } else if ok == k::AssignmentExpression && self.n.at(owner + 5) == call_node {
            let left = self.n.at(owner + 4);
            matches = (self.n.at(left) & (0xff | F_CHAIN)) == k::MemberExpression
                && self.is_identifier_named(self.n.at(left + 4), b"module")
                && self.is_identifier_named(self.n.at(left + 5), b"exports");
        }
        if !matches {
            return false;
        }
        let above = self.n.at(owner + 3);
        return (self.n.at(above) & 0xff) != k::VariableDeclaration
            || ((((self.n.at(above) as u32) >> SUB_SHIFT) as i32 & V_MASK) == V_CONST
                && self.n.at(self.n.at(above + 4)) == 1);
    }

    /// The `rest` of a function type or component type of Flow, which is not a RestElement.
    pub(crate) fn is_flow_rest_parameter(&self, parameter: i32) -> bool {
        let k = self.n.at(parameter) & 0xff;
        return (k == k::FunctionTypeParam || k == k::ComponentTypeParameter)
            && (self.n.at(parameter) & F_REST) != 0;
    }

    pub(crate) fn is_flow_object_type_property_a_function(&self, n: i32) -> bool {
        let k = self.n.at(n) & 0xff;
        if k != k::ObjectTypeProperty && k != k::ObjectTypeInternalSlot {
            return false;
        }
        if (self.n.at(n) & (F_STATIC | F_METHOD)) != 0
            || (k == k::ObjectTypeProperty
                && (((self.n.at(n) as u32) >> SUB_SHIFT) as i32 & M_MASK) != 0)
        {
            return false;
        }
        return (self.n.at(self.n.at(n + 5)) & 0xff) == k::FunctionType;
    }

    /// `string => void`: a function type of Flow whose only parameter is a simple type without a name.
    /// `(A) => B`
    fn has_one_simple_type_as_parameters(&self, fn_: i32, params: i32) -> bool {
        if self.n.at(params) != 1 || self.n.at(fn_ + FN_TYPE_PARAMETERS) != 0 {
            return false;
        }
        let parameter = self.n.at(params + 1);
        (self.n.at(parameter) & 0xff) == k::FunctionTypeParam
            && self.n.at(parameter + 4) == 0
            && (self.n.at(parameter) & (F_THIS | F_REST)) == 0
            && self.is_simple_type(self.n.at(parameter + 5))
    }

    pub(crate) fn is_flow_shorthand_with_one_arg(&self, fn_: i32, params: i32) -> bool {
        if !self.has_one_simple_type_as_parameters(fn_, params) {
            return false;
        }
        let parent = self.n.at(fn_ + 3);
        match self.n.at(parent) & 0xff {
            k::TypeAlias => {
                // (a DeclareTypeAlias is none)
                return (((self.n.at(parent) as u32) >> SUB_SHIFT) as i32 & MOD_DECLARE) == 0;
            }
            k::UnionType | k::IntersectionType => {
                return true;
            }
            k::FunctionType => {
                return self.n.at(parent + FN_RETURN_TYPE) == fn_;
            }
            k::TypeAnnotation => {
                // isTypeAnnotationAFunction
                return self.n.at(parent + 1) != self.n.at(fn_ + 1)
                    && (self.n.at(fn_) & 0xff) == k::FunctionType;
            }
            _ => {}
        }
        return self.is_flow_object_type_property_a_function(parent);
    }

    pub(crate) fn print_parameter_list(&mut self, params: i32, separator_is_space: bool) -> R<()> {
        let count = self.n.at(params);
        let mut i: i32 = 1;
        while i <= count {
            let parameter = self.n.at(params + i);
            if i == count && self.is_flow_rest_parameter(parameter) {
                self.text(ELLIPSIS);
            }
            self.print(parameter)?;
            if i == count {
                break;
            }
            self.text(COMMA);
            if separator_is_space {
                self.text(SPACE);
            } else if self.is_next_line_empty(parameter) {
                self.hardline();
                self.hardline();
            } else {
                self.line();
            }
            i += 1;
        }
        Ok(())
    }

    pub(crate) fn has_parameter_decorator(&self, params: i32) -> bool {
        let mut i: i32 = 1;
        while i <= self.n.at(params) {
            let parameter = self.n.at(params + i);
            let k = self.n.at(parameter) & 0xff;
            if k == k::ParameterProperty {
                if self.n.at(self.n.at(parameter + 5)) > 0 {
                    return true;
                }
            } else if (self.n.at(parameter) & F_EXT) != 0
                && EXT_AT.at(k) != 0
                && self.n.at(self.n.at(parameter + EXT_AT.at(k) + 1)) > 0
            {
                return true;
            }
            i += 1;
        }
        return false;
    }

    pub(crate) fn print_function_parameters(
        &mut self,
        fn_: i32,
        should_expand_parameters: bool,
        should_print_type_parameters: bool,
    ) -> R<()> {
        let params = self.n.at(fn_ + 6);
        let count = self.n.at(params);
        let type_parameters = if should_print_type_parameters {
            self.n.at(fn_ + FN_TYPE_PARAMETERS)
        } else {
            0
        };
        if count == 0 {
            self.print(type_parameters)?;
            self.text(LPAREN);
            self.print_dangling_comments_in_list(fn_);
            self.text(RPAREN);
            return Ok(());
        }
        let is_parameters_in_test_call = self.is_test_call(self.n.at(fn_ + 3), 0)?;
        let should_hug = self.should_hug_the_only_function_parameter(fn_);
        if should_expand_parameters && !self.is_decorated_function(fn_) {
            let g = self.group_open();
            let breaks = self.doc.wb_count;
            if type_parameters != 0 {
                self.remove_lines_open();
                self.print(type_parameters)?;
                self.remove_lines_close();
            }
            self.text(LPAREN);
            self.remove_lines_open();
            self.print_parameter_list(params, is_parameters_in_test_call || should_hug)?;
            self.remove_lines_close();
            if self.doc.wb_count != breaks {
                self.set_bailout(true);
            }
            self.text(RPAREN);
            self.group_close(g);
            return Ok(());
        }
        self.print(type_parameters)?;
        if (should_hug && !self.has_parameter_decorator(params)) || is_parameters_in_test_call {
            self.text(LPAREN);
            self.print_parameter_list(params, true)?;
            self.text(RPAREN);
            return Ok(());
        }
        if self.mode.is_flow && self.is_flow_shorthand_with_one_arg(fn_, params) {
            let parens = self.options.arrow_parens_always
                || (self.n.at(fn_) & 0xff) == k::HookTypeAnnotation;
            if parens {
                self.text(LPAREN);
            }
            self.print_parameter_list(params, false)?;
            if parens {
                self.text(RPAREN);
            }
            return Ok(());
        }
        if self.mode.is_flow
            && !self.options.arrow_parens_always
            && matches!(
                self.n.at(self.n.at(fn_ + 3)) & 0xff,
                k::ObjectTypeIndexer | k::ObjectTypeSpreadProperty
            )
            && self.has_one_simple_type_as_parameters(fn_, params)
        {
            return Err(self.rare(rare::FLOW));
        }
        self.text(LPAREN);
        self.indent_softline();
        self.print_parameter_list(params, should_hug)?;
        if self.options.trailing_comma == TRAILING_COMMA_ALL
            && (self.n.at(self.n.at(params + count)) & 0xff) != k::RestElement
            && !self.is_flow_rest_parameter(self.n.at(params + count))
        {
            self.if_break_text(COMMA, 0, 0);
        }
        self.dedent_softline();
        self.text(RPAREN);
        Ok(())
    }

    pub(crate) fn print_body(&mut self, body: i32, args: i32) -> R<()> {
        if (args & ARG_SHARE) != 0 {
            self.print_shared(body)?;
        } else {
            self.print(body)?;
        }
        Ok(())
    }

    pub(crate) fn print_function(&mut self, n: i32, args: i32) -> R<()> {
        let mut should_expand_parameters = false;
        if (self.n.at(n) & 0xff) == k::FunctionExpression && (args & ARG_EXPAND_LAST) != 0 {
            let parent = self.n.at(n + 3);
            if (self.n.at(parent) & 0xff) == k::CallExpression {
                if self.n.at(self.n.at(parent + 5)) > 1 {
                    should_expand_parameters = true;
                } else {
                    should_expand_parameters = true;
                    let params = self.n.at(n + 6);
                    let mut i: i32 = 1;
                    while i <= self.n.at(params) {
                        let parameter = self.n.at(params + i);
                        if (self.n.at(parameter) & 0xff) != k::Identifier
                            || ((self.n.at(parameter) & F_EXT) != 0
                                && self.n.at(parameter + 4) != 0)
                        {
                            should_expand_parameters = false;
                        }
                        i += 1;
                    }
                }
            }
        }
        let is_declared = (((self.n.at(n) as u32) >> SUB_SHIFT) as i32 & MOD_DECLARE) != 0;
        if is_declared {
            self.text(DECLARE_);
        }
        if (self.n.at(n) & F_ASYNC) != 0 {
            self.text(ASYNC_);
        }
        self.text(if (self.n.at(n) & 0xff) == k::HookDeclaration {
            HOOK
        } else {
            FUNCTION
        });
        if (self.n.at(n) & F_GENERATOR) != 0 {
            self.text(STAR);
        }
        self.text(SPACE);
        self.print(self.n.at(n + 4))?;
        self.print(self.n.at(n + FN_TYPE_PARAMETERS))?;
        let g = self.group_open();
        self.print_parameters_and_return_type(n, should_expand_parameters, false, false, false)?;
        if self.print.bailout {
            return Ok(());
        }
        self.group_close(g);
        if self.n.at(n + 5) != 0 {
            self.text(SPACE);
            self.print_body(self.n.at(n + 5), args)?;
        }
        if self.options.semi && (is_declared || self.n.at(n + 5) == 0) {
            self.text(SEMI);
        }
        Ok(())
    }

    /// Is the function type or hook type `fn` of Flow written with `=>`, and not like a method?
    pub(crate) fn is_flow_arrow_function_type(&self, fn_: i32, k: i32) -> bool {
        let parent = self.n.at(fn_ + 3);
        let declaration = self.n.at(self.n.at(self.n.at(parent + 3) + 3)) & 0xff;
        if k == k::HookTypeAnnotation {
            return declaration != k::DeclareHook
                || (self.n.at(parent) & 0xff) != k::TypeAnnotation;
        }
        if self.is_flow_object_type_property_a_function(parent) {
            return true;
        }
        let pk = self.n.at(parent) & 0xff;
        if pk == k::ObjectTypeCallProperty {
            return false;
        }
        if pk == k::ObjectTypeProperty {
            return !(self.n.at(parent + 6) == 0
                && (self.n.at(parent) & F_OPTIONAL) == 0
                && self.n.at(parent + 1) == self.n.at(fn_ + 1));
        }
        if pk == k::ObjectTypeInternalSlot {
            return !((self.n.at(parent) & F_OPTIONAL) == 0
                && self.n.at(parent + 1) == self.n.at(fn_ + 1));
        }
        return !(pk == k::TypeAnnotation && declaration == k::DeclareFunction);
    }

    /// print_return_type
    pub(crate) fn print_return_type(&mut self, fn_: i32) -> R<()> {
        if self.mode.is_flow {
            let k = self.n.at(fn_) & 0xff;
            if k == k::FunctionType || k == k::HookTypeAnnotation {
                self.text(if self.is_flow_arrow_function_type(fn_, k) {
                    _ARROW_
                } else {
                    COLON_SPACE
                });
                self.print(self.n.at(fn_ + FN_RETURN_TYPE))?;
                return Ok(());
            }
        }
        self.print_type_annotation_property(self.n.at(fn_ + FN_RETURN_TYPE))?;
        self.print(self.n.at(fn_ + FN_PREDICATE))?;
        Ok(())
    }

    /// All of shouldGroupFunctionParameters() that does not look at the return type.
    pub(crate) fn may_group_function_parameters(&self, fn_: i32) -> bool {
        if self.n.at(self.n.at(fn_ + 6)) != 1 {
            return false;
        }
        let type_parameters = self.n.at(fn_ + FN_TYPE_PARAMETERS);
        if type_parameters != 0 {
            let list = self.n.at(type_parameters + 4);
            if self.n.at(list) > 1 {
                return false;
            }
            if self.n.at(list) == 1 {
                let parameter = self.n.at(list + 1);
                // the bound of a type parameter of Flow is no `constraint`
                if (self.n.at(parameter + 5) != 0 && !self.mode.is_flow)
                    || self.n.at(parameter + 6) != 0
                {
                    return false;
                }
            }
        }
        return true;
    }

    pub(crate) fn should_break_function_parameters(&self, fn_: i32) -> bool {
        let params = self.n.at(fn_ + 6);
        if self.n.at(params) <= 1 {
            return false;
        }
        let mut i: i32 = 1;
        while i <= self.n.at(params) {
            if (self.n.at(self.n.at(params + i)) & 0xff) == k::ParameterProperty {
                return true;
            }
            i += 1;
        }
        return false;
    }

    /// The parameters and the return type. The parameters are in a group of their own if there is one of them and the return type is
    /// an object type or breaks (shouldGroupFunctionParameters): then the return type breaks first.
    ///
    /// An object type that breaks because it does not fit is broken in what is printed, so the next time the answer is another one
    /// (prettier#19968). The long way prints at once what is printed from then on. Here the objects in question are marked.
    pub(crate) fn print_parameters_and_return_type(
        &mut self,
        fn_: i32,
        should_expand_parameters: bool,
        should_print_type_parameters: bool,
        should_break: bool,
        group_return_type: bool,
    ) -> R<()> {
        let return_type = self.n.at(fn_ + FN_RETURN_TYPE);
        let mut should_group = false;
        let mut printed_return_type: i32 = 0;
        if return_type != 0 && !should_break && self.may_group_function_parameters(fn_) {
            // getReturnTypeNode: `return_type.type_annotation`, if there is one
            let mut type_ = return_type;
            let rk = self.n.at(return_type) & 0xff;
            if rk == k::TypeAnnotation
                || rk == k::NullableType
                || (rk == k::TypeOperator
                    && ((self.n.at(return_type) as u32) >> SUB_SHIFT) as i32 != TO_KEYOF)
            {
                type_ = self.n.at(return_type + 4);
            } else if rk == k::TypePredicate && self.n.at(return_type + 5) != 0 {
                type_ = self.n.at(return_type + 5);
            }
            if self.is_object_type(type_) {
                if rk == k::NullableType {
                    return Err(self.rare(rare::FLOW));
                }
                should_group = true;
            } else {
                self.doc.depends_on_what_breaks += 1;
                let h = self.detach_open();
                self.print_return_type(fn_)?;
                printed_return_type = self.detach_close(h);
                should_group = self.doc_will_break(printed_return_type);
                if should_group {
                    self.doc.depends_on_what_breaks -= 1;
                }
            }
        }
        let depends_on_what_breaks = printed_return_type != 0 && !should_group;
        let g = if should_break || should_group {
            self.group_open()
        } else {
            0
        };
        self.print_function_parameters(
            fn_,
            should_expand_parameters,
            should_print_type_parameters,
        )?;
        if depends_on_what_breaks {
            self.doc.depends_on_what_breaks -= 1;
        }
        if self.print.bailout {
            return Ok(());
        }
        if should_break || should_group {
            self.group_close_with(g, should_break, 0);
        }
        if return_type == 0 && self.n.at(fn_ + FN_PREDICATE) == 0 {
            return Ok(());
        }
        let rg = if group_return_type {
            self.group_open()
        } else {
            0
        };
        if printed_return_type != 0 {
            self.call(printed_return_type);
        } else {
            self.print_return_type(fn_)?;
        }
        if group_return_type {
            self.group_close(rg);
        }
        Ok(())
    }

    pub(crate) fn print_method_value(&mut self, n: i32) -> R<()> {
        self.print(self.n.at(n + FN_TYPE_PARAMETERS))?;
        let g = self.group_open();
        self.print_parameters_and_return_type(
            n,
            false,
            false,
            self.should_break_function_parameters(n),
            false,
        )?;
        self.group_close(g);
        if self.n.at(n + 5) != 0 {
            self.text(SPACE);
            self.print(self.n.at(n + 5))?;
        } else if self.options.semi {
            self.text(SEMI);
        }
        Ok(())
    }

    /// ObjectMethod and ClassMethod, from `async` / `get` on.
    pub(crate) fn print_method(&mut self, n: i32) -> R<()> {
        let head = self.n.at(n);
        let method = ((head as u32) >> SUB_SHIFT) as i32 & M_MASK;
        if method == M_GET {
            self.text(GET_);
        } else if method == M_SET {
            self.text(SET_);
        } else if (head & F_ASYNC) != 0 {
            self.text(ASYNC_);
        }
        if (head & F_GENERATOR) != 0 {
            self.text(STAR);
        }
        self.print_key(n)?;
        if (head & F_OPTIONAL) != 0 {
            self.text(QUESTION);
        }
        self.print_method_value(n)?;
        Ok(())
    }

    pub(crate) fn can_print_params_without_parens(&self, fn_: i32) -> bool {
        let params = self.n.at(fn_ + 6);
        if self.n.at(params) != 1 || self.has_dangling_comment(fn_) {
            return false;
        }
        let parameter = self.n.at(params + 1);
        return (self.n.at(parameter) & (0xff | F_EXT | F_OPTIONAL)) == k::Identifier
            && !self.has_comment(parameter)
            && self.n.at(fn_ + FN_TYPE_PARAMETERS) == 0
            && self.n.at(fn_ + FN_RETURN_TYPE) == 0
            && self.n.at(fn_ + FN_PREDICATE) == 0;
    }
}
