//! needsParentheses (src/language-js/parentheses/*.js). A node knows its parent, so this is a function of the node alone.

use crate::arena::SUB_SHIFT;
use crate::ast::{
    F_AWAIT, F_CHAIN, F_COMPUTED, F_ESCAPE, F_EXTENDS_BOUND, F_EXTRA, F_OPTIONAL, F_PAREN,
    F_PREFIX, FN_RETURN_TYPE, TO_KEYOF, k,
};
use crate::lexer::tk;
use crate::print::util::{
    MAY_NEED_PARENS, PARENS_LOOK, get_precedence, is_bitwise_operator, should_flatten,
};
use crate::{Quick, R, Words};

impl Quick {
    pub(crate) fn return_argument_has_leading_comment(&self, n: i32) -> bool {
        if self.has_leading_own_line_comment(n) {
            return true;
        }
        if self.has_comment(n) && !self.is_jsx_element(n) {
            let mut c = self.first_comment(n);
            while c >= 0 {
                if self.is_leading(c)
                    && self.has_newline_in_range(self.comment_start(c), self.comment_end(c))
                {
                    return true;
                }
                c = self.next_comment(c);
            }
        }
        if self.has_naked_left_side(n) {
            let mut left_most = n;
            loop {
                left_most = self.get_left_side(left_most);
                if left_most == 0 {
                    break;
                }
                if self.has_leading_own_line_comment(left_most) {
                    return true;
                }
            }
        }
        return false;
    }

    pub(crate) fn is_decorator_member_expression(&self, mut n: i32) -> bool {
        loop {
            let h = self.n.at(n);
            if (h & 0xff) == k::Identifier {
                return true;
            }
            if (h & 0xff) != k::MemberExpression {
                return false;
            }
            if (h & (F_COMPUTED | F_OPTIONAL)) != 0
                || (self.n.at(self.n.at(n + 5)) & 0xff) != k::Identifier
            {
                return false;
            }
            n = self.n.at(n + 4);
        }
    }

    pub(crate) fn can_decorator_expression_unparenthesized(&self, n: i32) -> bool {
        if self.is_decorator_member_expression(n) {
            return true;
        }
        return (self.n.at(n) & (0xff | F_OPTIONAL)) == k::CallExpression
            && self.is_decorator_member_expression(self.n.at(n + 4));
    }

    pub(crate) fn should_wrap_function_for_export_default(&self, n: i32) -> R<bool> {
        self.stack()?;
        let k = self.n.at(n) & 0xff;
        let parent_is_export = (self.n.at(self.n.at(n + 3)) & 0xff) == k::ExportDefaultDeclaration;
        if k == k::FunctionExpression || k == k::ClassExpression {
            return Ok(parent_is_export || !self.needs_parens(n)?);
        }
        if !self.has_naked_left_side(n) || (!parent_is_export && self.needs_parens(n)?) {
            return Ok(false);
        }
        return self.should_wrap_function_for_export_default(self.get_left_side_child(n));
    }

    pub(crate) fn is_in_for_statement_initializer(&self, mut n: i32) -> bool {
        while n != 0 {
            let p = self.n.at(n + 3);
            if (self.n.at(p) & 0xff) == k::ForStatement && self.n.at(p + 4) == n {
                return true;
            }
            n = p;
        }
        return false;
    }
}
pub(crate) fn is_binary_cast(k: i32) -> bool {
    return k == k::AsExpression || k == k::SatisfiesExpression;
}

impl Quick {
    /// /^PRETTIER_HTML_PLACEHOLDER_\d+_\d+_IN_JS$/
    pub(crate) fn is_html_placeholder_name(&self, start: i32, end: i32) -> bool {
        let prefix = b"PRETTIER_HTML_PLACEHOLDER_";
        if end - start < prefix.len() as i32 + 9 {
            return false;
        }
        let mut i: i32 = 0;
        while i < (prefix.len() as i32) {
            if self.t.at(start + i) != prefix.at(i) {
                return false;
            }
            i += 1;
        }
        let mut p = start + prefix.len() as i32;
        let mut part: i32 = 0;
        while part < 2 {
            let digits = p;
            while self.t.at(p) >= 48 && self.t.at(p) <= 57 {
                p += 1;
            }
            if p == digits || self.t.at(p) != 95 {
                return false;
            }
            p += 1;
            part += 1;
        }
        return end - p == 5
            && self.t.at(p) == 73
            && self.t.at(p + 1) == 78
            && self.t.at(p + 2) == 95
            && self.t.at(p + 3) == 74
            && self.t.at(p + 4) == 83;
    }

    pub(crate) fn identifier_needs_parens(&self, n: i32) -> bool {
        let len = self.n.at(n + 2) - self.n.at(n + 1);
        if (self.n.at(n) & F_PAREN) != 0
            && len > 30
            && self.is_html_placeholder_name(self.n.at(n + 1), self.n.at(n + 2))
        {
            return true;
        }
        if (self.n.at(n) & F_ESCAPE) != 0 {
            // `\u0061sync` is printed as `async`
            let parent = self.n.at(n + 3);
            if (self.n.at(parent) & 0xff) != k::ForOfStatement
                || self.n.at(parent + 4) != n
                || (self.n.at(parent) & F_AWAIT) != 0
            {
                return false;
            }
            return self.is_async_with_escapes(self.n.at(n + 1), self.n.at(n + 2));
        }
        return self.identifier_needs_parens_behind(n);
    }

