//! Calls: call-expression.js, call-arguments.js and member-chain.js.
//!
//! This is where Prettier uses one doc in several places (conditionalGroup). Every decision that only needs the tree is
//! taken first, so that the common cases are written straight into the stream; only what really ends up in more than
//! one state of a conditional group is written detached and called.

use crate::arena::SUB_SHIFT;
use crate::ast::{
    F_CHAIN, F_COMMENTS, F_COMPUTED, F_EXPR_BODY, F_OPTIONAL, F_PAREN, F_SHORTHAND, FN_RETURN_TYPE,
    P_DEFER, P_MASK, P_SOURCE, k,
};
use crate::doc::{LABEL_EMBED, LABEL_MEMBER_CHAIN};
use crate::lexer::tk;
use crate::options::TRAILING_COMMA_ALL;
use crate::print::core::{ARG_EXPAND_FIRST, ARG_EXPAND_LAST, ARG_SHARE};
use crate::print::statics::{
    BANG, COMMA, COMMA_SPACE, DOT_DEFER, DOT_SOURCE, DOUBLE_COLON, IMPORT, LPAREN, NEW_,
    QUESTION_DOT, REQUIRE, RPAREN,
};
use crate::print::util::is_literal_kind;
use crate::{Bytes, Quick, R, Words, rare, zeros};

pub(crate) struct PrintCall {
    // ---------------------------------------------------------------------------------------------------- member chains
    /// The links of the chain that is being printed lie on a stack: [node, flags], the head of the chain first.
    pub(crate) ch: Vec<i32>,
    pub(crate) ch_top: i32,
    /// what analyze_chain() found
    pub(crate) chain_should_merge: bool,
    pub(crate) chain_has_comment: bool,
    pub(crate) chain_is_short: bool,
    // -------------------------------------------------------------------------------------------------- hugged arguments
    /// How many functions with hugged parameters have their signature open: see print_function().
    pub(crate) hugged_signatures: i32,
}
impl PrintCall {
    pub(crate) fn new() -> Self {
        Self {
            ch: zeros(1024),
            ch_top: 0,
            chain_should_merge: false,
            chain_has_comment: false,
            chain_is_short: false,
            hugged_signatures: 0,
        }
    }
}

impl Quick {
    // ------------------------------------------------------------------------------------------------ questions on nodes
    pub(crate) fn is_memberish(&self, n: i32) -> bool {
        let k = self.n.at(n) & 0xff;
        return k == k::MemberExpression;
    }

    pub(crate) fn template_literal_has_new_lines(&self, template: i32) -> bool {
        let quasis = self.n.at(template + 4);
        let mut i: i32 = 1;
        while i <= self.n.at(quasis) {
            let q = self.n.at(quasis + i);
            let mut p = self.n.at(q + 1);
            while p < self.n.at(q + 2) {
                if self.t.at(p) == 10 {
                    return true;
                }
                p += 1;
            }
            i += 1;
        }
        return false;
    }

    pub(crate) fn is_template_on_its_own_line(&self, n: i32) -> bool {
        let k = self.n.at(n) & 0xff;
        return ((k == k::TemplateLiteral && self.template_literal_has_new_lines(n))
            || (k == k::TaggedTemplateExpression
                && self.template_literal_has_new_lines(self.n.at(n + 5))))
            && !self.has_newline_before(self.n.at(n + 1));
    }

    /// Is `n` the dotted path `path`, like "a.b.c"?
    pub(crate) fn is_node_matches_path(&self, mut n: i32, path: &[u8]) -> bool {
        let mut end = path.len() as i32;
        loop {
            let dot = path.last_index_of(46, end - 1);
            let head = self.n.at(n);
            let k = head & 0xff;
            if dot < 0 {
                return k == k::Identifier && self.text_equals(n, path, 0, end);
            }
            let name: i32;
            if k == k::MetaProperty && path.index_of(46, 0) == dot {
                name = self.n.at(n + 5);
            } else if k == k::MemberExpression
                && (head & (F_CHAIN | F_OPTIONAL | F_COMPUTED)) == 0
                && (self.n.at(self.n.at(n + 5)) & 0xff) == k::Identifier
            {
                name = self.n.at(n + 5);
            } else {
                return false;
            }
            if !self.text_equals(name, path, dot + 1, end) {
                return false;
            }
            n = self.n.at(n + 4);
            end = dot;
        }
    }

    pub(crate) fn text_equals(&self, n: i32, word: &[u8], from: i32, to: i32) -> bool {
        let start = self.n.at(n + 1);
        if self.n.at(n + 2) - start != to - from {
            return false;
        }
        let mut i = from;
        while i < to {
            if self.t.at(start + i - from) != word.at(i) {
                return false;
            }
            i += 1;
        }
        return true;
    }

    pub(crate) fn is_test_call_callee(&self, n: i32) -> bool {
        self.starts_like_test_call_callee(n) && self.is_one_of_test_callees(n)
    }

    #[cold]
    fn starts_with_name_of_test_call(&self, n: i32) -> bool {
        let mut root = n;
        while (self.n.at(root) & 0xff) == k::MemberExpression {
            root = self.n.at(root + 4);
        }
        (self.n.at(root) & 0xff) == k::Identifier
            && [
                &b"it"[..],
                b"describe",
                b"test",
                b"skip",
                b"xit",
                b"xdescribe",
                b"xtest",
                b"fit",
                b"fdescribe",
                b"ftest",
            ]
            .iter()
            .any(|name| self.name_is(root, name))
    }

    /// The leftmost name decides quickly in nearly all cases.
    fn starts_like_test_call_callee(&self, n: i32) -> bool {
        let mut root = n;
        while (self.n.at(root) & 0xff) == k::MemberExpression {
            root = self.n.at(root + 4);
        }
        if (self.n.at(root) & 0xff) != k::Identifier {
            return false;
        }
        let length = self.n.at(root + 2) - self.n.at(root + 1);
        if length < 2 || length > 9 {
            return false;
        }
        // it, describe, test, skip, xit, xdescribe, xtest, fit, fdescribe, ftest
        let c = self.t.at(self.n.at(root + 1));
        if c != 105 && c != 100 && c != 116 && c != 115 && c != 120 && c != 102 {
            return false;
        }
        let last = self.t.at(self.n.at(root + 2) - 1);
        last == 116 || last == 101 || last == 112
    }

    pub(crate) fn is_angular_test_wrapper(&self, n: i32) -> R<bool> {
        if (self.n.at(n) & 0xff) != k::CallExpression {
            return Ok(false);
        }
        let callee = self.n.at(n + 4);
        if (self.n.at(callee) & 0xff) != k::Identifier {
            return Ok(false);
        }
        let is_wrapper = self.name_is(callee, b"async")
            || self.name_is(callee, b"inject")
            || self.name_is(callee, b"fakeAsync")
            || self.name_is(callee, b"waitForAsync");
        // `waitForAsync?.(..)` is a call in Babel's tree, which the long way does not go by.
        if is_wrapper && (self.n.at(n) & F_CHAIN) != 0 {
            return if self.mode.wraps_chains {
                Ok(false)
            } else {
                Err(self.rare(rare::UNLIKE_PRETTIER))
            };
        }
        return Ok(is_wrapper);
    }

