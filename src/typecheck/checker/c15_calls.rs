// checker.go:8407-10131 (layers E-DECOR, T-SIGSHAPE): the functions of 8833-8888, 9273-9302 and 9721-9737: the resolution of a decorator as a call, the argument count of a decorator and the rest type of a signature.
use crate::ast::{
    Arg, Kind, NodeId, can_have_decorators, has_accessor_modifier, is_parenthesized_expression,
};
use crate::checker::{
    CheckMode, Checker, SignatureFlags, SignatureId, SignatureKind, TypeId, is_tuple_type,
    signature_has_rest_parameter,
};
use crate::core::List;
use crate::diagnostics::{self, MessageId};
use crate::scanner::get_text_of_node;

impl<'a> Checker<'a> {
    pub fn resolve_decorator(
        &mut self,
        node: NodeId,
        candidates_out_array: Option<&mut Vec<SignatureId>>,
        check_mode: CheckMode,
    ) -> SignatureId {
        let a = self.ast;
        if !can_have_decorators(a, a.parent(node)) {
            return self.resolve_error_call(node);
        }
        let func_type = self.check_expression(a.expression(node));
        let apparent_type = self.get_apparent_type(func_type);
        if self.is_error_type(apparent_type) {
            return self.resolve_error_call(node);
        }
        let call_signatures = self.get_signatures_of_type(apparent_type, SignatureKind::CALL);
        let num_construct_signatures = self
            .get_signatures_of_type(apparent_type, SignatureKind::CONSTRUCT)
            .len();
        if self.is_untyped_function_call(
            func_type,
            apparent_type,
            call_signatures.len(),
            num_construct_signatures,
        ) {
            return self.resolve_untyped_call(node);
        }
        if self.is_potentially_uncalled_decorator(node, call_signatures)
            && !is_parenthesized_expression(a, a.expression(node))
        {
            let node_str = get_text_of_node(a, a.expression(node));
            self.error(
                node,
                diagnostics::X_0_ACCEPTS_TOO_FEW_ARGUMENTS_TO_BE_USED_AS_A_DECORATOR_HERE_DID_YOU_MEAN_TO_CALL_IT_FIRST_AND_WRITE_0,
                &[Arg::Str(&node_str)],
            );
            return self.resolve_error_call(node);
        }
        let head_message = self.get_diagnostic_head_message_for_decorator_resolution(node);
        if call_signatures.len() == 0 {
            let details = self.invocation_error_details(
                a.expression(node),
                apparent_type,
                SignatureKind::CALL,
            );
            let diag = self
                .diagnostic_store
                .new_diagnostic_chain(details, head_message, &[]);
            let diag = self.add_diagnostic(diag);
            self.invocation_error_recovery(apparent_type, SignatureKind::CALL, diag);
            return self.resolve_error_call(node);
        }
        let decorator_signature = self.get_decorator_call_signature(node);
        if decorator_signature.is_nil() {
            return self.resolve_error_call(node);
        }
        self.resolve_call(
            node,
            call_signatures,
            candidates_out_array,
            check_mode,
            SignatureFlags::NONE,
            head_message,
        )
    }

    // Sometimes, we have a decorator that could accept zero arguments, but is receiving too many arguments as part of the decorator invocation. In those cases, a user may have meant to *call* the expression before using it as a decorator.
    pub fn is_potentially_uncalled_decorator(
        &mut self,
        decorator: NodeId,
        signatures: List<'_, SignatureId>,
    ) -> bool {
        if signatures.len() == 0 {
            return false;
        }
        for &sig in signatures.as_slice() {
            if self.signatures[sig].min_argument_count != 0
                || signature_has_rest_parameter(self, sig)
            {
                return false;
            }
            let parameter_count = self.signatures[sig].parameters.len();
            if parameter_count >= self.get_decorator_argument_count(decorator, sig) {
                return false;
            }
        }
        true
    }

    // Gets the localized diagnostic head message to use for errors when resolving a decorator as a call expression.
    pub fn get_diagnostic_head_message_for_decorator_resolution(&self, node: NodeId) -> MessageId {
        match self.ast.kind(self.ast.parent(node)) {
            Kind::ClassDeclaration | Kind::ClassExpression => {
                diagnostics::UNABLE_TO_RESOLVE_SIGNATURE_OF_CLASS_DECORATOR_WHEN_CALLED_AS_AN_EXPRESSION
            }
            Kind::Parameter => {
                diagnostics::UNABLE_TO_RESOLVE_SIGNATURE_OF_PARAMETER_DECORATOR_WHEN_CALLED_AS_AN_EXPRESSION
            }
            Kind::PropertyDeclaration => {
                diagnostics::UNABLE_TO_RESOLVE_SIGNATURE_OF_PROPERTY_DECORATOR_WHEN_CALLED_AS_AN_EXPRESSION
            }
            Kind::MethodDeclaration | Kind::GetAccessor | Kind::SetAccessor => {
                diagnostics::UNABLE_TO_RESOLVE_SIGNATURE_OF_METHOD_DECORATOR_WHEN_CALLED_AS_AN_EXPRESSION
            }
            _ => {
                let _: () = self
                    .fail("Unhandled case in getDiagnosticHeadMessageForDecoratorResolution");
                MessageId::NIL
            }
        }
    }

    pub fn get_decorator_argument_count(&mut self, node: NodeId, signature: SignatureId) -> isize {
        if self.compiler_options.experimental_decorators.is_true() {
            return self.get_legacy_decorator_argument_count(node, signature);
        }
        self.get_parameter_count(signature).clamp(1, 2)
    }

    // Returns the argument count for a decorator node that works like a function invocation.
    pub fn get_legacy_decorator_argument_count(
        &self,
        node: NodeId,
        signature: SignatureId,
    ) -> isize {
        let a = self.ast;
        match a.kind(a.parent(node)) {
            Kind::ClassDeclaration | Kind::ClassExpression => 1,
            Kind::PropertyDeclaration => {
                if has_accessor_modifier(a, a.parent(node)) {
                    return 3;
                }
                2
            }
            Kind::MethodDeclaration | Kind::GetAccessor | Kind::SetAccessor => {
                // For decorators with only two parameters we supply only two arguments
                if self.signatures[signature].parameters.len() <= 2 {
                    return 2;
                }
                3
            }
            Kind::Parameter => 3,
            _ => self.fail("Unhandled case in getLegacyDecoratorArgumentCount"),
        }
    }

    pub fn get_rest_type_of_signature(&mut self, signature: SignatureId) -> TypeId {
        let rest_type = self.try_get_rest_type_of_signature(signature);
        if !rest_type.is_nil() {
            return rest_type;
        }
        self.any_type
    }

    pub fn try_get_rest_type_of_signature(&mut self, signature: SignatureId) -> TypeId {
        if !signature_has_rest_parameter(self, signature) {
            return TypeId::NIL;
        }
        let parameters = self.signatures[signature].parameters;
        let mut rest_type = self.get_type_of_symbol(parameters.at(parameters.len() - 1));
        if is_tuple_type(self, rest_type) {
            rest_type = self.get_rest_type_of_tuple_type(rest_type);
            if rest_type.is_nil() {
                return TypeId::NIL;
            }
        }
        let number_type = self.number_type;
        self.get_index_type_of_type(rest_type, number_type)
    }
}