    pub(crate) fn identifier_needs_parens_behind(&self, n: i32) -> bool {
        let len = self.n.at(n + 2) - self.n.at(n + 1);
        let parent = self.n.at(n + 3);
        let pk = self.n.at(parent) & 0xff;
        if is_binary_cast(pk) {
            // (type) satisfies never;
            let mut ancestor = parent;
            while is_binary_cast(self.n.at(ancestor) & 0xff) {
                ancestor = self.n.at(ancestor + 3);
            }
            if (self.n.at(ancestor) & 0xff) == k::ExpressionStatement {
                if self.name_is(n, b"await")
                    || self.name_is(n, b"interface")
                    || self.name_is(n, b"module")
                    || self.name_is(n, b"using")
                    || self.name_is(n, b"yield")
                    || self.name_is(n, b"let")
                    || self.name_is(n, b"component")
                    || self.name_is(n, b"hook")
                    || self.name_is(n, b"type")
                {
                    return true;
                }
            }
        }
        if len != 3 && len != 5 {
            return false;
        }
        if len == 5 {
            return pk == k::ForOfStatement
                && self.n.at(parent + 4) == n
                && (self.n.at(parent) & F_AWAIT) == 0
                && self.name_is(n, b"async");
        }
        if !self.name_is(n, b"let") {
            return false;
        }
        if pk == k::ForOfStatement && self.n.at(parent + 4) == n {
            return true;
        }
        let top = self.climb_left_spine(n);
        let tp = self.n.at(top + 3);
        let tk = self.n.at(tp) & 0xff;
        if (tk == k::ForOfStatement || tk == k::ForInStatement) && self.n.at(tp + 4) == top {
            return true;
        }
        if pk == k::MemberExpression
            && self.n.at(parent + 4) == n
            && (self.n.at(parent) & F_COMPUTED) != 0
            && (self.n.at(parent) & F_OPTIONAL) == 0
        {
            if tk == k::ExpressionStatement
                || ((tk == k::ForStatement || tk == k::ForInStatement) && self.n.at(tp + 4) == top)
            {
                return true;
            }
        }
        return false;
    }

    /// `a?.b!`, `a?.b!!`: a NonNullExpression around the end of an optional chain that is not in parentheses.
    pub(crate) fn is_optional_chain_under_non_null(&self, n: i32) -> bool {
        let mut child = n;
        while (self.n.at(child) & 0xff) == k::NonNullExpression {
            child = self.n.at(child + 4);
            if (self.n.at(child) & F_PAREN) != 0 {
                return false;
            }
        }
        let k = self.n.at(child) & 0xff;
        return (k == k::MemberExpression || k == k::CallExpression)
            && (self.n.at(child) & F_CHAIN) != 0;
    }

    pub(crate) fn is_return_type_of_arrow(&self, annotation: i32) -> bool {
        if (self.n.at(annotation) & 0xff) != k::TypeAnnotation {
            return false;
        }
        let fn_ = self.n.at(annotation + 3);
        return (self.n.at(fn_) & 0xff) == k::ArrowFunctionExpression
            && self.n.at(fn_ + FN_RETURN_TYPE) == annotation;
    }