    pub(crate) fn is_unit_test_setup_identifier(&self, n: i32) -> bool {
        if (self.n.at(n) & 0xff) != k::Identifier {
            return false;
        }
        return self.name_is(n, b"beforeEach")
            || self.name_is(n, b"beforeAll")
            || self.name_is(n, b"afterEach")
            || self.name_is(n, b"afterAll");
    }

    pub(crate) fn is_test_call(&self, n: i32, parent: i32) -> R<bool> {
        self.stack()?;
        if n == 0 || (self.n.at(n) & (0xff | F_CHAIN)) != k::CallExpression {
            // test?.skip("..", () => {})
            if n != 0
                && (self.n.at(n) & 0xff) == k::CallExpression
                && self.n.at(self.n.at(n + 5)) >= 2
                && self.starts_with_name_of_test_call(self.n.at(n + 4))
            {
                return Err(self.rare(rare::UNLIKE_PRETTIER));
            }
            return Ok(false);
        }
        let args = self.n.at(n + 5);
        let count = self.n.at(args);
        if count == 1 {
            if self.is_angular_test_wrapper(n)? && self.is_test_call(parent, 0)? {
                return Ok(self.is_function_or_arrow(self.n.at(args + 1)));
            }
            if self.is_unit_test_setup_identifier(self.n.at(n + 4)) {
                return self.is_angular_test_wrapper(self.n.at(args + 1));
            }
        } else if count == 2 || count == 3 {
            let first = self.n.at(args + 1);
            let fk = self.n.at(first) & 0xff;
            if (fk == k::TemplateLiteral || fk == k::StringLiteral)
                && self.is_test_call_callee(self.n.at(n + 4))
            {
                if count == 3 && (self.n.at(self.n.at(args + 3)) & 0xff) != k::NumericLiteral {
                    return Ok(false);
                }
                let second = self.n.at(args + 2);
                if if count == 2 {
                    self.is_function_or_arrow(second)
                } else {
                    self.is_function_or_arrow_with_body(second)
                        && self.n.at(self.n.at(second + 6)) <= 1
                } {
                    return Ok(true);
                }
                return self.is_angular_test_wrapper(second);
            }
        }
        return Ok(false);
    }

    pub(crate) fn is_function_or_arrow_with_body(&self, n: i32) -> bool {
        let k = self.n.at(n) & 0xff;
        return k == k::FunctionExpression
            || (k == k::ArrowFunctionExpression && (self.n.at(n) & F_EXPR_BODY) == 0);
    }

    pub(crate) fn is_simple_module_import(&self, n: i32) -> bool {
        let k = self.n.at(n) & 0xff;
        // the shape of the arguments first: it is the cheaper question, and the answer is mostly no
        let args = self.n.at(n + 5);
        if self.n.at(args) != 1
            || !self.is_string_literal(self.n.at(args + 1))
            || self.has_comment(self.n.at(args + 1))
        {
            return false;
        }
        if k == k::ImportExpression || k == k::ImportType || k == k::ExternalModuleReference {
            return true;
        }
        if (self.n.at(n) & (0xff | F_CHAIN)) != k::CallExpression {
            return false;
        }
        let callee = self.n.at(n + 4);
        // the leftmost name is `require` or `import`
        let mut root = callee;
        while (self.n.at(root) & 0xff) == k::MemberExpression {
            root = self.n.at(root + 4);
        }
        if if (self.n.at(root) & 0xff) == k::Identifier {
            self.n.at(root + 2) - self.n.at(root + 1) != 7
        } else {
            (self.n.at(root) & 0xff) != k::MetaProperty
        } {
            return false;
        }
        return self.is_node_matches_path(callee, b"require")
            || self.is_node_matches_path(callee, b"require.resolve")
            || self.is_node_matches_path(callee, b"require.resolve.paths")
            || self.is_node_matches_path(callee, b"import.meta.resolve");
    }

    pub(crate) fn is_commons_js_or_amd_module_definition(&self, n: i32) -> bool {
        if (self.n.at(n) & (0xff | F_CHAIN)) != k::CallExpression {
            return false;
        }
        let callee = self.n.at(n + 4);
        if (self.n.at(callee) & 0xff) != k::Identifier {
            return false;
        }
        let args = self.n.at(n + 5);
        let count = self.n.at(args);
        if self.name_is(callee, b"require") {
            return ((count == 1 && self.is_string_literal(self.n.at(args + 1))) || count > 1)
                && !self.has_comment(self.n.at(args + 1));
        }
        if self.name_is(callee, b"define")
            && (self.n.at(self.n.at(n + 3)) & 0xff) == k::ExpressionStatement
        {
            return count == 1
                || (count == 2 && (self.n.at(self.n.at(args + 1)) & 0xff) == k::ArrayExpression)
                || (count == 3
                    && self.is_string_literal(self.n.at(args + 1))
                    && (self.n.at(self.n.at(args + 2)) & 0xff) == k::ArrayExpression);
        }
        return false;
    }

    pub(crate) fn is_simple_call_argument(&self, mut n: i32, depth: i32) -> R<bool> {
        self.stack()?;
        if depth <= 0 {
            return Ok(false);
        }
        while (self.n.at(n) & 0xff) == k::NonNullExpression {
            n = self.n.at(n + 4);
        }
        let head = self.n.at(n);
        let k = head & 0xff;
        if k == k::RegExpLiteral {
            let mut e = self.n.at(n + 2);
            while self.t.at(e - 1) != 47 {
                e -= 1;
            }
            return Ok(self.text_width(self.n.at(n + 1) + 1, e - 1) <= 5);
        }
        if is_literal_kind(k)
            || k == k::Identifier
            || k == k::ThisExpression
            || k == k::Super
            || k == k::PrivateName
        {
            return Ok(true);
        }
        if k == k::TemplateLiteral {
            if self.template_literal_has_new_lines(n) {
                return Ok(false);
            }
            let l = self.n.at(n + 5);
            let mut i: i32 = 1;
            while i <= self.n.at(l) {
                if !self.is_simple_call_argument(self.n.at(l + i), depth - 1)? {
                    return Ok(false);
                }
                i += 1;
            }
            return Ok(true);
        }
        if k == k::ObjectExpression {
            let l = self.n.at(n + 4);
            let mut i: i32 = 1;
            while i <= self.n.at(l) {
                let p = self.n.at(l + i);
                let pk = self.n.at(p) & 0xff;
                if (self.n.at(p) & F_COMPUTED) != 0 {
                    return Ok(false);
                }
                if pk == k::Ready {
                    if (self.n.at(p) & F_SHORTHAND) == 0 && self.n.at(p + 6) > depth - 1 {
                        return Ok(false);
                    }
                } else if pk == k::ObjectProperty {
                    if (self.n.at(p) & F_SHORTHAND) == 0
                        && !self.is_simple_call_argument(self.n.at(p + 5), depth - 1)?
                    {
                        return Ok(false);
                    }
                } else {
                    // a method or a spread has no `value`
                    return Ok(false);
                }
                i += 1;
            }
            return Ok(true);
        }
        if k == k::ArrayExpression {
            let l = self.n.at(n + 4);
            let mut i: i32 = 1;
            while i <= self.n.at(l) {
                if self.n.at(l + i) != 0
                    && !self.is_simple_call_argument(self.n.at(l + i), depth - 1)?
                {
                    return Ok(false);
                }
                i += 1;
            }
            return Ok(true);
        }
        if k == k::CallExpression || k == k::NewExpression || k == k::ImportExpression {
            if k == k::ImportExpression || self.is_simple_call_argument(self.n.at(n + 4), depth)? {
                let l = self.n.at(n + 5);
                if self.n.at(l) > depth {
                    return Ok(false);
                }
                let mut i: i32 = 1;
                while i <= self.n.at(l) {
                    if !self.is_simple_call_argument(self.n.at(l + i), depth - 1)? {
                        return Ok(false);
                    }
                    i += 1;
                }
                return Ok(true);
            }
            return Ok(false);
        }
        if k == k::MemberExpression {
            return Ok(self.is_simple_call_argument(self.n.at(n + 4), depth)?
                && self.is_simple_call_argument(self.n.at(n + 5), depth)?);
        }
        if k == k::UnaryExpression {
            let o = ((head as u32) >> SUB_SHIFT) as i32;
            if o == tk::Not || o == tk::Sub || o == tk::Add || o == tk::Tilde {
                return self.is_simple_call_argument(self.n.at(n + 4), depth);
            }
            return Ok(false);
        }
        if k == k::UpdateExpression {
            return self.is_simple_call_argument(self.n.at(n + 4), depth);
        }
        return Ok(false);
    }

    pub(crate) fn is_long_curried_call_expression(&self, n: i32) -> bool {
        let parent = self.n.at(n + 3);
        return self.is_call_expression(n)
            && self.is_call_expression(parent)
            && self.n.at(parent + 4) == n
            && self.n.at(self.n.at(parent + 5)) > 0
            && self.n.at(self.n.at(n + 5)) > self.n.at(self.n.at(parent + 5));
    }

    pub(crate) fn is_function_composition_arguments(&self, args: i32) -> bool {
        let count = self.n.at(args);
        if count <= 1 {
            return false;
        }
        let mut functions: i32 = 0;
        let mut i: i32 = 1;
        while i <= count {
            let mut arg = self.n.at(args + i);
            if self.is_function_or_arrow(arg) {
                functions += 1;
                if functions > 1 {
                    return true;
                }
            } else {
                while (self.n.at(arg) & 0xff) == k::NonNullExpression {
                    arg = self.n.at(arg + 4);
                }
                if self.is_call_expression(arg) {
                    let inner = self.n.at(arg + 5);
                    let mut j: i32 = 1;
                    while j <= self.n.at(inner) {
                        if self.is_function_or_arrow(self.n.at(inner + j)) {
                            return true;
                        }
                        j += 1;
                    }
                }
            }
            i += 1;
        }
        return false;
    }

    pub(crate) fn could_expand_arg(&self, arg: i32, arrow_chain_recursion: bool) -> R<bool> {
        self.stack()?;
        let k = self.n.at(arg) & 0xff;
        if k == k::ObjectExpression || k == k::ArrayExpression {
            return Ok(self.n.at(self.n.at(arg + 4)) > 0 || self.has_comment(arg));
        }
        if k == k::AsExpression || k == k::SatisfiesExpression {
            return self.could_expand_arg(self.n.at(arg + 4), false);
        }
        if k == k::TypeAssertion {
            return self.could_expand_arg(self.n.at(arg + 5), false);
        }
        if k == k::FunctionExpression {
            return Ok(true);
        }
        if k == k::ArrowFunctionExpression {
            let body = self.n.at(arg + 5);
            let bk = self.n.at(body) & 0xff;
            if bk == k::BlockStatement
                || bk == k::JSXElement
                || bk == k::JSXFragment
                || bk == k::ObjectExpression
                || bk == k::ArrayExpression
            {
                return Ok(true);
            }
            if bk == k::ArrowFunctionExpression && self.could_expand_arg(body, true)? {
                return Ok(true);
            }
            if !arrow_chain_recursion {
                if bk == k::ConditionalExpression || bk == k::CallExpression {
                    return Ok(true);
                }
                if bk == k::NonNullExpression {
                    let mut inner = body;
                    while (self.n.at(inner) & 0xff) == k::NonNullExpression {
                        inner = self.n.at(inner + 4);
                    }
                    if (self.n.at(inner) & 0xff) == k::CallExpression {
                        return Ok(true);
                    }
                }
            }
        }
        return Ok(false);
    }

    pub(crate) fn should_expand_last_arg(&mut self, args: i32) -> R<bool> {
        let count = self.n.at(args);
        let last = self.n.at(args + count);
        let penultimate = if count > 1 {
            self.n.at(args + count - 1)
        } else {
            0
        };
        if count == 1 && self.embed_label_of(last)? == LABEL_EMBED {
            return Ok(true);
        }
        return Ok(!self.has_leading_comment(last)
            && !self.has_trailing_comment(last)
            && self.could_expand_arg(last, false)?
            && (penultimate == 0 || self.babel_type(penultimate) != self.babel_type(last))
            && (count != 2
                || (self.n.at(penultimate) & 0xff) != k::ArrowFunctionExpression
                || (self.n.at(last) & 0xff) != k::ArrayExpression)
            && !(count > 1 && self.is_concisely_printed_array(last)));
    }

    /// Two nodes have the same `type` in Babel's tree iff this is equal.
    pub(crate) fn babel_type(&self, n: i32) -> i32 {
        return self.n.at(n) & (0xff | F_CHAIN);
    }