    /// The types of Flow.
    pub(crate) fn flow_type_needs_parens(&self, n: i32, k: i32, parent: i32, pk: i32) -> bool {
        let is_object_type_of_access = pk == k::IndexedAccessType && self.n.at(parent + 4) == n;
        let parent_is_keyof =
            pk == k::TypeOperator && ((self.n.at(parent) as u32) >> SUB_SHIFT) as i32 == TO_KEYOF;
        let parent_is_operator = pk == k::TypeOperator && !parent_is_keyof;
        match k {
            k::ConditionalType => {
                if pk == k::ConditionalType
                    && (self.n.at(parent + 4) == n || self.n.at(parent + 5) == n)
                {
                    return true;
                }
                if pk == k::TypeAnnotation {
                    let g = self.n.at(parent + 3);
                    if (self.n.at(g) & (0xff | F_EXTENDS_BOUND))
                        == (k::TypeParameter | F_EXTENDS_BOUND)
                        && self.n.at(g + 5) == parent
                    {
                        return true;
                    }
                }
                return pk == k::UnionType || pk == k::IntersectionType;
            }
            k::TypeOperator => {
                if ((self.n.at(n) as u32) >> SUB_SHIFT) as i32 != TO_KEYOF {
                    return pk == k::ArrayType
                        || pk == k::NullableType
                        || is_object_type_of_access
                        || parent_is_operator;
                }
                return is_object_type_of_access || pk == k::ArrayType;
            }
            // fallthrough: keyof
            k::TypeQuery => {
                return is_object_type_of_access || pk == k::ArrayType;
            }
            k::ArrayType => {
                return pk == k::NullableType;
            }
            k::IntersectionType | k::UnionType => {
                return pk == k::TypeOperator
                    || pk == k::ArrayType
                    || pk == k::NullableType
                    || pk == k::IntersectionType
                    || pk == k::UnionType
                    || is_object_type_of_access;
            }
            k::InferType | k::NullableType => {
                return pk == k::ArrayType || is_object_type_of_access;
            }
            k::IndexedAccessType => {
                // an OptionalIndexedAccessType under a plain one
                return (self.n.at(n) & F_CHAIN) != 0
                    && is_object_type_of_access
                    && (self.n.at(parent) & F_CHAIN) == 0;
            }
            k::ComponentTypeAnnotation => {
                if self.n.at(n + FN_RETURN_TYPE) == 0 {
                    return false;
                }
                {
                    if self.is_return_type_of_arrow(parent) {
                        return true;
                    }
                    let grandparent = self.n.at(parent + 3);
                    if (pk == k::NullableType
                        || (pk == k::TypePredicate && self.n.at(parent + 5) == n))
                        && self.is_return_type_of_arrow(grandparent)
                    {
                        return true;
                    }
                    let ak = if pk == k::NullableType {
                        self.n.at(grandparent) & 0xff
                    } else {
                        pk
                    };
                    if ak == k::UnionType
                        || ak == k::IntersectionType
                        || ak == k::ArrayType
                        || ak == k::NullableType
                        || is_object_type_of_access
                    {
                        return true;
                    }
                    if pk == k::ConditionalType {
                        if self.n.at(parent + 4) == n {
                            return true;
                        }
                        if self.n.at(parent + 5) == n {
                            let return_type = self.n.at(n + FN_RETURN_TYPE);
                            if (self.n.at(return_type) & 0xff) == k::InferType
                                && self.n.at(self.n.at(return_type + 4) + 5) != 0
                            {
                                return true;
                            }
                        }
                    }
                    if pk == k::FunctionTypeParam && self.n.at(parent + 4) == 0 {
                        let params = self.n.at(n + 6);
                        let mut i: i32 = 1;
                        while i <= self.n.at(params) {
                            let parameter = self.n.at(params + i);
                            if (self.n.at(parameter) & 0xff) == k::FunctionTypeParam
                                && (self.n.at(self.n.at(parameter + 5)) & 0xff) == k::NullableType
                            {
                                return true;
                            }
                            i += 1;
                        }
                    }
                    return false;
                }
            }
            // fallthrough
            k::FunctionType => {
                if self.is_return_type_of_arrow(parent) {
                    return true;
                }
                let grandparent = self.n.at(parent + 3);
                if (pk == k::NullableType || (pk == k::TypePredicate && self.n.at(parent + 5) == n))
                    && self.is_return_type_of_arrow(grandparent)
                {
                    return true;
                }
                let ak = if pk == k::NullableType {
                    self.n.at(grandparent) & 0xff
                } else {
                    pk
                };
                if ak == k::UnionType
                    || ak == k::IntersectionType
                    || ak == k::ArrayType
                    || ak == k::NullableType
                    || is_object_type_of_access
                {
                    return true;
                }
                if pk == k::ConditionalType {
                    if self.n.at(parent + 4) == n {
                        return true;
                    }
                    if self.n.at(parent + 5) == n {
                        let return_type = self.n.at(n + FN_RETURN_TYPE);
                        if (self.n.at(return_type) & 0xff) == k::InferType
                            && self.n.at(self.n.at(return_type + 4) + 5) != 0
                        {
                            return true;
                        }
                    }
                }
                if pk == k::FunctionTypeParam && self.n.at(parent + 4) == 0 {
                    let params = self.n.at(n + 6);
                    let mut i: i32 = 1;
                    while i <= self.n.at(params) {
                        let parameter = self.n.at(params + i);
                        if (self.n.at(parameter) & 0xff) == k::FunctionTypeParam
                            && (self.n.at(self.n.at(parameter + 5)) & 0xff) == k::NullableType
                        {
                            return true;
                        }
                        i += 1;
                    }
                }
                return false;
            }
            _ => {}
        }
        return false;
    }

    /// The types of TypeScript.
    pub(crate) fn type_needs_parens(&self, n: i32, k: i32, parent: i32, pk: i32) -> bool {
        if k == k::TypeQuery {
            return (pk == k::IndexedAccessType && self.n.at(parent + 4) == n)
                || pk == k::ArrayType;
        }
        if k == k::FunctionType && pk == k::TypeAnnotation {
            let fn_ = self.n.at(parent + 3);
            if (self.n.at(fn_) & 0xff) == k::ArrowFunctionExpression
                && self.n.at(fn_ + FN_RETURN_TYPE) == parent
            {
                return true;
            }
        }
        if k == k::FunctionType || k == k::ConstructorType || k == k::ConditionalType {
            if pk == k::ConditionalType {
                if self.n.at(parent + 4) == n {
                    return true;
                }
                if self.n.at(parent + 5) == n {
                    if k == k::ConditionalType {
                        return true;
                    }
                    let mut type_ = self.n.at(self.n.at(n + FN_RETURN_TYPE) + 4);
                    if (self.n.at(type_) & 0xff) == k::TypePredicate && self.n.at(type_ + 5) != 0 {
                        type_ = self.n.at(self.n.at(type_ + 5) + 4);
                    }
                    if (self.n.at(type_) & 0xff) == k::InferType
                        && self.n.at(self.n.at(type_ + 4) + 5) != 0
                    {
                        return true;
                    }
                }
            }
            if k == k::ConditionalType && pk == k::TypeParameter && self.n.at(parent + 5) == n {
                return true;
            }
        }
        if k != k::InferType
            && k != k::TypeOperator
            && (pk == k::UnionType || pk == k::IntersectionType)
        {
            return true;
        }
        if k == k::InferType {
            if pk == k::RestType {
                return false;
            }
            if (pk == k::UnionType || pk == k::IntersectionType)
                && self.n.at(self.n.at(n + 4) + 5) != 0
            {
                return true;
            }
        }
        return pk == k::ArrayType
            || pk == k::OptionalType
            || pk == k::RestType
            || (pk == k::IndexedAccessType && self.n.at(parent + 4) == n)
            || pk == k::TypeOperator
            || pk == k::NullableType;
    }

    pub(crate) fn needs_parens(&self, n: i32) -> R<bool> {
        let head = self.n.at(n);
        let k = head & 0xff;
        if MAY_NEED_PARENS.at(k) == 0 {
            return Ok(false);
        }
        if k == k::Identifier {
            return Ok(
                (head & (F_EXTRA | F_ESCAPE | F_PAREN)) != 0 && self.identifier_needs_parens(n)
            );
        }
        let parent = self.n.at(n + 3);
        let ph = self.n.at(parent);
        let pk = ph & 0xff;
        // The table knows the pairs of kinds that no rule mentions. Three rules look at more than the pair.
        if PARENS_LOOK.at((k << 8) | pk) == 0
            && (head & F_CHAIN) == 0
            && !(k == k::BinaryExpression
                && (((head as u32) >> SUB_SHIFT) as i32 == tk::In
                    || ((head as u32) >> SUB_SHIFT) as i32 == tk::Pipeline))
        {
            return Ok(false);
        }
        return self.needs_parens_slow(n, head, parent, ph);
    }

    pub(crate) fn needs_parens_slow(&self, n: i32, head: i32, parent: i32, ph: i32) -> R<bool> {
        let k = head & 0xff;
        let pk = ph & 0xff;
        if parent == 0 {
            return Ok(false);
        }
        // to avoid an unexpected `}}` in an interpolation
        if k == k::ObjectExpression || k == k::FunctionExpression || k == k::ClassExpression {
            let top = self.climb_left_spine(n);
            let tp = self.n.at(top + 3);
            let tk = self.n.at(tp) & 0xff;
            if tk == k::ExpressionStatement {
                return Ok(true);
            }
            if k == k::ObjectExpression
                && tk == k::ArrowFunctionExpression
                && self.n.at(tp + 5) == top
            {
                let body_kind = self.n.at(top) & 0xff;
                if body_kind != k::SequenceExpression && body_kind != k::AssignmentExpression {
                    return Ok(true);
                }
            }
        }
        // parentNeedsParentheses
        match pk {
            k::ReturnStatement | k::ThrowStatement => {
                if (k == k::SequenceExpression || k == k::AssignmentExpression)
                    && self.return_argument_has_leading_comment(n)
                {
                    return Ok(false);
                }
            }
            k::ParenthesizedExpression => {
                return Ok(false);
            }
            k::ClassDeclaration | k::ClassExpression => {
                if self.n.at(parent + 5) == n {
                    let mut super_class = n;
                    while (self.n.at(super_class) & 0xff) == k::NonNullExpression {
                        super_class = self.n.at(super_class + 4);
                    }
                    match self.n.at(super_class) & 0xff {
                        k::ArrowFunctionExpression
                        | k::AssignmentExpression
                        | k::AwaitExpression
                        | k::BinaryExpression
                        | k::ConditionalExpression
                        | k::LogicalExpression
                        | k::NewExpression
                        | k::ObjectExpression
                        | k::SequenceExpression
                        | k::TaggedTemplateExpression
                        | k::UnaryExpression
                        | k::UpdateExpression
                        | k::YieldExpression => {
                            return Ok(true);
                        }
                        k::ClassExpression => {
                            if self.n.at(self.n.at(super_class + 7)) > 0 {
                                return Ok(true);
                            }
                        }
                        _ => {}
                    }
                }
            }
            k::InstantiationExpression => {
                if k == k::AwaitExpression || k == k::YieldExpression {
                    return Ok(true);
                }
            }
            k::ExportDefaultDeclaration => {
                if self.should_wrap_function_for_export_default(n)? {
                    return Ok(true);
                }
            }
            k::Decorator => {
                if !self.can_decorator_expression_unparenthesized(n) {
                    return Ok(true);
                }
            }
            k::VariableDeclarator => {
                if self.n.at(parent + 5) == n {
                    let declaration = self.n.at(parent + 3);
                    let statement = self.n.at(declaration + 3);
                    if (self.n.at(statement) & 0xff) == k::ForInStatement
                        && self.n.at(statement + 4) == declaration
                    {
                        return Ok(true);
                    }
                }
            }
            _ => {}
        }
        match k {
            k::UpdateExpression => {
                if pk == k::UnaryExpression {
                    let o = ((head as u32) >> SUB_SHIFT) as i32;
                    let po = ((ph as u32) >> SUB_SHIFT) as i32;
                    return Ok((head & F_PREFIX) != 0
                        && ((o == tk::Inc && po == tk::Add) || (o == tk::Dec && po == tk::Sub)));
                }
                match pk {
                    k::UnaryExpression => {
                        let o = ((head as u32) >> SUB_SHIFT) as i32;
                        return Ok(o == ((ph as u32) >> SUB_SHIFT) as i32
                            && (o == tk::Add || o == tk::Sub));
                    }
                    k::TaggedTemplateExpression | k::NonNullExpression => {
                        return Ok(true);
                    }
                    k::MemberExpression | k::NewExpression | k::CallExpression => {
                        return Ok(self.n.at(parent + 4) == n);
                    }
                    k::BinaryExpression => {
                        if self.n.at(parent + 4) != n {
                            return Ok(false);
                        }
                        let po = ((ph as u32) >> SUB_SHIFT) as i32;
                        if k == k::UnaryExpression && (po == tk::In || po == tk::Instanceof) {
                            return Ok(true);
                        }
                        return Ok(po == tk::Pow);
                    }
                    _ => {}
                }
                return Ok(false);
            }
            // fallthrough
            k::UnaryExpression => {
                match pk {
                    k::UnaryExpression => {
                        let o = ((head as u32) >> SUB_SHIFT) as i32;
                        return Ok(o == ((ph as u32) >> SUB_SHIFT) as i32
                            && (o == tk::Add || o == tk::Sub));
                    }
                    k::TaggedTemplateExpression | k::NonNullExpression => {
                        return Ok(true);
                    }
                    k::MemberExpression | k::NewExpression | k::CallExpression => {
                        return Ok(self.n.at(parent + 4) == n);
                    }
                    k::BinaryExpression => {
                        if self.n.at(parent + 4) != n {
                            return Ok(false);
                        }
                        let po = ((ph as u32) >> SUB_SHIFT) as i32;
                        if k == k::UnaryExpression && (po == tk::In || po == tk::Instanceof) {
                            return Ok(true);
                        }
                        return Ok(po == tk::Pow);
                    }
                    _ => {}
                }
                return Ok(false);
            }
            k::BinaryExpression => {
                if pk == k::UpdateExpression {
                    return Ok(true);
                }
                if ((head as u32) >> SUB_SHIFT) as i32 == tk::In
                    && self.is_in_for_statement_initializer(n)
                {
                    return Ok(true);
                }
                if ((head as u32) >> SUB_SHIFT) as i32 == tk::Pipeline && (head & F_PAREN) != 0 {
                    let g = self.n.at(self.n.at(parent + 3));
                    if (g & 0xff) == k::BinaryExpression
                        && ((g as u32) >> SUB_SHIFT) as i32 == tk::Pipeline
                    {
                        return Ok(true);
                    }
                }
                match pk {
                    k::AsExpression | k::SatisfiesExpression => {
                        return Ok(!is_binary_cast(k));
                    }
                    k::ConditionalExpression => {
                        return Ok(is_binary_cast(k)
                            || (k == k::LogicalExpression
                                && ((head as u32) >> SUB_SHIFT) as i32 == tk::Nullish));
                    }
                    k::CallExpression | k::NewExpression | k::MemberExpression => {
                        return Ok(self.n.at(parent + 4) == n);
                    }
                    k::ClassExpression | k::ClassDeclaration => {
                        return Ok(self.n.at(parent + 5) == n);
                    }
                    k::TaggedTemplateExpression
                    | k::JSXSpreadAttribute
                    | k::SpreadElement
                    | k::AwaitExpression
                    | k::UpdateExpression
                    | k::TypeAssertion
                    | k::NonNullExpression => {
                        return Ok(true);
                    }
                    k::UnaryExpression => {
                        if !self.has_comment(n) {
                            return Ok(true);
                        }
                        return Ok(false);
                    }
                    k::AssignmentExpression | k::AssignmentPattern => {
                        return Ok(self.n.at(parent + 4) == n
                            && (k == k::TypeAssertion || is_binary_cast(k)));
                    }
                    k::LogicalExpression => {
                        if k == k::LogicalExpression {
                            return Ok(((ph as u32) >> SUB_SHIFT) as i32
                                != ((head as u32) >> SUB_SHIFT) as i32);
                        }
                        {
                            if is_binary_cast(k) {
                                return Ok(true);
                            }
                            // get_precedence(undefined) is undefined, and no comparison with it holds
                            if k == k::TypeAssertion {
                                return Ok(is_bitwise_operator(((ph as u32) >> SUB_SHIFT) as i32));
                            }
                            let o = ((head as u32) >> SUB_SHIFT) as i32;
                            let po = ((ph as u32) >> SUB_SHIFT) as i32;
                            let precedence = get_precedence(o);
                            let parent_precedence = get_precedence(po);
                            if parent_precedence > precedence {
                                return Ok(true);
                            }
                            if self.n.at(parent + 5) == n && parent_precedence == precedence {
                                return Ok(true);
                            }
                            if parent_precedence == precedence && !should_flatten(po, o) {
                                return Ok(true);
                            }
                            if parent_precedence < precedence
                                && o == tk::Mod
                                && (po == tk::Add || po == tk::Sub)
                            {
                                return Ok(true);
                            }
                            return Ok(is_bitwise_operator(po));
                        }
                    }
                    // fallthrough
                    k::BinaryExpression => {
                        if is_binary_cast(k) {
                            return Ok(true);
                        }
                        if k == k::TypeAssertion {
                            return Ok(is_bitwise_operator(((ph as u32) >> SUB_SHIFT) as i32));
                        }
                        let o = ((head as u32) >> SUB_SHIFT) as i32;
                        let po = ((ph as u32) >> SUB_SHIFT) as i32;
                        let precedence = get_precedence(o);
                        let parent_precedence = get_precedence(po);
                        if parent_precedence > precedence {
                            return Ok(true);
                        }
                        if self.n.at(parent + 5) == n && parent_precedence == precedence {
                            return Ok(true);
                        }
                        if parent_precedence == precedence && !should_flatten(po, o) {
                            return Ok(true);
                        }
                        if parent_precedence < precedence
                            && o == tk::Mod
                            && (po == tk::Add || po == tk::Sub)
                        {
                            return Ok(true);
                        }
                        return Ok(is_bitwise_operator(po));
                    }
                    _ => {}
                }
                return Ok(false);
            }
            // fallthrough
            k::TypeAssertion | k::AsExpression | k::SatisfiesExpression | k::LogicalExpression => {
                match pk {
                    k::AsExpression | k::SatisfiesExpression => {
                        return Ok(!is_binary_cast(k));
                    }
                    k::ConditionalExpression => {
                        return Ok(is_binary_cast(k)
                            || (k == k::LogicalExpression
                                && ((head as u32) >> SUB_SHIFT) as i32 == tk::Nullish));
                    }
                    k::CallExpression | k::NewExpression | k::MemberExpression => {
                        return Ok(self.n.at(parent + 4) == n);
                    }
                    k::ClassExpression | k::ClassDeclaration => {
                        return Ok(self.n.at(parent + 5) == n);
                    }
                    k::TaggedTemplateExpression
                    | k::JSXSpreadAttribute
                    | k::SpreadElement
                    | k::AwaitExpression
                    | k::UpdateExpression
                    | k::TypeAssertion
                    | k::NonNullExpression => {
                        return Ok(true);
                    }
                    k::UnaryExpression => {
                        if !self.has_comment(n) {
                            return Ok(true);
                        }
                        return Ok(false);
                    }
                    k::AssignmentExpression | k::AssignmentPattern => {
                        return Ok(self.n.at(parent + 4) == n
                            && (k == k::TypeAssertion || is_binary_cast(k)));
                    }
                    k::LogicalExpression => {
                        if k == k::LogicalExpression {
                            return Ok(((ph as u32) >> SUB_SHIFT) as i32
                                != ((head as u32) >> SUB_SHIFT) as i32);
                        }
                        {
                            if is_binary_cast(k) {
                                return Ok(true);
                            }
                            if k == k::TypeAssertion {
                                return Ok(is_bitwise_operator(((ph as u32) >> SUB_SHIFT) as i32));
                            }
                            let o = ((head as u32) >> SUB_SHIFT) as i32;
                            let po = ((ph as u32) >> SUB_SHIFT) as i32;
                            let precedence = get_precedence(o);
                            let parent_precedence = get_precedence(po);
                            if parent_precedence > precedence {
                                return Ok(true);
                            }
                            if self.n.at(parent + 5) == n && parent_precedence == precedence {
                                return Ok(true);
                            }
                            if parent_precedence == precedence && !should_flatten(po, o) {
                                return Ok(true);
                            }
                            if parent_precedence < precedence
                                && o == tk::Mod
                                && (po == tk::Add || po == tk::Sub)
                            {
                                return Ok(true);
                            }
                            return Ok(is_bitwise_operator(po));
                        }
                    }
                    k::BinaryExpression => {
                        if is_binary_cast(k) {
                            return Ok(true);
                        }
                        if k == k::TypeAssertion {
                            return Ok(is_bitwise_operator(((ph as u32) >> SUB_SHIFT) as i32));
                        }
                        let o = ((head as u32) >> SUB_SHIFT) as i32;
                        let po = ((ph as u32) >> SUB_SHIFT) as i32;
                        let precedence = get_precedence(o);
                        let parent_precedence = get_precedence(po);
                        if parent_precedence > precedence {
                            return Ok(true);
                        }
                        if self.n.at(parent + 5) == n && parent_precedence == precedence {
                            return Ok(true);
                        }
                        if parent_precedence == precedence && !should_flatten(po, o) {
                            return Ok(true);
                        }
                        if parent_precedence < precedence
                            && o == tk::Mod
                            && (po == tk::Add || po == tk::Sub)
                        {
                            return Ok(true);
                        }
                        return Ok(is_bitwise_operator(po));
                    }
                    _ => {}
                }
                return Ok(false);
            }
            k::SequenceExpression => {
                return Ok(pk != k::ForStatement);
            }
            k::YieldExpression => {
                if pk == k::AwaitExpression || pk == k::TypeAssertion {
                    return Ok(true);
                }
                match pk {
                    k::TaggedTemplateExpression
                    | k::UnaryExpression
                    | k::LogicalExpression
                    | k::SpreadElement
                    | k::AsExpression
                    | k::SatisfiesExpression
                    | k::NonNullExpression => {
                        return Ok(true);
                    }
                    k::MemberExpression
                    | k::NewExpression
                    | k::CallExpression
                    | k::ConditionalExpression => {
                        return Ok(self.n.at(parent + 4) == n);
                    }
                    k::BinaryExpression => {
                        return Ok(!(self.n.at(n + 4) == 0
                            && ((ph as u32) >> SUB_SHIFT) as i32 == tk::Pipeline));
                    }
                    _ => {}
                }
                return Ok(false);
            }
            // fallthrough
            k::AwaitExpression => {
                match pk {
                    k::TaggedTemplateExpression
                    | k::UnaryExpression
                    | k::LogicalExpression
                    | k::SpreadElement
                    | k::AsExpression
                    | k::SatisfiesExpression
                    | k::NonNullExpression => {
                        return Ok(true);
                    }
                    k::MemberExpression
                    | k::NewExpression
                    | k::CallExpression
                    | k::ConditionalExpression => {
                        return Ok(self.n.at(parent + 4) == n);
                    }
                    k::BinaryExpression => {
                        return Ok(!(self.n.at(n + 4) == 0
                            && ((ph as u32) >> SUB_SHIFT) as i32 == tk::Pipeline));
                    }
                    _ => {}
                }
                return Ok(false);
            }
            k::StringLiteral => {
                if pk == k::ExpressionStatement {
                    let gk = self.n.at(self.n.at(parent + 3)) & 0xff;
                    return Ok(gk == k::Program || gk == k::BlockStatement);
                }
                return Ok(false);
            }
            k::NumericLiteral => {
                return Ok(pk == k::MemberExpression && self.n.at(parent + 4) == n);
            }
            k::AssignmentExpression => {
                if pk == k::ForStatement
                    && (self.n.at(parent + 4) == n || self.n.at(parent + 6) == n)
                {
                    return Ok(false);
                }
                if pk == k::ExpressionStatement
                    && (self.n.at(self.n.at(n + 4)) & 0xff) != k::ObjectPattern
                {
                    return Ok(false);
                }
                if pk == k::AssignmentExpression {
                    return Ok(false);
                }
                if pk == k::PropertySignature && self.n.at(parent + 4) == n {
                    return Ok(false);
                }
                if pk == k::SequenceExpression {
                    let g = self.n.at(parent + 3);
                    if (self.n.at(g) & 0xff) == k::ForStatement
                        && (self.n.at(g + 4) == parent || self.n.at(g + 6) == parent)
                    {
                        return Ok(false);
                    }
                }
                if pk == k::JsExpressionRoot {
                    return Ok(false);
                }
                return Ok(true);
            }
            k::ConditionalExpression => {
                match pk {
                    k::TaggedTemplateExpression
                    | k::UnaryExpression
                    | k::SpreadElement
                    | k::BinaryExpression
                    | k::LogicalExpression
                    | k::AwaitExpression
                    | k::JSXSpreadAttribute
                    | k::TypeAssertion
                    | k::AsExpression
                    | k::SatisfiesExpression
                    | k::NonNullExpression
                    | k::TypeCastExpression => {
                        return Ok(true);
                    }
                    k::NewExpression | k::CallExpression | k::MemberExpression => {
                        return Ok(self.n.at(parent + 4) == n);
                    }
                    k::ConditionalExpression => {
                        return Ok(self.n.at(parent + 4) == n);
                    }
                    _ => {}
                }
                return Ok(false);
            }
            k::FunctionExpression => {
                match pk {
                    k::NewExpression | k::CallExpression => {
                        return Ok(self.n.at(parent + 4) == n);
                    }
                    k::TaggedTemplateExpression | k::ExportDefaultDeclaration => {
                        return Ok(true);
                    }
                    _ => {}
                }
                return Ok(false);
            }
            k::ArrowFunctionExpression => {
                match pk {
                    k::BinaryExpression => {
                        return Ok(((ph as u32) >> SUB_SHIFT) as i32 != tk::Pipeline
                            || (head & F_PAREN) != 0);
                    }
                    k::NewExpression
                    | k::CallExpression
                    | k::MemberExpression
                    | k::ConditionalExpression
                    | k::InstantiationExpression => {
                        return Ok(self.n.at(parent + 4) == n);
                    }
                    k::TaggedTemplateExpression
                    | k::UnaryExpression
                    | k::LogicalExpression
                    | k::AwaitExpression
                    | k::AsExpression
                    | k::SatisfiesExpression
                    | k::NonNullExpression
                    | k::TypeAssertion
                    | k::MatchExpressionCase => {
                        return Ok(true);
                    }
                    _ => {}
                }
                return Ok(false);
            }
            k::ClassExpression => {
                if pk == k::NewExpression {
                    return Ok(self.n.at(parent + 4) == n);
                }
                return Ok(pk == k::ExportDefaultDeclaration);
            }
            k::NonNullExpression | k::CallExpression | k::MemberExpression => {
                if if k == k::NonNullExpression {
                    self.is_optional_chain_under_non_null(n)
                        && ((head & F_PAREN) != 0 || pk != k::NonNullExpression)
                } else {
                    (head & F_CHAIN) != 0 && ((head & F_PAREN) != 0 || pk != k::NonNullExpression)
                } {
                    // the end of an optional chain that something goes on from
                    if pk == k::NonNullExpression
                        || (pk == k::MemberExpression
                            && self.n.at(parent + 4) == n
                            && (ph & F_CHAIN) == 0)
                        || (pk == k::CallExpression
                            && self.n.at(parent + 4) == n
                            && (ph & F_CHAIN) == 0)
                        || (pk == k::NewExpression && self.n.at(parent + 4) == n)
                        || (pk == k::TaggedTemplateExpression && self.n.at(parent + 4) == n)
                    {
                        return Ok(true);
                    }
                }
                if pk == k::NewExpression && self.n.at(parent + 4) == n {
                    let mut object = n;
                    while object != 0 {
                        let oh = self.n.at(object);
                        match oh & 0xff {
                            k::CallExpression => {
                                if (oh & F_CHAIN) != 0 {
                                    return Ok(false);
                                }
                                return Ok(true);
                            }
                            k::ImportExpression => {
                                return Ok(true);
                            }
                            k::MemberExpression
                            | k::TaggedTemplateExpression
                            | k::NonNullExpression => {
                                object = self.n.at(object + 4);
                            }
                            _ => {
                                return Ok(false);
                            }
                        }
                    }
                }
                return Ok(false);
            }
            // fallthrough
            k::TaggedTemplateExpression | k::ImportExpression => {
                if pk == k::NewExpression && self.n.at(parent + 4) == n {
                    let mut object = n;
                    while object != 0 {
                        let oh = self.n.at(object);
                        match oh & 0xff {
                            k::CallExpression => {
                                if (oh & F_CHAIN) != 0 {
                                    return Ok(false);
                                }
                                return Ok(true);
                            }
                            k::ImportExpression => {
                                return Ok(true);
                            }
                            k::MemberExpression
                            | k::TaggedTemplateExpression
                            | k::NonNullExpression => {
                                object = self.n.at(object + 4);
                            }
                            _ => {
                                return Ok(false);
                            }
                        }
                    }
                }
                return Ok(false);
            }
            k::InstantiationExpression => {
                return Ok(pk == k::MemberExpression && self.n.at(parent + 4) == n);
            }
            k::FunctionType
            | k::ConstructorType
            | k::ConditionalType
            | k::UnionType
            | k::IntersectionType
            | k::InferType
            | k::TypeOperator
            | k::TypeQuery => {
                return Ok(if self.mode.is_flow {
                    self.flow_type_needs_parens(n, k, parent, pk)
                } else {
                    self.type_needs_parens(n, k, parent, pk)
                });
            }
            k::ArrayType | k::NullableType | k::IndexedAccessType | k::ComponentTypeAnnotation => {
                return Ok(self.mode.is_flow && self.flow_type_needs_parens(n, k, parent, pk));
            }
            k::MatchOrPattern => {
                return Ok(pk == k::MatchAsPattern);
            }
            k::JSXFragment | k::JSXElement => {
                if (pk == k::CallExpression || pk == k::NewExpression) && self.n.at(parent + 4) == n
                {
                    return Ok(true);
                }
                if pk == k::BinaryExpression
                    && self.n.at(parent + 4) == n
                    && ((ph as u32) >> SUB_SHIFT) as i32 == tk::Lt
                {
                    return Ok(true);
                }
                match pk {
                    k::ArrayExpression
                    | k::ArrowFunctionExpression
                    | k::AssignmentExpression
                    | k::AssignmentPattern
                    | k::BinaryExpression
                    | k::ConditionalExpression
                    | k::ExpressionStatement
                    | k::JsExpressionRoot
                    | k::JSXAttribute
                    | k::JSXElement
                    | k::JSXExpressionContainer
                    | k::JSXFragment
                    | k::LogicalExpression
                    | k::CallExpression
                    | k::NewExpression
                    | k::ObjectProperty
                    | k::ReturnStatement
                    | k::ThrowStatement
                    | k::VariableDeclarator
                    | k::YieldExpression
                    | k::ExportDefaultDeclaration
                    | k::TypeCastExpression
                    | k::MatchExpressionCase
                    | k::ReadyWrap => {
                        return Ok(false);
                    }
                    _ => {}
                }
                return Ok(true);
            }
            _ => {}
        }
        return Ok(false);
    }
}