    pub(crate) fn is_hopefully_short_call_argument(&self, n: i32) -> R<bool> {
        self.stack()?;
        if (self.n.at(n) & 0xff) == k::ParenthesizedExpression {
            return self.is_hopefully_short_call_argument(self.n.at(n + 4));
        }
        if (self.n.at(n) & 0xff) == k::AsExpression
            || (self.n.at(n) & 0xff) == k::SatisfiesExpression
            || (self.n.at(n) & 0xff) == k::TypeCastExpression
        {
            let mut type_ = self.n.at(n + 5);
            if type_ == 0 {
                return Ok(false);
            }
            if (self.n.at(type_) & 0xff) == k::TypeAnnotation {
                type_ = self.n.at(type_ + 4);
            }
            if (self.n.at(type_) & 0xff) == k::ArrayType && self.mode.is_type_script {
                type_ = self.n.at(type_ + 4);
                if (self.n.at(type_) & 0xff) == k::ArrayType {
                    type_ = self.n.at(type_ + 4);
                }
            }
            if (self.n.at(type_) & 0xff) == k::TypeReference && self.n.at(type_ + 5) != 0 {
                let list = self.n.at(self.n.at(type_ + 5) + 4);
                if self.n.at(list) == 1 {
                    type_ = self.n.at(list + 1);
                }
            }
            return Ok(
                self.is_simple_type(type_) && self.is_simple_call_argument(self.n.at(n + 4), 1)?
            );
        }
        if self.is_call_like(n) && self.n.at(self.n.at(n + 5)) > 1 && !self.is_chain_expression(n) {
            return Ok(false);
        }
        if self.is_binaryish(n) {
            return Ok(self.is_simple_call_argument(self.n.at(n + 4), 1)?
                && self.is_simple_call_argument(self.n.at(n + 5), 1)?);
        }
        return Ok((self.n.at(n) & 0xff) == k::RegExpLiteral || self.is_simple_call_argument(n, 2)?);
    }

    pub(crate) fn should_expand_first_arg(&self, args: i32) -> R<bool> {
        if self.n.at(args) != 2 {
            return Ok(false);
        }
        let first = self.n.at(args + 1);
        let second = self.n.at(args + 2);
        let fk = self.n.at(first) & 0xff;
        let sk = self.n.at(second) & 0xff;
        return Ok(!self.has_comment(first)
            && (fk == k::FunctionExpression
                || (fk == k::ArrowFunctionExpression
                    && (self.n.at(self.n.at(first + 5)) & 0xff) == k::BlockStatement))
            && sk != k::FunctionExpression
            && sk != k::ArrowFunctionExpression
            && sk != k::ConditionalExpression
            && self.is_hopefully_short_call_argument(second)?
            && !self.could_expand_arg(second, false)?);
    }

    pub(crate) fn is_valid_hook_callback_and_deps_format(&self, args: i32, base: i32) -> bool {
        let callback = self.n.at(args + 1 + base);
        let deps = self.n.at(args + 2 + base);
        if (self.n.at(callback) & 0xff) != k::ArrowFunctionExpression
            || self.n.at(self.n.at(callback + 6)) != 0
            || (self.n.at(self.n.at(callback + 5)) & 0xff) != k::BlockStatement
            || (self.n.at(deps) & 0xff) != k::ArrayExpression
        {
            return false;
        }
        let mut i: i32 = 1;
        while i <= self.n.at(args) {
            if self.has_comment(self.n.at(args + i)) {
                return false;
            }
            i += 1;
        }
        return true;
    }

    pub(crate) fn is_react_hook_call_with_deps_array(&self, args: i32) -> bool {
        let count = self.n.at(args);
        if count == 2 {
            return self.is_valid_hook_callback_and_deps_format(args, 0);
        }
        if count == 3 {
            return (self.n.at(self.n.at(args + 1)) & 0xff) == k::Identifier
                && self.is_valid_hook_callback_and_deps_format(args, 1);
        }
        return false;
    }

    // -------------------------------------------------------------------------------------------------------- arguments
    pub(crate) fn print_trailing_comma_all(&mut self, n: i32) {
        if self.options.trailing_comma != TRAILING_COMMA_ALL {
            return;
        }
        let k = self.n.at(n) & 0xff;
        if k != k::ImportExpression && k != k::ImportType && k != k::ExternalModuleReference {
            self.if_break_text(COMMA, 0, 0);
        }
    }

    /// `arg,` and the line behind it, for every argument from `from` to `to`; nothing behind the very last argument.
    pub(crate) fn print_arguments_range(&mut self, args: i32, from: i32, to: i32) -> R<()> {
        let count = self.n.at(args);
        let mut i = from;
        while i <= to {
            let arg = self.n.at(args + i);
            self.print(arg)?;
            if i == count {
                break;
            }
            self.text(COMMA);
            if self.is_next_line_empty(arg) {
                self.hardline();
                self.hardline();
            } else {
                self.line();
            }
            i += 1;
        }
        Ok(())
    }

    pub(crate) fn depends_on_args(&self, n: i32) -> bool {
        let k = self.n.at(n) & 0xff;
        return k == k::FunctionExpression || k == k::ArrowFunctionExpression;
    }