impl Quick {
    /// Is the name T[start, end), which has `a` or `\u{61}` in it, `async`?
    fn is_async_with_escapes(&self, start: i32, end: i32) -> bool {
        let mut rest = self.t.sub(start, end);
        for &expected in b"async" {
            let value;
            (value, rest) = match rest {
                [b'\\', b'u', b'{', tail @ ..] => {
                    let length = tail.iter().take_while(|c| c.is_ascii_hexdigit()).count();
                    let (digits, tail) = tail.split_at(length);
                    let Some((b'}', tail)) = tail.split_first() else {
                        return false;
                    };
                    (hex(digits), tail)
                }
                [b'\\', b'u', a, b, c, d, tail @ ..] => (hex(&[*a, *b, *c, *d]), tail),
                [c, tail @ ..] => (*c as u32, tail),
                [] => return false,
            };
            if value != expected as u32 {
                return false;
            }
        }
        rest.is_empty()
    }
}

/// The value of hexadecimal digits; what is no such digit, or too much, gives a number that is no letter.
fn hex(digits: &[u8]) -> u32 {
    digits
        .iter()
        .fold(0u32, |value, &c| match (c as char).to_digit(16) {
            Some(digit) if value < 0x11_0000 => value * 16 + digit,
            _ => u32::MAX,
        })
}