    pub(crate) fn print_call_arguments(&mut self, n: i32) -> R<()> {
        let args = self.n.at(n + 5);
        let count = self.n.at(args);
        if count == 0 {
            let g = self.group_open();
            self.text(LPAREN);
            self.print_dangling_comments_in_list(n);
            self.text(RPAREN);
            self.group_close(g);
            return Ok(());
        }
        if self.is_react_hook_call_with_deps_array(args) {
            self.text(LPAREN);
            let mut i: i32 = 1;
            while i <= count {
                self.print(self.n.at(args + i))?;
                if i != count {
                    self.text(COMMA_SPACE);
                }
                i += 1;
            }
            self.text(RPAREN);
            return Ok(());
        }
        let mut any_arg_empty_line = false;
        let mut i: i32 = 1;
        while i < count {
            if self.is_next_line_empty(self.n.at(args + i)) {
                any_arg_empty_line = true;
            }
            i += 1;
        }
        if any_arg_empty_line
            || ((self.n.at(self.n.at(n + 3)) & 0xff) != k::Decorator
                && self.is_function_composition_arguments(args))
        {
            let g = self.group_open();
            self.text(LPAREN);
            self.indent_line();
            self.print_arguments_range(args, 1, count)?;
            self.print_trailing_comma_all(n);
            self.dedent_line();
            self.text(RPAREN);
            self.group_close_with(g, true, 0);
            return Ok(());
        }
        if self.should_expand_first_arg(args)? {
            let first = self.n.at(args + 1);
            let mut h = self.detach_open();
            self.print(self.n.at(args + 2))?;
            let tail = self.detach_close(h);
            let mut expanded: i32 = 0;
            if !self.doc_will_break(tail) {
                let cp = self.checkpoint();
                h = self.detach_open();
                self.print_node(first, ARG_EXPAND_FIRST | ARG_SHARE)?;
                expanded = self.detach_close(h);
                if self.print.bailout {
                    self.set_bailout(false);
                    self.rollback(cp);
                    expanded = 0;
                } else {
                    self.commit(cp);
                }
            }
            if expanded == 0 {
                let g = self.group_open();
                self.text(LPAREN);
                self.indent_line();
                self.print(first)?;
                self.text(COMMA);
                self.line();
                self.call(tail);
                self.print_trailing_comma_all(n);
                self.dedent_line();
                self.text(RPAREN);
                self.group_close_with(g, true, 0);
                return Ok(());
            }
            let breaks = self.doc_will_break(expanded);
            if breaks {
                self.break_parent();
            }
            let c = self.cond_open();
            let mut st: i32;
            if !breaks {
                st = self.state_open();
                self.text(LPAREN);
                self.call(expanded);
                self.text(COMMA_SPACE);
                self.call(tail);
                self.text(RPAREN);
                self.state_close(st);
            }
            st = self.state_open();
            self.text(LPAREN);
            let mut g = self.group_open();
            self.call(expanded);
            self.group_close_with(g, true, 0);
            self.text(COMMA_SPACE);
            self.call(tail);
            self.text(RPAREN);
            self.state_close(st);
            st = self.state_open();
            g = self.group_open();
            self.text(LPAREN);
            self.indent_line();
            self.print_node(first, ARG_SHARE)?;
            self.text(COMMA);
            self.line();
            self.call(tail);
            self.print_trailing_comma_all(n);
            self.dedent_line();
            self.text(RPAREN);
            self.group_close_with(g, true, 0);
            self.state_close(st);
            self.cond_close(c, false);
            return Ok(());
        }
        if self.should_expand_last_arg(args)? {
            let last = self.n.at(args + count);
            // `a()((): B => {})`: the long way breaks the return type where Prettier gives the function a line of its own
            if (self.n.at(self.n.at(n + 4)) & 0xff) == k::CallExpression
                && (self.n.at(last) & 0xff) == k::ArrowFunctionExpression
                && self.n.at(last + FN_RETURN_TYPE) != 0
            {
                return Err(self.rare(rare::UNLIKE_PRETTIER));
            }
            let mut head: i32 = 0;
            if count > 1 {
                let h = self.detach_open();
                self.print_arguments_range(args, 1, count - 1)?;
                head = self.detach_close(h);
            }
            let mut expanded: i32 = 0;
            if head == 0 || !self.doc_will_break(head) {
                let cp = self.checkpoint();
                let h = self.detach_open();
                self.print_node(last, ARG_EXPAND_LAST | ARG_SHARE)?;
                expanded = self.detach_close(h);
                if self.print.bailout {
                    self.set_bailout(false);
                    self.rollback(cp);
                    expanded = 0;
                } else {
                    self.commit(cp);
                }
            }
            if expanded == 0 {
                let g = self.group_open();
                self.text(LPAREN);
                self.indent_line();
                if head != 0 {
                    self.call(head);
                }
                self.print(last)?;
                self.print_trailing_comma_all(n);
                self.dedent_line();
                self.text(RPAREN);
                self.group_close_with(g, true, 0);
                return Ok(());
            }
            let breaks = self.doc_will_break(expanded);
            if breaks {
                self.break_parent();
            }
            let c = self.cond_open();
            let mut st: i32;
            if !breaks {
                st = self.state_open();
                self.text(LPAREN);
                if head != 0 {
                    self.call(head);
                }
                self.call(expanded);
                self.text(RPAREN);
                self.state_close(st);
            }
            st = self.state_open();
            self.text(LPAREN);
            if head != 0 {
                self.call(head);
            }
            let mut g = self.group_open();
            self.call(expanded);
            self.group_close_with(g, true, 0);
            self.text(RPAREN);
            self.state_close(st);
            st = self.state_open();
            g = self.group_open();
            self.text(LPAREN);
            self.indent_line();
            if head != 0 {
                self.call(head);
            }
            if self.depends_on_args(last) {
                self.print_node(last, ARG_SHARE)?;
            } else {
                self.call(expanded);
            }
            self.print_trailing_comma_all(n);
            self.dedent_line();
            self.text(RPAREN);
            self.group_close_with(g, true, 0);
            self.state_close(st);
            self.cond_close(c, false);
            return Ok(());
        }
        let curried = self.is_long_curried_call_expression(n);
        let g = if curried { 0 } else { self.group_open() };
        let breaks = self.doc.wb_count;
        self.text(LPAREN);
        self.indent_softline();
        self.print_arguments_range(args, 1, count)?;
        let should_break = self.doc.wb_count != breaks;
        self.print_trailing_comma_all(n);
        self.dedent_softline();
        self.text(RPAREN);
        if !curried {
            self.group_close_with(g, should_break, 0);
        }
        Ok(())
    }

    // ------------------------------------------------------------------------------------------------------------ calls
    pub(crate) fn print_callee(&mut self, n: i32) -> R<()> {
        let k = self.n.at(n) & 0xff;
        if k == k::ImportExpression {
            self.text(IMPORT);
            let phase = ((self.n.at(n) as u32) >> SUB_SHIFT) as i32 & P_MASK;
            if phase == P_DEFER {
                self.text(DOT_DEFER);
            } else if phase == P_SOURCE {
                self.text(DOT_SOURCE);
            }
            return Ok(());
        }
        if k == k::ImportType {
            self.text(IMPORT);
            return Ok(());
        }
        if k == k::ExternalModuleReference {
            self.text(REQUIRE);
            return Ok(());
        }
        if k == k::NewExpression {
            self.text(NEW_);
        }
        self.print(self.n.at(n + 4))?;
        self.line_suffix_boundary();
        Ok(())
    }

    pub(crate) fn prints_arguments_on_one_line(&mut self, n: i32) -> R<bool> {
        let args = self.n.at(n + 5);
        if self.n.at(args) == 1 && self.is_template_on_its_own_line(self.n.at(args + 1)) {
            return Ok(self.embed_label_of(self.n.at(args + 1))? == 0);
        }
        return Ok(self.is_simple_module_import(n)
            || self.is_commons_js_or_amd_module_definition(n)
            || self.is_test_call(n, self.n.at(n + 3))?);
    }

    pub(crate) fn is_member_chain_call(&self, n: i32) -> R<bool> {
        return Ok((self.n.at(n) & 0xff) == k::CallExpression
            && self.is_memberish(self.n.at(n + 4))
            && !self.needs_parens(self.n.at(n + 4))?);
    }

    pub(crate) fn print_type_arguments(&mut self, n: i32, k: i32) -> R<()> {
        if self.n.at(n + 6) == 0 || k == k::ImportType {
            return Ok(());
        }
        self.print(self.n.at(n + 6))?;
        self.line_suffix_boundary();
        Ok(())
    }

    pub(crate) fn print_call_expression(&mut self, n: i32) -> R<()> {
        let k = self.n.at(n) & 0xff;
        if self.prints_arguments_on_one_line(n)? {
            self.print_callee(n)?;
            if (self.n.at(n) & F_OPTIONAL) != 0 {
                self.text(QUESTION_DOT);
            }
            self.print_type_arguments(n, k)?;
            self.text(LPAREN);
            let args = self.n.at(n + 5);
            let count = self.n.at(args);
            let mut i: i32 = 1;
            while i <= count {
                if i > 1 {
                    self.text(COMMA_SPACE);
                }
                self.print(self.n.at(args + i))?;
                i += 1;
            }
            self.text(RPAREN);
            self.set_label(0);
            return Ok(());
        }
        if self.is_member_chain_call(n)? {
            self.print_member_chain(n)?;
            return Ok(());
        }
        let should_group = k == k::ImportExpression
            || k == k::ImportType
            || k == k::ExternalModuleReference
            || self.is_call_expression(self.n.at(n + 4));
        let g = if should_group { self.group_open() } else { 0 };
        self.print_callee(n)?;
        if (self.n.at(n) & F_OPTIONAL) != 0 {
            self.text(QUESTION_DOT);
        }
        self.print_type_arguments(n, k)?;
        self.print_call_arguments(n)?;
        if should_group {
            self.group_close(g);
        }
        self.set_label(0);
        Ok(())
    }
}
pub(crate) const LINK_EMPTY_LINE_AFTER: i32 = 1;
impl Quick {
    pub(crate) fn ch_reserve(&mut self, words: i32) {
        if self.print_call.ch_top + words > (self.print_call.ch.len() as i32) {
            self.make_room(|q| &mut q.print_call.ch, self.print_call.ch_top + words);
        }
    }

    pub(crate) fn ch_push(&mut self, value: i32) {
        self.print_call.ch.put(self.print_call.ch_top, value);
        self.print_call.ch_top += 1;
    }

    pub(crate) fn should_insert_empty_line_after(&self, n: i32) -> bool {
        let next = self.next_char_index(self.n.at(n + 2));
        if self.t.at(next) == 41 {
            return self.is_next_line_empty_after(next + 1);
        }
        return self.is_next_line_empty(n);
    }

    /// Pushes the links of the chain that ends in the call `n`. Returns their number.
    pub(crate) fn flatten_chain(&mut self, n: i32) -> R<i32> {
        let base = self.print_call.ch_top;
        self.ch_reserve(2);
        self.print_call.ch.put(self.print_call.ch_top, n);
        self.print_call.ch.put(self.print_call.ch_top + 1, 0);
        self.print_call.ch_top += 2;
        let mut cur = self.n.at(n + 4);
        loop {
            self.ch_reserve(2);
            self.print_call.ch.put(self.print_call.ch_top, cur);
            self.print_call.ch.put(self.print_call.ch_top + 1, 0);
            self.print_call.ch_top += 2;
            if self.is_call_expression(cur)
                && (self.is_memberish(self.n.at(cur + 4)) || self.is_call_link(self.n.at(cur + 4)))
                && !self.needs_parens(cur)?
            {
                if self.should_insert_empty_line_after(cur) {
                    self.print_call
                        .ch
                        .put(self.print_call.ch_top - 1, LINK_EMPTY_LINE_AFTER);
                }
                cur = self.n.at(cur + 4);
            } else if (self.is_memberish(cur) || (self.n.at(cur) & 0xff) == k::NonNullExpression)
                && !self.needs_parens(cur)?
            {
                cur = self.n.at(cur + 4);
            } else {
                break;
            }
        }
        // the head first
        let mut i = base;
        let mut j = self.print_call.ch_top - 2;
        while i < j {
            let node = self.print_call.ch.at(i);
            let flags = self.print_call.ch.at(i + 1);
            self.print_call.ch.put(i, self.print_call.ch.at(j));
            self.print_call.ch.put(i + 1, self.print_call.ch.at(j + 1));
            self.print_call.ch.put(j, node);
            self.print_call.ch.put(j + 1, flags);
            i += 2;
            j -= 2;
        }
        return Ok((self.print_call.ch_top - base) >> 1);
    }

    /// Is `n`, the head of a chain or what a link of it calls, a call? `(a?.())` is a ChainExpression in the trees of TypeScript's and
    /// of Flow's parser.
    fn is_call_link(&self, n: i32) -> bool {
        self.is_call_expression(n)
            && ((self.n.at(n) & (F_PAREN | F_CHAIN)) != (F_PAREN | F_CHAIN)
                || !self.mode.wraps_chains)
    }

    pub(crate) fn is_computed_numeric(&self, n: i32) -> bool {
        return (self.n.at(n) & (0xff | F_COMPUTED)) == (k::MemberExpression | F_COMPUTED)
            && (self.n.at(self.n.at(n + 5)) & 0xff) == k::NumericLiteral;
    }

    /// Pushes the index of the first link of each group, then one more: the number of links. Returns the number of groups.
    pub(crate) fn group_chain(&mut self, base: i32, count: i32) -> i32 {
        let groups_base = self.print_call.ch_top;
        self.ch_reserve(count + 2);
        self.ch_push(0);
        let mut i: i32 = 1;
        'l0: while i < count {
            'c1: {
                let node = self.print_call.ch.at(base + i * 2);
                if self.is_call_expression(node)
                    || self.is_computed_numeric(node)
                    || (self.n.at(node) & 0xff) == k::NonNullExpression
                {
                    break 'c1;
                }
                break 'l0;
            }
            i += 1;
        }
        if !self.is_call_link(self.print_call.ch.at(base)) {
            'l2: while i + 1 < count {
                'c3: {
                    if self.is_memberish(self.print_call.ch.at(base + i * 2))
                        && self.is_memberish(self.print_call.ch.at(base + i * 2 + 2))
                    {
                        break 'c3;
                    }
                    break 'l2;
                }
                i += 1;
            }
        }
        let mut current_start = i;
        let mut has_seen_call_expression = false;
        while i < count {
            'c5: {
                let node = self.print_call.ch.at(base + i * 2);
                if has_seen_call_expression && self.is_memberish(node) {
                    if self.is_computed_numeric(node) {
                        break 'c5;
                    }
                    self.ch_push(current_start);
                    current_start = i;
                    has_seen_call_expression = false;
                }
                let k = self.n.at(node) & 0xff;
                if k == k::CallExpression || k == k::ImportExpression {
                    has_seen_call_expression = true;
                }
                if self.has_trailing_comment(node) {
                    self.ch_push(current_start);
                    current_start = i + 1;
                    has_seen_call_expression = false;
                }
            }
            i += 1;
        }
        if current_start < count {
            self.ch_push(current_start);
        }
        let groups = self.print_call.ch_top - groups_base;
        self.ch_push(count);
        return groups;
    }

    pub(crate) fn is_factory_name(&self, n: i32) -> bool {
        let start = self.n.at(n + 1);
        let end = self.n.at(n + 2);
        let c = self.t.at(start);
        if c >= 65 && c <= 90 {
            return true;
        }
        let mut p = start;
        while p < end {
            if self.t.at(p) != 36 && self.t.at(p) != 95 {
                return false;
            }
            p += 1;
        }
        return end > start;
    }

    pub(crate) fn analyze_chain(
        &mut self,
        n: i32,
        base: i32,
        count: i32,
        groups_base: i32,
        groups: i32,
    ) {
        let mut should_merge = false;
        if groups >= 2 {
            let second_start = self.print_call.ch.at(groups_base + 1);
            let second = self.print_call.ch.at(base + second_start * 2);
            if !self.has_comment(second) {
                let has_computed =
                    (self.n.at(second) & (0xff | F_COMPUTED)) == (k::MemberExpression | F_COMPUTED);
                if second_start == 1 {
                    let first = self.print_call.ch.at(base);
                    let fk = self.n.at(first) & 0xff;
                    if fk == k::ThisExpression {
                        should_merge = true;
                    } else if fk == k::Identifier {
                        let is_expression_statement =
                            (self.n.at(self.n.at(n + 3)) & 0xff) == k::ExpressionStatement;
                        should_merge = self.is_factory_name(first)
                            || (is_expression_statement
                                && self.utf16_length(self.n.at(first + 1), self.n.at(first + 2))
                                    <= self.options.tab_width)
                            || has_computed;
                    }
                } else {
                    let last = self.print_call.ch.at(base + (second_start - 1) * 2);
                    should_merge = self.is_member_expression(last)
                        && (self.n.at(self.n.at(last + 5)) & 0xff) == k::Identifier
                        && (self.is_factory_name(self.n.at(last + 5)) || has_computed);
                }
            }
        }
        let cutoff = if should_merge { 3 } else { 2 };
        let mut node_has_comment = false;
        let mut i: i32 = 1;
        while i < count - 1 {
            if self.has_leading_comment(self.print_call.ch.at(base + i * 2)) {
                node_has_comment = true;
            }
            i += 1;
        }
        let mut i: i32 = 0;
        while i < count - 1 {
            if self.has_trailing_comment(self.print_call.ch.at(base + i * 2)) {
                node_has_comment = true;
            }
            i += 1;
        }
        if groups > cutoff
            && self.has_leading_comment(
                self.print_call
                    .ch
                    .at(base + self.print_call.ch.at(groups_base + cutoff) * 2),
            )
        {
            node_has_comment = true;
        }
        let mut is_short = groups <= cutoff && !node_has_comment;
        if is_short {
            let mut g: i32 = 0;
            while g < groups {
                if (self
                    .print_call
                    .ch
                    .at(base + (self.print_call.ch.at(groups_base + g + 1) - 1) * 2 + 1)
                    & LINK_EMPTY_LINE_AFTER)
                    != 0
                {
                    is_short = false;
                }
                g += 1;
            }
        }
        self.print_call.chain_should_merge = should_merge;
        self.print_call.chain_has_comment = node_has_comment;
        self.print_call.chain_is_short = is_short;
    }

    /// `a.b.c(..)`: the call `n` is the only call of its chain, the head is no call, and there are no comments. That makes two groups at
    /// most, which is a short chain whatever else is true of it. Eight chains in ten are like that. Pushes the links, the head last, and
    /// returns their number; or 0, with nothing pushed.
    pub(crate) fn push_plain_links(&mut self, n: i32) -> R<i32> {
        let base = self.print_call.ch_top;
        let mut cur = self.n.at(n + 4);
        loop {
            let head = self.n.at(cur);
            if (head & F_COMMENTS) != 0 {
                break;
            }
            self.ch_reserve(1);
            self.print_call.ch.put(self.print_call.ch_top, cur);
            self.print_call.ch_top += 1;
            let k = head & 0xff;
            if (k == k::MemberExpression || k == k::NonNullExpression) && !self.needs_parens(cur)? {
                cur = self.n.at(cur + 4);
                continue;
            }
            if k == k::CallExpression || k == k::ImportExpression {
                break;
            }
            return Ok(self.print_call.ch_top - base);
        }
        self.print_call.ch_top = base;
        return Ok(0);
    }

    /// Would print_call_expression(n) return a doc with the label "member-chain"?
    pub(crate) fn is_member_chain_labeled(&mut self, n: i32) -> R<bool> {
        if self.prints_arguments_on_one_line(n)? || !self.is_member_chain_call(n)? {
            return Ok(false);
        }
        let plain = self.push_plain_links(n)?;
        if plain != 0 {
            self.print_call.ch_top -= plain;
            return Ok(false);
        }
        let base = self.print_call.ch_top;
        let count = self.flatten_chain(n)?;
        let groups_base = self.print_call.ch_top;
        let groups = self.group_chain(base, count);
        self.analyze_chain(n, base, count, groups_base, groups);
        self.print_call.ch_top = base;
        return Ok(!self.print_call.chain_is_short);
    }

    pub(crate) fn print_link(&mut self, base: i32, i: i32, count: i32) -> R<()> {
        self.reserve();
        let node = self.print_call.ch.at(base + i * 2);
        if i == 0 {
            self.print(node)?;
            return Ok(());
        }
        let is_top = i == count - 1;
        let comments = !is_top && self.has_comment(node);
        if comments {
            self.print_leading_comments(node);
        }
        let k = self.n.at(node) & 0xff;
        if k == k::CallExpression {
            if (self.n.at(node) & F_OPTIONAL) != 0 {
                self.text(QUESTION_DOT);
            }
            self.print(self.n.at(node + 6))?;
            self.print_call_arguments(node)?;
        } else if k == k::MemberExpression {
            self.print_member_lookup(node)?;
        } else if k == k::NonNullExpression {
            self.text(BANG);
        } else {
            self.text(DOUBLE_COLON);
            self.print(self.n.at(node + 5))?;
        }
        if comments {
            self.print_trailing_comments(node);
        }
        if (self.print_call.ch.at(base + i * 2 + 1) & LINK_EMPTY_LINE_AFTER) != 0 {
            self.hardline();
        }
        Ok(())
    }

    pub(crate) fn print_links(&mut self, base: i32, from: i32, to: i32, count: i32) -> R<()> {
        let mut i = from;
        while i < to {
            self.print_link(base, i, count)?;
            i += 1;
        }
        Ok(())
    }

    pub(crate) fn print_member_chain(&mut self, n: i32) -> R<()> {
        if self.doc.remove_lines_depth != 0 {
            return Err(self.rare(rare::HUGGED_CHAIN));
        }
        let base = self.print_call.ch_top;
        let plain = self.push_plain_links(n)?;
        if plain != 0 {
            let curried = self.is_long_curried_call_expression(n);
            let g = if curried { 0 } else { self.group_open() };
            self.print(self.print_call.ch.at(base + plain - 1))?;
            let mut i = plain - 2;
            while i >= 0 {
                self.reserve();
                let node = self.print_call.ch.at(base + i);
                if (self.n.at(node) & 0xff) == k::MemberExpression {
                    self.print_member_lookup(node)?;
                } else {
                    self.text(BANG);
                }
                i -= 1;
            }
            if (self.n.at(n) & F_OPTIONAL) != 0 {
                self.text(QUESTION_DOT);
            }
            self.print(self.n.at(n + 6))?;
            self.print_call_arguments(n)?;
            if !curried {
                self.group_close(g);
            }
            self.print_call.ch_top = base;
            self.set_label(0);
            return Ok(());
        }
        let count = self.flatten_chain(n)?;
        let groups_base = self.print_call.ch_top;
        let groups = self.group_chain(base, count);
        self.analyze_chain(n, base, count, groups_base, groups);
        let should_merge = self.print_call.chain_should_merge;
        let node_has_comment = self.print_call.chain_has_comment;
        if self.print_call.chain_is_short {
            let curried = self.is_long_curried_call_expression(n);
            let g = if curried { 0 } else { self.group_open() };
            self.print_links(base, 0, count, count)?;
            if !curried {
                self.group_close(g);
            }
            self.print_call.ch_top = base;
            self.set_label(0);
            return Ok(());
        }
        let first_indented = if should_merge { 2 } else { 1 };
        let last_before_indent = self
            .print_call
            .ch
            .at(base + (self.print_call.ch.at(groups_base + first_indented) - 1) * 2);
        let empty_line_before_indent = !self.is_call_expression(last_before_indent)
            && self.should_insert_empty_line_after(last_before_indent);
        let mut calls: i32 = 0;
        let mut any_complex_argument = false;
        let mut i: i32 = 0;
        while i < count {
            'c2: {
                let node = self.print_call.ch.at(base + i * 2);
                if !(if i == 0 {
                    self.is_call_link(node)
                } else {
                    self.is_call_expression(node)
                }) {
                    break 'c2;
                }
                calls += 1;
                let args = self.n.at(node + 5);
                let mut j: i32 = 1;
                while j <= self.n.at(args) && !any_complex_argument {
                    if !self.is_simple_call_argument(self.n.at(args + j), 2)? {
                        any_complex_argument = true;
                    }
                    j += 1;
                }
            }
            i += 1;
        }
        if node_has_comment || (calls > 2 && any_complex_argument) {
            // expanded, and nothing else: straight into the stream
            let g = self.group_open();
            self.print_links(
                base,
                0,
                self.print_call.ch.at(groups_base + first_indented),
                count,
            )?;
            if empty_line_before_indent {
                self.hardline();
            }
            if groups > first_indented {
                self.indent_open();
                let mut gi = first_indented;
                while gi < groups {
                    self.hardline();
                    self.print_links(
                        base,
                        self.print_call.ch.at(groups_base + gi),
                        self.print_call.ch.at(groups_base + gi + 1),
                        count,
                    )?;
                    gi += 1;
                }
                self.indent_close();
            }
            self.group_close(g);
            self.print_call.ch_top = base;
            self.set_label(LABEL_MEMBER_CHAIN);
            return Ok(());
        }
        // each group once, detached
        let docs = self.print_call.ch_top;
        self.ch_reserve(groups);
        self.print_call.ch_top += groups;
        let mut any_but_last_breaks = false;
        let mut last_breaks = false;
        let mut gi: i32 = 0;
        while gi < groups {
            let h = self.detach_open();
            self.print_links(
                base,
                self.print_call.ch.at(groups_base + gi),
                self.print_call.ch.at(groups_base + gi + 1),
                count,
            )?;
            let doc = self.detach_close(h);
            self.print_call.ch.put(docs + gi, doc);
            if self.doc_will_break(doc) {
                if gi < groups - 1 {
                    any_but_last_breaks = true;
                } else {
                    last_breaks = true;
                }
            }
            gi += 1;
        }
        let mut expanded_only = any_but_last_breaks;
        if !expanded_only && last_breaks {
            // the last group breaks anyway, and another call takes a function
            let mut i: i32 = 0;
            while i < count - 1 && !expanded_only {
                'c7: {
                    let node = self.print_call.ch.at(base + i * 2);
                    if !(if i == 0 {
                        self.is_call_link(node)
                    } else {
                        self.is_call_expression(node)
                    }) {
                        break 'c7;
                    }
                    let args = self.n.at(node + 5);
                    let mut j: i32 = 1;
                    while j <= self.n.at(args) {
                        if self.is_function_or_arrow(self.n.at(args + j)) {
                            expanded_only = true;
                        }
                        j += 1;
                    }
                }
                i += 1;
            }
        }
        let mut c: i32 = 0;
        let mut st: i32 = 0;
        if !expanded_only {
            if last_breaks || empty_line_before_indent {
                self.break_parent();
            }
            c = self.cond_open();
            st = self.state_open();
            let mut gi: i32 = 0;
            while gi < groups {
                self.reserve();
                self.call(self.print_call.ch.at(docs + gi));
                gi += 1;
            }
            self.state_close(st);
            st = self.state_open();
        }
        let g = if expanded_only { self.group_open() } else { 0 };
        let mut gi: i32 = 0;
        while gi < first_indented {
            self.call(self.print_call.ch.at(docs + gi));
            gi += 1;
        }
        if empty_line_before_indent {
            self.hardline();
        }
        if groups > first_indented {
            self.indent_open();
            let mut gi = first_indented;
            while gi < groups {
                self.reserve();
                self.hardline();
                self.call(self.print_call.ch.at(docs + gi));
                gi += 1;
            }
            self.indent_close();
        }
        if expanded_only {
            self.group_close(g);
        } else {
            self.state_close(st);
            self.cond_close(c, false);
        }
        self.print_call.ch_top = base;
        self.set_label(LABEL_MEMBER_CHAIN);
        Ok(())
    }
}

static TEST_CALLEES: [&[u8]; 26] = [
    b"it",
    b"it.only",
    b"it.skip",
    b"describe",
    b"describe.only",
    b"describe.skip",
    b"test",
    b"test.only",
    b"test.skip",
    b"test.fixme",
    b"test.step",
    b"test.describe",
    b"test.describe.only",
    b"test.describe.skip",
    b"test.describe.fixme",
    b"test.describe.parallel",
    b"test.describe.parallel.only",
    b"test.describe.serial",
    b"test.describe.serial.only",
    b"skip",
    b"xit",
    b"xdescribe",
    b"xtest",
    b"fit",
    b"fdescribe",
    b"ftest",
];

impl Quick {
    fn is_one_of_test_callees(&self, n: i32) -> bool {
        TEST_CALLEES
            .iter()
            .any(|path| self.is_node_matches_path(n, path))
    }
}
