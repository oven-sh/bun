//! Gives every comment to a node, the way Prettier does (src/main/comments/attach.js and
//! src/language-js/comments/handle-comments.js).
//!
//! Comments come in source order, so the search for the enclosing node does not start at the root each time: the path to
//! the previous comment stays on a stack, together with the sorted children of each node on it. A node's children are
//! collected at most once, and only for nodes that hold a comment.

use crate::arena::SUB_SHIFT;
use crate::ast::{
    CL_EXTENDS, CL_IMPLEMENTS, CL_MIXINS, CL_TYPE_PARAMETERS, EXT_AT, F_CHAIN, F_DANGLING, F_EXT,
    F_LEADING, F_LINES, F_PAREN, F_SHORTHAND, F_TRAILING, FN_RETURN_TYPE, M_MASK, M_METHOD,
    MOD_ABSTRACT, MOD_DECLARE, SHAPE, k,
};
use crate::lexer::{
    C_ENCLOSING, C_END, C_FLAGS, C_FOLLOWING, C_NEXT, C_NODE, C_PRECEDING, C_START, C_STRIDE,
    CF_BLOCK, CF_CLAIMED, CF_INDENTABLE, CF_PLAIN,
};
use crate::parse::core::TYPED_FLOW;
use crate::scan::{is_blank, is_space, is_white};
use crate::{LARGEST, Quick, R, Words, rare, why, zeros};

pub(crate) struct Comments {
    // ---- node -> its comments: an open addressing table of [node, first, last]
    /// It is emptied once per file. Code that is embedded in code that is embedded in this language adds its nodes to it.
    /// Every file starts with a small table at the front of the array, so that emptying it does not cost what the largest file so far
    /// needed.
    pub(crate) map: Vec<i32>,
    pub(crate) map_mask: i32,
    /// how many more nodes it can take
    pub(crate) map_room: i32,
    /// How many comments were attached behind a node since reset_comments(). Only those are printed as line suffixes.
    pub(crate) trailing_count: i32,
    // ---- children
    pub(crate) ch: Vec<i32>,
    pub(crate) ch_pos: i32,
    /// the path: [node, first child, behind the last child]
    pub(crate) path: Vec<i32>,
    pub(crate) path_pos: i32,
    // ---- ties
    pub(crate) ties: Vec<i32>,
    pub(crate) tie_count: i32,
    // ---- the handlers. They read these instead of taking a context object.
    pub(crate) h_comment: i32,
    pub(crate) h_start: i32,
    pub(crate) h_end: i32,
    pub(crate) h_enclosing: i32,
    pub(crate) h_preceding: i32,
    pub(crate) h_following: i32,
    pub(crate) h_enclosing_kind: i32,
    pub(crate) h_preceding_kind: i32,
    pub(crate) h_following_kind: i32,
    pub(crate) h_is_block: bool,
    // ---- see characters_around_comment()
    /// the last comment between the two tokens
    pub(crate) gap_last: i32,
    pub(crate) gap_before: i32,
    pub(crate) gap_behind: i32,
    /// behind a `(`, the first character of the token that follows it
    pub(crate) gap_in_parentheses: i32,
    /// next_char_index() behind the comments between the two tokens, if `gap_next_of` is `gap_last`
    pub(crate) gap_next: i32,
    pub(crate) gap_next_of: i32,
    // ---- What is the same for a comment and the next one in a row, so that a row is looked through once: see the functions that ask.
    /// the comment that is_own_line() was asked about last, and the answer
    pub(crate) own_line_of: i32,
    pub(crate) is_own_line: bool,
    /// the comments for which is_end_of_line() has the same answer, and the answer
    pub(crate) end_of_line_from: i32,
    pub(crate) end_of_line_to: i32,
    pub(crate) is_end_of_line: bool,
    /// what was looked for last from a place that depends on the nodes around a comment alone: what, from where, and where it is
    pub(crate) sought: [i32; 3],
    /// see has_newline_before_comment_from(): from where, up to where there is no line break, and up to where there is one (or 0)
    pub(crate) lines_from: [[i32; 3]; 2],
    /// see should_attach_to_union_type_first_element(): the type, from where on its line was looked through, up to where, and whether that is the type
    pub(crate) union_line: [i32; 3],
    pub(crate) union_line_is_clear: bool,
    /// see is_asked_first(): a bit for each word of a node
    pub(crate) asked: Vec<u64>,
    pub(crate) h_placement: i32,
    pub(crate) h_is_last: bool,
}
impl Comments {
    pub(crate) fn new() -> Self {
        Self {
            map: zeros(192),
            map_mask: 63,
            map_room: 0,
            trailing_count: 0,
            ch: zeros(1024),
            ch_pos: 0,
            path: zeros(768),
            path_pos: 0,
            ties: zeros(64),
            tie_count: 0,
            h_comment: 0,
            h_start: 0,
            h_end: 0,
            h_enclosing: 0,
            h_preceding: 0,
            h_following: 0,
            h_enclosing_kind: 0,
            h_preceding_kind: 0,
            h_following_kind: 0,
            h_is_block: false,
            gap_last: -1,
            gap_before: 0,
            gap_behind: 0,
            gap_in_parentheses: 0,
            gap_next: 0,
            gap_next_of: NO_COMMENT,
            own_line_of: NO_COMMENT,
            is_own_line: false,
            end_of_line_from: 0,
            end_of_line_to: NO_COMMENT,
            is_end_of_line: false,
            sought: [0; 3],
            lines_from: [[0; 3]; 2],
            union_line: [0; 3],
            union_line_is_clear: false,
            asked: Vec::new(),
            h_placement: 0,
            h_is_last: false,
        }
    }
}

/// (-1 is the comment before the first one)
const NO_COMMENT: i32 = -2;

// What is looked for: see Comments::sought.
const SOUGHT_BRACKET: i32 = 1;
const SOUGHT_ELSE: i32 = 2;
const SOUGHT_LAST_PAREN: i32 = 3;
const SOUGHT_PAREN: i32 = 4;
const SOUGHT_EQUALS: i32 = 5;
const SOUGHT_ARROW: i32 = 6;
const SOUGHT_NEXT: i32 = 7;
const SOUGHT_LINE_BREAK: i32 = 8;

const OWN_LINE: i32 = 1;
const OWN_BLOCK: i32 = 2;
const END_LINE: i32 = 4;
const END_BLOCK: i32 = 8;
const MID_BLOCK: i32 = 16;

/// Which comments are taken inside a node of this kind: line comments and block comments that stand on lines of their own, at the end of
/// a line, or (block comments) with code behind them on their line. An entry stands for real code, and for comments of every form put into
/// every gap of real code, on which the long way prints the same; where it prints something else even once, or nothing is known, there is none.
fn comments_taken_in(kind: i32) -> i32 {
    match kind {
        k::ArrayExpression
        | k::ArrayPattern
        | k::AsExpression
        | k::AssignmentExpression
        | k::AwaitExpression
        | k::BinaryExpression
        | k::CallExpression
        | k::CatchClause
        | k::ClassBody
        | k::ClassDeclaration
        | k::ClassMethod
        | k::ClassProperty
        | k::DeclareModuleExports
        | k::EnumBody
        | k::EnumDeclaration
        | k::ExportAllDeclaration
        | k::ExportNamedDeclaration
        | k::ExportSpecifier
        | k::ForInStatement
        | k::ForOfStatement
        | k::ForStatement
        | k::FunctionDeclaration
        | k::FunctionExpression
        | k::FunctionType
        | k::Heritage
        | k::ImportDeclaration
        | k::ImportNamespaceSpecifier
        | k::ImportSpecifier
        | k::ImportType
        | k::IndexSignature
        | k::InterfaceDeclaration
        | k::IntersectionType
        | k::JSXAttribute
        | k::JSXExpressionContainer
        | k::JSXSpreadAttribute
        | k::LogicalExpression
        | k::MemberExpression
        | k::MethodSignature
        | k::ModuleDeclaration
        | k::NewExpression
        | k::NullableType
        | k::ObjectExpression
        | k::ObjectMethod
        | k::ObjectPattern
        | k::ObjectProperty
        | k::ObjectTypeSpreadProperty
        | k::PropertySignature
        | k::QualifiedName
        | k::RestElement
        | k::SequenceExpression
        | k::SpreadElement
        | k::SwitchCase
        | k::SwitchStatement
        | k::TSDeclareFunction
        | k::TryStatement
        | k::TupleType
        | k::TypeAlias
        | k::TypeAnnotation
        | k::TypeCastExpression
        | k::TypeLiteral
        | k::TypeOperator
        | k::TypeParameterDeclaration
        | k::TypeParameterInstantiation
        | k::TypeQuery
        | k::TypeReference
        | k::UpdateExpression
        | k::VariableDeclaration
        | k::VariableDeclarator
        | k::WhileStatement => OWN_LINE | OWN_BLOCK | END_LINE | MID_BLOCK,
        k::IndexedAccessType
        | k::JSXClosingElement
        | k::JSXClosingFragment
        | k::JSXEmptyExpression
        | k::JSXMemberExpression
        | k::NonNullExpression
        | k::ObjectTypeIndexer
        | k::ObjectTypeProperty
        | k::ThrowStatement
        | k::TypeParameter
        | k::TypePredicate => MID_BLOCK,
        k::BlockStatement
        | k::ConditionalExpression
        | k::IfStatement
        | k::InterfaceBody
        | k::JSXOpeningElement
        | k::Program
        | k::TemplateLiteral
        | k::UnionType => OWN_LINE | OWN_BLOCK | END_LINE | END_BLOCK | MID_BLOCK,
        k::ArrayType
        | k::ConditionalType
        | k::ImportExpression
        | k::MetaProperty
        | k::SatisfiesExpression => OWN_LINE | END_LINE | MID_BLOCK,
        k::ConstructSignature | k::JSXOpeningFragment | k::TaggedTemplateExpression => {
            OWN_LINE | MID_BLOCK
        }
        k::ArrowFunctionExpression | k::ModuleBlock => OWN_LINE | OWN_BLOCK | END_LINE,
        k::MappedType | k::ReturnStatement => OWN_LINE | OWN_BLOCK | MID_BLOCK,
        k::UnaryExpression => END_LINE | MID_BLOCK,
        k::EnumMember => OWN_LINE | OWN_BLOCK | END_LINE | MID_BLOCK,
        k::AssignmentPattern | k::FunctionTypeParam => OWN_BLOCK | MID_BLOCK,
        k::DoWhileStatement => OWN_LINE,
        _ => 0,
    }
}

/// A letter, a digit, a quote or part of a character beyond ASCII: the end or the start of a name, a number, a string or a template.
fn is_part_of_word(c: i32) -> bool {
    c >= 128
        || (c >= 48 && c <= 57)
        || ((c | 32) >= 97 && (c | 32) <= 122)
        || matches!(c, 95 | 36 | 34 | 39 | 96)
}

impl Quick {
    /// (The `!`s behind a chain are marked like the chain. Behind a chain in parentheses there are none: see parse_paren_and_distinguish().)
    pub(crate) fn is_part_of_optional_chain(&self, n: i32) -> bool {
        matches!(
            self.n.at(n) & 0xff,
            k::MemberExpression | k::CallExpression | k::NonNullExpression
        ) && (self.n.at(n) & F_CHAIN) != 0
    }

    /// Notes that the question `which` (0 to 2) has been asked about the node `n`, with the answer that lets the file go on. False if that
    /// was noted before. A text can have a comment at every level of a chain, so that what goes from a node to its parents for a comment must
    /// go over no node twice.
    fn is_asked_first(&mut self, n: i32, which: i32) -> bool {
        let bit = (n + which).max(0) as usize;
        let asked = &mut self.comments.asked;
        if asked.len() <= bit >> 6 {
            asked.resize((bit >> 6) + 1, 0);
        }
        let Some(word) = asked.get_mut(bit >> 6) else {
            return true;
        };
        let is_first = (*word >> (bit & 63)) & 1 == 0;
        *word |= 1 << (bit & 63);
        is_first
    }

    /// Is `n` what a `yield` yields, or what that starts with?
    fn starts_what_is_yielded(&mut self, mut n: i32) -> bool {
        loop {
            let parent = self.n.at(n + 3);
            if self.n.at(parent + 4) != n {
                return false;
            }
            match self.n.at(parent) & 0xff {
                k::YieldExpression => return true,
                k::MemberExpression
                | k::CallExpression
                | k::NonNullExpression
                | k::AsExpression
                | k::SatisfiesExpression
                | k::BinaryExpression
                | k::LogicalExpression
                | k::ConditionalExpression
                | k::TaggedTemplateExpression => n = parent,
                _ => return false,
            }
            if !self.is_asked_first(n, 0) {
                return false;
            }
        }
    }

    /// Is `n` the left side of an assignment or the key of a property, or what that starts with?
    fn starts_target(&mut self, mut n: i32) -> bool {
        loop {
            let parent = self.n.at(n + 3);
            if self.n.at(parent + 4) != n {
                return false;
            }
            match self.n.at(parent) & 0xff {
                k::AssignmentExpression | k::ObjectProperty | k::ClassProperty => return true,
                k::MemberExpression | k::CallExpression | k::NonNullExpression => n = parent,
                _ => return false,
            }
            if !self.is_asked_first(n, 1) {
                return false;
            }
        }
    }

    /// The last character of the token before the comment `i` and the first one of the token behind it, other comments aside; 0 at the
    /// ends of the text. They are the same for all comments between two tokens, however many those are.
    fn characters_around_comment(&mut self, i: i32) -> (i32, i32) {
        if i <= self.comments.gap_last {
            return (self.comments.gap_before, self.comments.gap_behind);
        }
        let mut before = self.lexer.c.at(i * C_STRIDE + C_START) - 1;
        let mut j = i - 1;
        loop {
            while is_white(self.t.at(before)) {
                before -= 1;
            }
            if j < self.lexer.c_base || self.lexer.c.at(j * C_STRIDE + C_END) != before + 1 {
                break;
            }
            before = self.lexer.c.at(j * C_STRIDE + C_START) - 1;
            j -= 1;
        }
        let mut behind = self.lexer.c.at(i * C_STRIDE + C_END);
        let mut j = i + 1;
        loop {
            behind = self.white(behind);
            if j >= self.lexer.c_count || self.lexer.c.at(j * C_STRIDE + C_START) != behind {
                break;
            }
            behind = self.lexer.c.at(j * C_STRIDE + C_END);
            j += 1;
        }
        self.comments.gap_last = j - 1;
        self.comments.gap_before = if before < self.text.src_start {
            0
        } else {
            self.t.at(before)
        };
        self.comments.gap_behind = if behind >= self.text.src_end {
            0
        } else {
            self.t.at(behind)
        };
        if self.comments.gap_behind == 40 {
            self.comments.gap_in_parentheses = self.next_significant_char(behind + 1);
        }
        (self.comments.gap_before, self.comments.gap_behind)
    }

    /// next_char_index() behind the comment at hand. What is between two comments of a row is passed by it, so it is the same for all of them.
    fn next_index_behind_comment(&mut self) -> i32 {
        self.characters_around_comment(self.comments.h_comment);
        if self.comments.gap_next_of != self.comments.gap_last {
            self.comments.gap_next_of = self.comments.gap_last;
            self.comments.gap_next = self.next_char_index(self.comments.h_end);
        }
        self.comments.gap_next
    }

    fn next_char_behind_comment(&mut self) -> i32 {
        let index = self.next_index_behind_comment();
        self.t.at(index)
    }

    /// What `find` finds from `from` on, which it is asked once for all the comments in a row.
    fn seek(&mut self, what: i32, from: i32, find: impl FnOnce(&Self, i32) -> i32) -> i32 {
        let [known_what, known_from, found] = self.comments.sought;
        if known_what == what && known_from == from {
            return found;
        }
        let found = find(self, from);
        self.comments.sought = [what, from, found];
        found
    }

    /// Is there a line break between `from`, which depends on the nodes around the comment at hand alone, and that comment? What was looked through
    /// for the comments before it is not looked through again. Who asks from another place for the same comment is another `who`.
    fn has_newline_before_comment_from(&mut self, from: i32, who: usize) -> bool {
        let to = self.comments.h_start;
        let Some(&[known_from, without, with]) = self.comments.lines_from.get(who) else {
            return self.has_newline_in_range(from, to);
        };
        let mut start = from;
        if known_from == from && without <= to {
            if with != 0 && with <= to {
                return true;
            }
            start = without;
        }
        let found = self.has_newline_in_range(start, to);
        if let Some(known) = self.comments.lines_from.get_mut(who) {
            *known = if found {
                [from, start, to]
            } else {
                [from, to, 0]
            };
        }
        found
    }

    /// Is the comment at hand, `i`, in a place where both ways are known to print it alike? The two give comments to nodes in ways of their
    /// own, and both deviate from Prettier somewhere, so that what is not known to be the same is left to the long way.
    fn is_comment_taken(&mut self, i: i32) -> bool {
        let (before, behind) = self.characters_around_comment(i);
        let c = &self.comments;
        let form = match (c.h_placement, c.h_is_block) {
            (CF_OWN_LINE, false) => OWN_LINE,
            (CF_OWN_LINE, true) => OWN_BLOCK,
            (CF_END_OF_LINE, false) => END_LINE,
            (CF_END_OF_LINE, true) => END_BLOCK,
            _ => MID_BLOCK,
        };
        let inside = c.h_enclosing_kind;
        if (comments_taken_in(inside) & form) == 0 {
            return false;
        }
        // `prettier-ignore`: on lines of its own, right before a statement, a member or a property that starts a line
        if self.is_prettier_ignore_comment(i)
            && !((form == OWN_LINE || form == OWN_BLOCK)
                && i == c.gap_last
                && c.h_following != 0
                // (several items that were read as one)
                && (self.n.at(c.h_following) & (0xff | F_LINES)) != (k::Ready | F_LINES)
                // (`if (a) break`, the end of the line: the `break` gets its `;`, which the long way gives only to a statement of its own)
                && !(self.options.semi
                    && matches!(
                        self.statement_kind(c.h_following),
                        k::IfStatement
                            | k::ForStatement
                            | k::ForInStatement
                            | k::ForOfStatement
                            | k::WhileStatement
                            | k::WithStatement
                            | k::LabeledStatement
                    )
                    && self.full_end(c.h_following) == self.n.at(c.h_following + 2)
                    && self.should_ignored_node_print_semicolon(c.h_following))
                // (what could go on the line before gets a `;` in front where there are no semicolons)
                && (self.options.semi || is_part_of_word(behind) || behind == 123)
                // (the long way drops the `;` of a `declare export` of Flow where there are no semicolons)
                && !(self.parse.typed == TYPED_FLOW
                    && matches!(
                        c.h_following_kind,
                        k::ExportNamedDeclaration | k::ExportDefaultDeclaration | k::ExportAllDeclaration
                    ))
                && (matches!(
                    inside,
                    k::Program | k::BlockStatement | k::ModuleBlock | k::ClassBody
                ) || (matches!(before, 123 | 59 | 44)
                    && (inside == k::ObjectExpression
                        // (in Flow the separator is no part of the member)
                        || (matches!(inside, k::InterfaceBody | k::TypeLiteral)
                            && self.parse.typed != TYPED_FLOW)))))
        {
            return false;
        }
        // at the start of what is yielded, which the long way gives parentheses then as if it were returned
        if (inside == k::MemberExpression || self.n.at(c.h_enclosing + 4) == c.h_following)
            && self.starts_what_is_yielded(c.h_enclosing)
        {
            return false;
        }
        let c = &self.comments;
        // between the decorators and what they decorate, on the line of that
        if c.h_is_block
            && c.h_preceding_kind == k::Decorator
            && self.t.at(self.blanks(c.h_end)) != 10
        {
            return false;
        }
        // it starts where another one ends
        if i > self.lexer.c_base && self.lexer.c.at((i - 1) * C_STRIDE + C_END) == c.h_start {
            return false;
        }
        // The first comment of a text follows nothing on its line.
        let starts_text = before == 0 && i == self.lexer.c_base;
        // Two that were made one are two on the long way, which gives each a node of its own. On lines of their own among statements
        // and members both go to the same one; a `@type` in either makes a type cast of JSDoc of it there.
        if (self.lexer.c.at(i * C_STRIDE + C_FLAGS) & CF_NESTLED) != 0
            && !((form == OWN_BLOCK || starts_text)
                && matches!(
                    inside,
                    k::Program
                        | k::BlockStatement
                        | k::ModuleBlock
                        | k::ClassBody
                        | k::InterfaceBody
                        | k::TypeLiteral
                )
                && !self.has_byte_in_range(64, c.h_start, c.h_end))
        {
            return false;
        }
        // What may be a type cast of JSDoc at the end of a line goes before the next statement or member: the long way puts the `;` that
        // guards a statement behind it, and no empty line before it in an interface.
        if form == END_BLOCK
            && (!self.options.semi || inside == k::InterfaceBody)
            && !(starts_text && (is_part_of_word(behind) || behind == 123))
            && self.is_type_cast_comment_at(i)
        {
            return false;
        }
        // Some trees have a node more around an optional chain. So none in a chain but among the arguments of a call that has some, none
        // before one but on lines of its own where the chain is an item of a list, an operand or a branch, none behind one but
        // on lines of its own behind a separator or an operator.
        if (self.is_part_of_optional_chain(c.h_enclosing)
            && !(inside == k::CallExpression && ((before == 40 && behind != 41) || before == 44)))
            || (self.is_part_of_optional_chain(c.h_following)
                && !(c.h_placement == CF_OWN_LINE
                    && behind != 40
                    && (self.n.at(c.h_following) & F_PAREN) == 0
                    && matches!(
                        inside,
                        k::CallExpression
                            | k::NewExpression
                            | k::ArrayExpression
                            | k::LogicalExpression
                            | k::BinaryExpression
                            | k::ConditionalExpression
                    )))
            || ((c.h_placement != CF_OWN_LINE
                || is_part_of_word(before)
                || matches!(before, 33 | 41 | 93))
                && self.is_part_of_optional_chain(c.h_preceding))
        {
            return false;
        }
        // It has a line break in it and code behind it on its last line: what still fits there is counted in two ways.
        if inside != k::JSXEmptyExpression
            && form == MID_BLOCK
            && self.has_newline_in_range(c.h_start, c.h_end)
        {
            return false;
        }
        // A line comment waits for the end of the line that is printed. Prettier leaves two blanks before it where a blank was printed
        // already: before a `=`, and behind a `=` or the `:` of a type before a template or parentheses that go, which stay on the line.
        if !c.h_is_block
            && (behind == 61
                || (form == END_LINE
                    && ((before == 61 && (behind == 96 || behind == 40))
                        || (before == 58 && behind == 96 && inside != k::ConditionalExpression))))
        {
            return false;
        }
        // The first line break that is printed may be the one in a block comment, which then has the comments that wait in it:
        // comments in what it follows on its line, or a line comment before it, where the items do not have lines of their own.
        if c.h_is_block
            && i > self.lexer.c_base
            && self.has_newline_in_range(c.h_start, c.h_end)
            && match form {
                END_BLOCK => {
                    self.lexer.c.at((i - 1) * C_STRIDE + C_START) >= self.n.at(c.h_preceding + 1)
                }
                OWN_BLOCK => {
                    (self.lexer.c.at((i - 1) * C_STRIDE + C_FLAGS) & CF_BLOCK) == 0
                        && !matches!(
                            inside,
                            k::Program
                                | k::BlockStatement
                                | k::ModuleBlock
                                | k::ClassBody
                                | k::SwitchCase
                                | k::SwitchStatement
                                | k::TypeLiteral
                                | k::InterfaceBody
                                | k::EnumBody
                                | k::ObjectExpression
                                | k::ArrayExpression
                        )
                        && {
                            let mut p = self.lexer.c.at((i - 1) * C_STRIDE + C_END);
                            p = self.white(p);
                            p == c.h_start
                        }
                }
                _ => false,
            }
        {
            return false;
        }
        // behind a line comment and the `)` of parentheses that go
        if c.h_is_block
            && before == 41
            && i > self.lexer.c_base
            && (self.lexer.c.at((i - 1) * C_STRIDE + C_FLAGS) & CF_BLOCK) == 0
            && {
                let mut p = self.lexer.c.at((i - 1) * C_STRIDE + C_END);
                let mut closes = false;
                while is_white(self.t.at(p)) || self.t.at(p) == 41 {
                    closes |= self.t.at(p) == 41;
                    p += 1;
                }
                closes && p == c.h_start
            }
        {
            return false;
        }
        // what may be a type cast of JSDoc, where it is printed with parentheses of its own
        if c.h_is_block
            && behind == 40
            && self.t.at(c.h_start + 2) == 42
            && (((self.parse.typed == TYPED_FLOW || inside == k::ConditionalExpression)
                && (form == MID_BLOCK || self.is_type_cast_comment_at(i)))
                // (at the start of a statement Prettier writes a `;` before it)
                || (form == MID_BLOCK && !self.options.semi)
                // (an object at the start of a statement has parentheses of its own on the long way)
                || c.gap_in_parentheses == 123)
        {
            return false;
        }
        // (the name that stands for a `${}` of a template of HTML: the long way doubles the parentheses of a cast around it)
        if c.h_is_block && behind == 40 && c.gap_in_parentheses == 80 {
            let name = self.next_significant_index(self.next_significant_index(c.h_end) + 1);
            if self.is_html_placeholder_name(name, self.name_end(name)) {
                return false;
            }
        }
        match inside {
            // nothing but comments in the file
            k::Program => c.h_preceding != 0 || c.h_following != 0,
            k::BlockStatement | k::ModuleBlock | k::SwitchCase | k::ClassBody => true,
            // in the parentheses or behind them
            k::SwitchStatement => before != 40 && before != 41 && behind != 41,
            // before the separator of the item that it follows
            _ if behind == 59 => inside == k::InterfaceBody && form == MID_BLOCK,
            k::ConditionalExpression | k::ConditionalType => true,
            // before the `:` of a type
            _ if behind == 58 => false,
            // before the `%checks` of Flow
            _ if behind == 37 && self.parse.typed == TYPED_FLOW => false,
            // behind the last item of a pattern that has a type, all there is between brackets, or where an element is left out
            k::ObjectPattern | k::ArrayPattern => {
                c.h_following_kind != k::TypeAnnotation
                    && !(before == 91 && behind == 93)
                    && !(behind == 44 && (before == 44 || before == 91))
            }
            // one of several
            k::JSXClosingFragment | k::JSXClosingElement => i == c.gap_last,
            // between two words: behind `in`, `out` or `const`, before `extends`
            k::TypeParameter => !(is_part_of_word(before) && is_part_of_word(behind)),
            // in braces with nothing else in them, which may be hugged; on the line of a member that has no separator
            k::TypeLiteral | k::InterfaceBody => {
                (inside == k::InterfaceBody || c.h_preceding != 0 || c.h_following != 0)
                    && !(form == END_BLOCK && is_part_of_word(before))
            }
            // between the key and the parameters, on the line of their `(`, or all there is between `(` and `)`
            // (in a method with a private name: a node of another type in Babel's tree, which fewer rules are for)
            k::ObjectMethod | k::ClassMethod => {
                !((is_part_of_word(before) || before == 63 || before == 93)
                    && behind != 44
                    && behind != 41)
                    && behind != 93
                    && !(before == 40 && (c.h_placement == CF_END_OF_LINE || behind == 41))
                    && !(behind == 123 && form != MID_BLOCK && before != 40 && before != 44)
                    // (in parentheses around the key)
                    && !(behind == 41 && c.h_preceding == self.n.at(c.h_enclosing + 4))
                    && (self.mode.is_type_script
                        || (self.n.at(self.n.at(c.h_enclosing + 4)) & 0xff) != k::PrivateName)
            }
            // behind a modifier, the key or the value; behind a word of an import or an export
            // (behind the value of a field with a private name: a node of another type in Babel's tree, which fewer rules are for)
            k::ClassProperty | k::PropertySignature => {
                !is_part_of_word(before)
                    && (self.mode.is_type_script
                        || c.h_following != 0
                        || (self.n.at(self.n.at(c.h_enclosing + 4)) & 0xff) != k::PrivateName)
            }
            // where an element is left out
            k::ArrayExpression => !(behind == 44 && (before == 44 || before == 91)),
            // .. or behind the braces, or all there is in them
            k::ImportDeclaration | k::ExportNamedDeclaration | k::ExportAllDeclaration => {
                !is_part_of_word(before) && before != 125 && !(before == 123 && behind == 125)
            }
            k::QualifiedName => false,
            // between two words of the head
            k::ClassDeclaration
            | k::ClassExpression
            | k::InterfaceDeclaration
            | k::EnumDeclaration
            | k::ModuleDeclaration
            | k::TSDeclareFunction
            | k::MethodSignature
            | k::VariableDeclaration => !(is_part_of_word(before) && is_part_of_word(behind)),
            // before the `=`; on its line, before a function whose first parameter is `this`, behind which the long way prints it
            k::VariableDeclarator => {
                !is_part_of_word(before)
                    && !(form == END_LINE && {
                        let mut function = c.h_following;
                        while matches!(
                            self.n.at(function) & 0xff,
                            k::UnaryExpression
                                | k::AsExpression
                                | k::SatisfiesExpression
                                | k::NonNullExpression
                                | k::MemberExpression
                                | k::CallExpression
                                | k::BinaryExpression
                                | k::LogicalExpression
                                | k::ConditionalExpression
                        ) {
                            function = self.n.at(function + 4);
                        }
                        let first = self.n.at(self.n.at(function + 6) + 1);
                        (self.n.at(function) & 0xff) == k::FunctionExpression
                            && self.text_is(self.n.at(first + 1), self.n.at(first + 1) + 4, b"this")
                    })
            }
            // behind the `(`
            k::TypeCastExpression => before != 40,
            // on lines of its own before the `>`
            k::TypeParameterInstantiation => !(form == OWN_BLOCK && behind == 62),
            // before the `)` of a type in parentheses
            k::TypeAnnotation => behind != 41,
            // a block comment that goes into a block, before whose first statement a `;` may be written
            k::TryStatement | k::CatchClause if c.h_is_block && !self.options.semi => false,
            // on both sides of the operator
            k::AssignmentExpression => {
                !(before == 61
                    && i > self.lexer.c_base
                    && self.lexer.c.at((i - 1) * C_STRIDE + C_START)
                        >= self.n.at(c.h_enclosing + 1)
                    && self.lexer.c.at((i - 1) * C_STRIDE + C_END) <= self.n.at(c.h_following + 1)
                    && {
                        let mut p = self.lexer.c.at((i - 1) * C_STRIDE + C_END);
                        p = self.white(p);
                        p != c.h_start
                    })
            }
            // before a body, which may start with a directive
            k::ArrowFunctionExpression => behind != 123,
            // (a DeclareTypeAlias is no TypeAlias)
            k::TypeAlias => {
                !is_part_of_word(before)
                    && behind != 61
                    && (((self.n.at(c.h_enclosing) as u32) >> SUB_SHIFT) as i32 & MOD_DECLARE) == 0
            }
            // (not in a decorator or before `as`)
            k::MemberExpression => {
                (match before == 46 {
                    true => form == MID_BLOCK,
                    false => c.h_preceding_kind == k::CallExpression,
                }) && !matches!(
                    self.n.at(self.n.at(c.h_enclosing + 3)) & 0xff,
                    k::Decorator | k::AsExpression | k::SatisfiesExpression
                )
            }
            // before the parentheses of a function, or parentheses that go; on the line of a bracket of the key, in the brackets
            k::ObjectProperty => {
                behind != 40 && !(form == END_LINE && (before == 91 || behind == 93))
            }
            // before an object or an array that would stand on the line of the operator
            k::LogicalExpression => {
                !matches!(c.h_following_kind, k::ObjectExpression | k::ArrayExpression)
            }
            // next to the `...` of a rest parameter
            k::FunctionType => behind != 46 && before != 46,
            // before the `?`
            k::FunctionTypeParam => behind != 63,
            // in a getter or a setter
            k::ObjectTypeProperty => {
                ((self.n.at(c.h_enclosing) as u32) >> SUB_SHIFT) as i32 & M_MASK == M_METHOD
            }
            // between the name and the type arguments
            k::TypeReference | k::Heritage => behind != 60,
            // next to the `in` or the `of`
            k::ForInStatement | k::ForOfStatement => {
                !(form == END_LINE && (is_part_of_word(before) || behind == 105 || behind == 111))
            }
            // between the brackets, or in the parentheses of the type of the elements
            k::ArrayType => before != 91 && behind != 41,
            // in the parentheses of an element
            k::TupleType => behind != 41 && before != 40,
            // before the type arguments; before the arguments on the left of a `=`, where a line break decides about the right side
            k::CallExpression | k::NewExpression => {
                before == 40
                    || before == 44
                    || (behind != 60 && !(behind == 40 && self.starts_target(c.h_enclosing)))
            }
            // (it waits for the end of a line on which more may follow than is good for it)
            k::AsExpression | k::SatisfiesExpression => form != END_LINE,
            // next to the `=`
            k::JSXAttribute => before != 61 && behind != 61,
            // between `/` and `>`
            k::JSXOpeningElement => before != 47,
            // between the name and the parameters
            // nor, but for a block comment on the line, before a body, which may start with a directive
            k::FunctionDeclaration | k::FunctionExpression => {
                !(is_part_of_word(before) && (behind == 40 || is_part_of_word(behind)))
                    && !(behind == 123 && form != MID_BLOCK && before != 40 && before != 44)
            }
            // in the key of an indexer, in an index, in the last type of a tuple
            k::UnionType => {
                let union = c.h_enclosing;
                !self.is_asked_first(union, 2) || {
                    let mut end = self.n.at(union + 2);
                    end = self.white(end);
                    self.t.at(end) != 93
                }
            }
            _ => true,
        }
    }
}

pub(crate) const CF_LEADING: i32 = 4;
pub(crate) const CF_TRAILING: i32 = 8;
pub(crate) const CF_PRINTED: i32 = 16;
pub(crate) const CF_OWN_LINE: i32 = 32;
pub(crate) const CF_END_OF_LINE: i32 = 64;
/// the marker "commentBeforeArrow"
pub(crate) const CF_BEFORE_ARROW: i32 = 128;
/// the markers "implements", "extends" and "mixins"
pub(crate) const CF_MARK_IMPLEMENTS: i32 = 1024;
pub(crate) const CF_MARK_EXTENDS: i32 = 2048;
pub(crate) const CF_MARK_MIXINS: i32 = 4096;
pub(crate) const CF_MARKERS: i32 =
    CF_BEFORE_ARROW | CF_MARK_IMPLEMENTS | CF_MARK_EXTENDS | CF_MARK_MIXINS;
/// print_comment() has written it, at least once: see check_that_comments_are_written()
pub(crate) const CF_WRITTEN: i32 = 32768;
/// two comments that merge_nestled_jsdoc_comments() made one
pub(crate) const CF_NESTLED: i32 = 65536;
impl Quick {
    pub(crate) fn reset_comments(&mut self) {
        self.comments.trailing_count = 0;
        self.comments.map_mask = 63;
        self.comments.map.fill_range(0, 0, 64 * 3);
        self.comments.map_room = 16;
    }

    /// A comment is given to a node, and the printer of that node, or of the node around it, has to ask for it. Where none does, the comment would be gone, and nobody
    /// would know. So each one is written, or is part of what is printed as it stands (CF_PRINTED), or has a node of its own in a list (CF_CLAIMED).
    pub(crate) fn check_that_comments_are_written(&self) -> R<()> {
        let mut c = self.lexer.c_base;
        while c < self.lexer.c_count {
            if (self.lexer.c.at(c * C_STRIDE + C_FLAGS) & (CF_WRITTEN | CF_PRINTED | CF_CLAIMED))
                == 0
            {
                return Err(self.rare(rare::COMMENT));
            }
            c += 1;
        }
        Ok(())
    }

    pub(crate) fn make_room_in_map(&mut self, count: i32) -> R<()> {
        if count <= self.comments.map_room {
            self.comments.map_room -= count;
            return Ok(());
        }
        let old = self
            .comments
            .map
            .sub(0, (self.comments.map_mask + 1) * 3)
            .to_vec();
        let used = ((self.comments.map_mask + 1) >> 2) - self.comments.map_room;
        if used + count > LARGEST / 16 {
            return Err(self.stop(why::TOO_LARGE));
        }
        let mut size = self.comments.map_mask + 1;
        while (size >> 2) < used + count {
            size *= 2;
        }
        if size * 3 > (self.comments.map.len() as i32) {
            self.comments.map = zeros::<i32>(size * 3);
        } else {
            self.comments.map.fill_range(0, 0, size * 3);
        }
        self.comments.map_mask = size - 1;
        self.comments.map_room = (size >> 2) - used - count;
        let mut i: i32 = 0;
        while i < (old.len() as i32) {
            'c2: {
                if old.at(i) == 0 {
                    break 'c2;
                }
                let slot = self.map_slot(old.at(i));
                self.comments.map.put(slot, old.at(i));
                self.comments.map.put(slot + 1, old.at(i + 1));
                self.comments.map.put(slot + 2, old.at(i + 2));
            }
            i += 3;
        }
        Ok(())
    }

    pub(crate) fn map_slot(&self, node: i32) -> i32 {
        let mut i = ((node.wrapping_mul(-1640531535) as u32) >> 8) as i32 & self.comments.map_mask;
        loop {
            let key = self.comments.map.at(i * 3);
            if key == node || key == 0 {
                return i * 3;
            }
            i = (i + 1) & self.comments.map_mask;
        }
    }

    /// The first comment of a node, or -1. Follow C_NEXT from there.
    pub(crate) fn first_comment(&self, node: i32) -> i32 {
        if (self.n.at(node) & (F_LEADING | F_TRAILING | F_DANGLING)) == 0 {
            return -1;
        }
        return self.comments.map.at(self.map_slot(node) + 1);
    }

    pub(crate) fn next_comment(&self, comment: i32) -> i32 {
        return self.lexer.c.at(comment * C_STRIDE + C_NEXT);
    }

    pub(crate) fn add(&mut self, node: i32, comment: i32, kind: i32, node_flag: i32) {
        let at = comment * C_STRIDE;
        self.lexer.c.put(
            at + C_FLAGS,
            (self.lexer.c.at(at + C_FLAGS) & !(CF_LEADING | CF_TRAILING | CF_PRINTED)) | kind,
        );
        self.lexer.c.put(at + C_NODE, node);
        self.lexer.c.put(at + C_NEXT, -1);
        self.n.put(node, self.n.at(node) | node_flag);
        let slot = self.map_slot(node);
        if self.comments.map.at(slot) == 0 {
            self.comments.map.put(slot, node);
            self.comments.map.put(slot + 1, comment);
        } else {
            self.lexer
                .c
                .put(self.comments.map.at(slot + 2) * C_STRIDE + C_NEXT, comment);
        }
        self.comments.map.put(slot + 2, comment);
    }

    pub(crate) fn add_leading(&mut self, node: i32, comment: i32) {
        self.add(node, comment, CF_LEADING, F_LEADING);
    }

    pub(crate) fn add_trailing(&mut self, node: i32, comment: i32) {
        self.comments.trailing_count += 1;
        self.add(node, comment, CF_TRAILING, F_TRAILING);
    }

    pub(crate) fn add_dangling(&mut self, node: i32, comment: i32) {
        self.add(node, comment, 0, F_DANGLING);
    }

    /// Puts the comments of a node in source order.
    pub(crate) fn sort_comments(&mut self, node: i32) {
        let slot = self.map_slot(node);
        if self.comments.map.at(slot) == 0
            || self.comments.map.at(slot + 1) == self.comments.map.at(slot + 2)
        {
            return;
        }
        // Comment indices are in source order, so sort the indices. The list is a few runs that are in order, most often one: each turn
        // merges every run with the one behind it.
        let mut first = self.comments.map.at(slot + 1);
        loop {
            let mut rest = first;
            let mut last: i32 = -1;
            let mut runs = 0;
            while rest >= 0 {
                let mut a = rest;
                let a_end = self.end_of_run(a);
                let mut b = self.next_comment(a_end);
                rest = -1;
                if b >= 0 {
                    let b_end = self.end_of_run(b);
                    rest = self.next_comment(b_end);
                    self.lexer.c.put(a_end * C_STRIDE + C_NEXT, -1);
                    self.lexer.c.put(b_end * C_STRIDE + C_NEXT, -1);
                }
                while b >= 0 {
                    if a > b {
                        (a, b) = (b, a);
                    }
                    // `a` goes on for as long as it is before `b`
                    if last < 0 {
                        first = a;
                    } else {
                        self.lexer.c.put(last * C_STRIDE + C_NEXT, a);
                    }
                    loop {
                        last = a;
                        a = self.next_comment(a);
                        if a < 0 || a > b {
                            break;
                        }
                    }
                    if a < 0 {
                        (a, b) = (b, -1);
                    }
                }
                // what is left of the one that is longer
                if last < 0 {
                    first = a;
                } else {
                    self.lexer.c.put(last * C_STRIDE + C_NEXT, a);
                }
                last = self.end_of_run(a);
                runs += 1;
            }
            if runs <= 1 {
                self.comments.map.put(slot + 1, first);
                self.comments.map.put(slot + 2, last);
                return;
            }
        }
    }

    /// The last comment of the list that starts with `comment` before one that is out of order.
    fn end_of_run(&self, mut comment: i32) -> i32 {
        loop {
            let next = self.next_comment(comment);
            if next < comment {
                return comment;
            }
            comment = next;
        }
    }

    pub(crate) fn is_meaningful_empty_statement(&self, node: i32) -> bool {
        let parent = self.n.at(node + 3);
        match self.n.at(parent) & 0xff {
            k::IfStatement => {
                return self.n.at(parent + 5) == node || self.n.at(parent + 6) == node;
            }
            k::DoWhileStatement => {
                return self.n.at(parent + 4) == node;
            }
            k::ForInStatement | k::ForOfStatement => {
                return self.n.at(parent + 6) == node;
            }
            k::ForStatement => {
                return self.n.at(parent + 7) == node;
            }
            k::LabeledStatement | k::WithStatement | k::WhileStatement => {
                return self.n.at(parent + 5) == node;
            }
            _ => {}
        }
        return false;
    }

    pub(crate) fn can_attach(&self, node: i32, parent: i32) -> bool {
        match self.n.at(node) & 0xff {
            k::TemplateElement => {
                return false;
            }
            k::EmptyStatement => {
                return self.is_meaningful_empty_statement(node);
            }
            k::Identifier | k::StringLiteral => {
                match self.n.at(parent) & 0xff {
                    k::ObjectProperty => {
                        return !((self.n.at(parent) & F_SHORTHAND) != 0
                            && self.n.at(parent + 4) == node);
                    }
                    k::ImportSpecifier | k::ExportSpecifier => {
                        // the second name of a specifier without `as` is a copy of the first
                        return !(self.n.at(parent + 5) == node
                            && self.n.at(self.n.at(parent + 4) + 1) == self.n.at(node + 1));
                    }
                    k::ComponentParameter | k::MatchObjectPatternProperty => {
                        return !((self.n.at(parent) & F_SHORTHAND) != 0
                            && self.n.at(parent + 4) == node);
                    }
                    k::TypeParameter | k::LiteralType => {
                        // no nodes in the tree of Flow
                        return !self.mode.is_flow;
                    }
                    _ => {}
                }
            }
            k::NumericLiteral | k::BigIntLiteral | k::BooleanLiteral => {
                return !(self.mode.is_flow && (self.n.at(parent) & 0xff) == k::LiteralType);
            }
            k::TypeReference => {
                // `as const`
                return !((self.n.at(parent) & 0xff) == k::AsExpression
                    && self.mode.is_type_script
                    && self.t.at(self.n.at(node + 1)) == 99
                    && self.n.at(node + 2) - self.n.at(node + 1) == 5
                    && self.is_const_word(self.n.at(node + 1)));
            }
            _ => {}
        }
        return true;
    }

    pub(crate) fn is_const_word(&self, p: i32) -> bool {
        return self.t.at(p) == 99
            && self.t.at(p + 1) == 111
            && self.t.at(p + 2) == 110
            && self.t.at(p + 3) == 115
            && self.t.at(p + 4) == 116;
    }

    pub(crate) fn push_child(&mut self, child: i32) {
        if self.comments.ch_pos >= (self.comments.ch.len() as i32) {
            self.make_room(|q| &mut q.comments.ch, self.comments.ch_pos + 1);
        }
        self.comments.ch.put(self.comments.ch_pos, child);
        self.comments.ch_pos += 1;
    }

    pub(crate) fn push_level(&mut self, node: i32) {
        let first = self.comments.ch_pos;
        let s = SHAPE.at(self.n.at(node) & 0xff);
        let mut f = node + 4;
        let mut i = s & 15;
        while i > 0 {
            let c = self.n.at(f);
            f += 1;
            if c != 0 && self.can_attach(c, node) {
                self.push_child(c);
            }
            i -= 1;
        }
        if (self.n.at(node) & 0xff) == k::PropertySignature && self.n.at(node + 5) != 0 {
            // no comment goes to the `: type` of a property signature: the type itself stands in its place
            self.comments.ch_pos -= 1;
            self.push_child(self.n.at(self.n.at(node + 5) + 4));
        }
        let mut i = (s >> 4) & 15;
        while i > 0 {
            let l = self.n.at(f);
            f += 1;
            let count = self.n.at(l);
            let mut j: i32 = 1;
            while j <= count {
                let c = self.n.at(l + j);
                if c != 0 && self.can_attach(c, node) {
                    self.push_child(c);
                }
                j += 1;
            }
            i -= 1;
        }
        if s > 255 {
            let mut i = (s >> 8) & 15;
            while i > 0 {
                let c = self.n.at(f);
                f += 1;
                if c != 0 && self.can_attach(c, node) {
                    self.push_child(c);
                }
                i -= 1;
            }
            let mut i = s >> 12;
            while i > 0 {
                let l = self.n.at(f);
                f += 1;
                let count = self.n.at(l);
                let mut j: i32 = 1;
                while j <= count {
                    self.push_child(self.n.at(l + j));
                    j += 1;
                }
                i -= 1;
            }
        }
        if (self.n.at(node) & F_EXT) != 0 && EXT_AT.at(self.n.at(node) & 0xff) != 0 {
            // a type annotation, decorators
            let at = node + EXT_AT.at(self.n.at(node) & 0xff);
            if self.n.at(at) != 0 && self.can_attach(self.n.at(at), node) {
                self.push_child(self.n.at(at));
            }
            let l = self.n.at(at + 1);
            let mut j: i32 = 1;
            while j <= self.n.at(l) {
                self.push_child(self.n.at(l + j));
                j += 1;
            }
        }
        // By start, then by end. They are nearly sorted already: few have to go, and not far. (Where one long list stands before another one in the text
        // and behind it in the node, all of the one would go past all of the other.)
        let mut steps_left = (self.comments.ch_pos - first) * 4 + 64;
        let mut i = first + 1;
        while i < self.comments.ch_pos {
            let c = self.comments.ch.at(i);
            let cs = self.n.at(c + 1);
            let ce = self.n.at(c + 2);
            let mut j = i - 1;
            while j >= first {
                let o = self.comments.ch.at(j);
                if self.n.at(o + 1) < cs || (self.n.at(o + 1) == cs && self.n.at(o + 2) <= ce) {
                    break;
                }
                self.comments.ch.put(j + 1, o);
                j -= 1;
            }
            self.comments.ch.put(j + 1, c);
            steps_left -= i - 1 - j;
            if steps_left < 0 {
                self.merge_children(first);
                break;
            }
            i += 1;
        }
        if self.comments.path_pos + 3 > (self.comments.path.len() as i32) {
            self.make_room(|q| &mut q.comments.path, self.comments.path_pos + 3);
        }
        self.comments.path.put(self.comments.path_pos, node);
        self.comments.path.put(self.comments.path_pos + 1, first);
        self.comments
            .path
            .put(self.comments.path_pos + 2, self.comments.ch_pos);
        self.comments.path_pos += 3;
    }

    /// Sorts the children from `first` on as push_level() does, by merging.
    #[cold]
    fn merge_children(&mut self, first: i32) {
        let mut from = self.comments.ch.sub(first, self.comments.ch_pos).to_vec();
        let count = from.len() as i32;
        let mut to = zeros::<i32>(count);
        let mut width = 1;
        while width < count {
            let mut low = 0;
            while low < count {
                let middle = count.min(low + width);
                let high = count.min(middle + width);
                let (mut a, mut b) = (low, middle);
                for o in low..high {
                    let takes_right = a == middle
                        || (b < high && {
                            let (left, right) = (from.at(a), from.at(b));
                            (self.n.at(right + 1), self.n.at(right + 2))
                                < (self.n.at(left + 1), self.n.at(left + 2))
                        });
                    to.put(o, from.at(if takes_right { b } else { a }));
                    a += i32::from(!takes_right);
                    b += i32::from(takes_right);
                }
                low = high;
            }
            std::mem::swap(&mut from, &mut to);
            width *= 2;
        }
        self.comments.ch.set_all(&from, first);
    }

    pub(crate) fn expression_index(&self, quasis: i32, start: i32) -> i32 {
        let p = start - 1;
        let count = self.n.at(quasis);
        // the first text but the first that starts behind p
        let mut low: i32 = 1;
        let mut high = count;
        while low < high {
            let middle = (low + high) >> 1;
            if p < self.n.at(self.n.at(quasis + 1 + middle) + 1) {
                high = middle;
            } else {
                low = middle + 1;
            }
        }
        return if low < count { low - 1 } else { 0 };
    }

    pub(crate) fn decorate(&mut self, comment: i32) -> R<()> {
        let at = comment * C_STRIDE;
        let cs = self.lexer.c.at(at + C_START);
        let ce = self.lexer.c.at(at + C_END);
        // leave the nodes that end before this comment
        while self.comments.path_pos > 3 {
            let node = self.comments.path.at(self.comments.path_pos - 3);
            if self.n.at(node + 1) <= cs && ce <= self.n.at(node + 2) {
                break;
            }
            self.comments.path_pos -= 3;
            self.comments.ch_pos = self.comments.path.at(self.comments.path_pos + 1);
        }
        loop {
            let enclosing = self.comments.path.at(self.comments.path_pos - 3);
            let mut left = self.comments.path.at(self.comments.path_pos - 2);
            let mut right = self.comments.path.at(self.comments.path_pos - 1);
            let mut preceding: i32 = 0;
            let mut following: i32 = 0;
            let mut inside: i32 = 0;
            while left < right {
                let middle = (left + right) >> 1;
                let child = self.comments.ch.at(middle);
                let start = self.n.at(child + 1);
                let end = self.n.at(child + 2);
                if start <= cs && ce <= end {
                    inside = child;
                    break;
                }
                if end <= cs {
                    preceding = child;
                    left = middle + 1;
                    continue;
                }
                if ce <= start {
                    following = child;
                    right = middle;
                    continue;
                }
                return Err(self.stop(why::BUG));
            }
            if inside != 0 {
                self.push_level(inside);
                continue;
            }
            if (self.n.at(enclosing) & 0xff) == k::TemplateLiteral {
                let quasis = self.n.at(enclosing + 4);
                let index = self.expression_index(quasis, cs);
                if preceding != 0
                    && self.expression_index(quasis, self.n.at(preceding + 1)) != index
                {
                    preceding = 0;
                }
                if following != 0
                    && self.expression_index(quasis, self.n.at(following + 1)) != index
                {
                    following = 0;
                }
            }
            self.lexer.c.put(at + C_ENCLOSING, enclosing);
            self.lexer.c.put(at + C_PRECEDING, preceding);
            self.lexer.c.put(at + C_FOLLOWING, following);
            return Ok(());
        }
    }

    // ---- placement
    pub(crate) fn only_spaces_between(&self, start: i32, end: i32) -> bool {
        let mut p = start;
        while p < end {
            let c = self.t.at(p);
            if !is_space(c) || c == 10 {
                return false;
            }
            p += 1;
        }
        return true;
    }

    pub(crate) fn is_own_line(&mut self, comment: i32) -> bool {
        let at = comment * C_STRIDE;
        let mut start = self.lexer.c.at(at + C_START);
        let preceding = self.lexer.c.at(at + C_PRECEDING);
        if preceding != 0 {
            let mut i = comment - 1;
            while i >= self.lexer.c_base {
                let o = i * C_STRIDE;
                if self.lexer.c.at(o + C_PRECEDING) != preceding
                    || !self.only_spaces_between(self.lexer.c.at(o + C_END), start)
                {
                    break;
                }
                if i == self.comments.own_line_of {
                    // from here on this is the way that was gone for that one
                    self.comments.own_line_of = comment;
                    return self.comments.is_own_line;
                }
                start = self.lexer.c.at(o + C_START);
                i -= 1;
            }
        }
        self.comments.own_line_of = comment;
        self.comments.is_own_line = self.has_newline_before(start);
        return self.comments.is_own_line;
    }

    pub(crate) fn is_end_of_line(&mut self, comment: i32) -> bool {
        // (each of them has the same node behind it and nothing but blanks between it and the next one)
        if self.comments.end_of_line_from <= comment && comment <= self.comments.end_of_line_to {
            return self.comments.is_end_of_line;
        }
        let at = comment * C_STRIDE;
        let mut end = self.lexer.c.at(at + C_END);
        let following = self.lexer.c.at(at + C_FOLLOWING);
        let mut i = comment + 1;
        if following != 0 {
            while i < self.lexer.c_count {
                let o = i * C_STRIDE;
                if self.lexer.c.at(o + C_FOLLOWING) != following
                    || !self.only_spaces_between(end, self.lexer.c.at(o + C_START))
                {
                    break;
                }
                end = self.lexer.c.at(o + C_END);
                i += 1;
            }
        }
        self.comments.end_of_line_from = comment;
        self.comments.end_of_line_to = i - 1;
        self.comments.is_end_of_line = self.has_newline(end);
        return self.comments.is_end_of_line;
    }

    pub(crate) fn break_ties(&mut self) {
        if self.comments.tie_count == 0 {
            return;
        }
        let first = self.comments.ties.at(0) * C_STRIDE;
        let preceding = self.lexer.c.at(first + C_PRECEDING);
        let following = self.lexer.c.at(first + C_FOLLOWING);
        let mut gap_end = self.n.at(following + 1);
        let mut first_leading = self.comments.tie_count;
        while first_leading > 0 {
            let at = self.comments.ties.at(first_leading - 1) * C_STRIDE;
            let mut is_gap = true;
            let mut p = self.lexer.c.at(at + C_END);
            while p < gap_end {
                let b = self.t.at(p);
                if !is_space(b) && b != 40 {
                    is_gap = false;
                    break;
                }
                p += 1;
            }
            if !is_gap {
                break;
            }
            gap_end = self.lexer.c.at(at + C_START);
            first_leading -= 1;
        }
        let mut i: i32 = 0;
        while i < self.comments.tie_count {
            if i < first_leading {
                self.add_trailing(preceding, self.comments.ties.at(i));
            } else {
                self.add_leading(following, self.comments.ties.at(i));
            }
            i += 1;
        }
        self.sort_comments(preceding);
        self.sort_comments(following);
        self.comments.tie_count = 0;
    }

    pub(crate) fn is_single_line_comment(&self) -> bool {
        return !self.comments.h_is_block
            || !self.has_newline_in_range(self.comments.h_start, self.comments.h_end);
    }

    pub(crate) fn add_block_statement_first_comment(&mut self, block: i32, comment: i32) {
        let kind = self.n.at(block) & 0xff;
        // BlockStatement: directives, body. ClassBody, StaticBlock: body.
        let body = if kind == k::BlockStatement || kind == k::Program {
            self.n.at(block + 5)
        } else {
            self.n.at(block + 4)
        };
        let count = self.n.at(body);
        let mut i: i32 = 1;
        while i <= count {
            let statement = self.n.at(body + i);
            if (self.n.at(statement) & 0xff) != k::EmptyStatement {
                self.add_leading(statement, comment);
                return;
            }
            i += 1;
        }
        self.add_dangling(block, comment);
    }

    pub(crate) fn add_block_or_not_comment(&mut self, node: i32, comment: i32) {
        if (self.n.at(node) & 0xff) == k::BlockStatement {
            self.add_block_statement_first_comment(node, comment);
        } else {
            self.add_leading(node, comment);
        }
    }

    pub(crate) fn is_real_function_like(&self, kind: i32) -> bool {
        match kind {
            k::ArrowFunctionExpression
            | k::FunctionExpression
            | k::FunctionDeclaration
            | k::ObjectMethod
            | k::ClassMethod
            | k::TSDeclareFunction
            | k::CallSignature
            | k::ConstructSignature
            | k::MethodSignature
            | k::ConstructorType
            | k::HookDeclaration => {
                return true;
            }
            k::FunctionType => {
                return self.mode.is_type_script;
            }
            _ => {}
        }
        return false;
    }

    pub(crate) fn handle_union_type_comments(&mut self) -> bool {
        if (self.comments.h_enclosing_kind == k::UnionType
            || self.comments.h_enclosing_kind == k::MatchOrPattern)
            && self.comments.h_preceding != 0
        {
            self.add_trailing(self.comments.h_preceding, self.comments.h_comment);
            return true;
        }
        return false;
    }

    /// A block comment on one line right before a union type goes to the first type of the union.
    pub(crate) fn should_attach_to_union_type_first_element(&mut self, node: i32) -> bool {
        if (self.n.at(node) & 0xff) != k::UnionType
            || !self.comments.h_is_block
            || self.has_newline_in_range(self.comments.h_start, self.comments.h_end)
            || self.is_prettier_ignore_comment(self.comments.h_comment)
        {
            return false;
        }
        let end = self.n.at(node + 1);
        let mut p = self.comments.h_end;
        // Whoever starts between two comments that were passed last time gets as far as that.
        let [known_node, known_from, known_to] = self.comments.union_line;
        if known_node == node && known_from <= p && p <= known_to {
            return self.comments.union_line_is_clear;
        }
        let from = p;
        let mut is_clear = true;
        while p < end {
            let c = self.t.at(p);
            if is_blank(c) {
                p += 1;
                continue;
            }
            let comment = self.comment_at(p);
            // a comment counts as so many spaces, but a line break in it stays one
            if comment < 0
                || self.has_newline_in_range(p, self.lexer.c.at(comment * C_STRIDE + C_END))
            {
                is_clear = false;
                break;
            }
            p = self.lexer.c.at(comment * C_STRIDE + C_END);
        }
        self.comments.union_line = [node, from, p];
        self.comments.union_line_is_clear = is_clear;
        return is_clear;
    }

    pub(crate) fn add_leading_comment_to_possible_union_type(&mut self, node: i32) -> bool {
        let to = if self.should_attach_to_union_type_first_element(node) {
            self.n.at(self.n.at(node + 4) + 1)
        } else {
            node
        };
        self.add_leading(to, self.comments.h_comment);
        return true;
    }

    pub(crate) fn handle_union_type_leading_comments(&mut self) -> bool {
        if self.comments.h_following != 0
            && self.should_attach_to_union_type_first_element(self.comments.h_following)
        {
            self.add_leading(
                self.n.at(self.n.at(self.comments.h_following + 4) + 1),
                self.comments.h_comment,
            );
            return true;
        }
        return false;
    }

    pub(crate) fn handle_comments_in_destructuring_pattern(&mut self) -> bool {
        if (self.comments.h_enclosing_kind == k::ObjectPattern
            || self.comments.h_enclosing_kind == k::ArrayPattern)
            && self.comments.h_following_kind == k::TypeAnnotation
            && self.mode.is_type_script
        {
            if self.comments.h_preceding != 0 {
                self.add_trailing(self.comments.h_preceding, self.comments.h_comment);
            } else {
                self.add_dangling(self.comments.h_enclosing, self.comments.h_comment);
            }
            return true;
        }
        return false;
    }

    pub(crate) fn handle_ts_mapped_type_comments(&mut self) -> bool {
        if self.comments.h_enclosing_kind != k::MappedType {
            return false;
        }
        if self.comments.h_end
            < self.seek(
                SOUGHT_BRACKET,
                self.n.at(self.comments.h_enclosing + 1),
                |q, from| q.index_of_outside_comments(91, from),
            )
        {
            self.add_dangling(self.comments.h_enclosing, self.comments.h_comment);
            return true;
        }
        return false;
    }

    pub(crate) fn handle_binary_cast_expression_comment(&mut self) -> bool {
        if (self.comments.h_enclosing_kind == k::AsExpression
            || self.comments.h_enclosing_kind == k::SatisfiesExpression)
            && self.comments.h_preceding == self.n.at(self.comments.h_enclosing + 4)
            && !self.is_single_line_comment()
        {
            if self.comments.h_following != 0 {
                self.add_leading(self.comments.h_following, self.comments.h_comment);
            } else {
                self.add_trailing(self.comments.h_enclosing, self.comments.h_comment);
            }
            return true;
        }
        return false;
    }

    pub(crate) fn handle_last_union_element_in_expression(&mut self) -> bool {
        if self.comments.h_preceding_kind == k::UnionType
            && ((self.comments.h_enclosing_kind == k::ArrayType && self.comments.h_following == 0)
                || self.comments.h_enclosing_kind == k::IntersectionType
                || self.comments.h_enclosing_kind == k::UnionType)
        {
            let types = self.n.at(self.comments.h_preceding + 4);
            self.add_trailing(self.n.at(types + self.n.at(types)), self.comments.h_comment);
            return true;
        }
        return false;
    }

    pub(crate) fn handle_property_signature_comments(&mut self) -> bool {
        if (self.comments.h_enclosing_kind == k::PropertySignature
            || self.comments.h_enclosing_kind == k::ObjectTypeProperty)
            && (self.comments.h_following_kind == k::UnionType
                || self.comments.h_following_kind == k::IntersectionType)
        {
            self.add_leading(self.comments.h_following, self.comments.h_comment);
            return true;
        }
        return false;
    }

    pub(crate) fn is_abstract_method(&self, node: i32) -> bool {
        return (self.n.at(node) & 0xff) == k::ClassMethod
            && (((self.n.at(node) as u32) >> SUB_SHIFT) as i32 & MOD_ABSTRACT) != 0;
    }

    pub(crate) fn handle_ts_function_trailing_comments(&mut self) -> bool {
        if self.comments.h_following != 0 {
            return false;
        }
        if self.comments.h_enclosing_kind == k::MethodSignature
            || self.comments.h_enclosing_kind == k::TSDeclareFunction
        {
            if self.comments.h_preceding != 0
                && self.comments.h_preceding
                    == self.n.at(self.comments.h_enclosing + FN_RETURN_TYPE)
            {
                return false;
            }
        } else if !self.is_abstract_method(self.comments.h_enclosing) {
            return false;
        }
        if self.next_char_behind_comment() != 59 {
            return false;
        }
        self.add_trailing(self.comments.h_enclosing, self.comments.h_comment);
        return true;
    }
}
pub(crate) fn is_function_like(kind: i32) -> bool {
    return kind == k::FunctionDeclaration
        || kind == k::FunctionExpression
        || kind == k::ClassMethod
        || kind == k::ObjectMethod;
}

impl Quick {
    pub(crate) fn is_in_argument_or_parameter_parentheses(&mut self, node: i32) -> bool {
        if self.comments.h_start >= self.n.at(node + 2)
            || self.comments.h_end <= self.n.at(node + 1)
        {
            return false;
        }
        return self.characters_around_comment(self.comments.h_comment) == (40, 41);
    }

    pub(crate) fn handle_comment_in_empty_parens(&mut self) -> bool {
        let kind = self.comments.h_enclosing_kind;
        if kind == k::CallExpression || kind == k::NewExpression {
            if self.n.at(self.n.at(self.comments.h_enclosing + 5)) == 0
                && self.is_in_argument_or_parameter_parentheses(self.comments.h_enclosing)
            {
                self.add_dangling(self.comments.h_enclosing, self.comments.h_comment);
                return true;
            }
        }
        if (self.is_real_function_like(kind)
            || kind == k::ComponentDeclaration
            || kind == k::DeclareComponent
            || kind == k::ComponentTypeAnnotation
            || kind == k::HookTypeAnnotation)
            && self.n.at(self.n.at(self.comments.h_enclosing + 6)) == 0
            && self.is_in_argument_or_parameter_parentheses(self.comments.h_enclosing)
        {
            self.add_dangling(self.comments.h_enclosing, self.comments.h_comment);
            return true;
        }
        return false;
    }

    pub(crate) fn handle_conditional_expression_comments(&mut self) -> bool {
        let same_line = self.comments.h_preceding != 0
            && !self.has_newline_before_comment_from(self.n.at(self.comments.h_preceding + 2), 0);
        if (self.comments.h_preceding == 0 || !same_line)
            && (self.comments.h_enclosing_kind == k::ConditionalExpression
                || self.comments.h_enclosing_kind == k::ConditionalType)
            && self.comments.h_following != 0
        {
            self.add_leading(self.comments.h_following, self.comments.h_comment);
            return true;
        }
        return false;
    }

    pub(crate) fn handle_last_function_parameter_comments(&mut self) -> bool {
        let pk = self.comments.h_preceding_kind;
        if pk == k::FunctionTypeParam
            && self.comments.h_enclosing_kind == k::FunctionType
            && self.comments.h_following_kind != k::FunctionTypeParam
        {
            self.add_trailing(self.comments.h_preceding, self.comments.h_comment);
            return true;
        }
        if pk == k::ComponentTypeParameter
            && (self.comments.h_enclosing_kind == k::DeclareComponent
                || self.comments.h_enclosing_kind == k::ComponentTypeAnnotation)
            && self.comments.h_following_kind != k::ComponentTypeParameter
        {
            self.add_trailing(self.comments.h_preceding, self.comments.h_comment);
            return true;
        }
        if (pk == k::ComponentParameter || pk == k::RestElement)
            && (self.comments.h_enclosing_kind == k::ComponentDeclaration
                || self.comments.h_enclosing_kind == k::DeclareComponent)
            && self.next_char_behind_comment() == 41
        {
            self.add_trailing(self.comments.h_preceding, self.comments.h_comment);
            return true;
        }
        if (pk == k::Identifier
            || pk == k::AssignmentPattern
            || pk == k::ObjectPattern
            || pk == k::ArrayPattern
            || pk == k::RestElement
            || pk == k::ParameterProperty)
            && self.is_real_function_like(self.comments.h_enclosing_kind)
            && self.next_char_behind_comment() == 41
        {
            self.add_trailing(self.comments.h_preceding, self.comments.h_comment);
            return true;
        }
        if !self.comments.h_is_block
            && self.comments.h_following_kind == k::BlockStatement
            && is_function_like(self.comments.h_enclosing_kind)
            && self.n.at(self.comments.h_enclosing + 5) == self.comments.h_following
        {
            if self.next_index_behind_comment() == self.n.at(self.comments.h_following + 1) {
                self.add_block_statement_first_comment(
                    self.comments.h_following,
                    self.comments.h_comment,
                );
                return true;
            }
        }
        return false;
    }

    pub(crate) fn handle_member_expression_comments(&mut self) -> bool {
        if self.comments.h_enclosing_kind == k::MemberExpression
            && self.comments.h_following_kind == k::Identifier
        {
            self.add_leading(self.comments.h_enclosing, self.comments.h_comment);
            return true;
        }
        return false;
    }

    pub(crate) fn handle_if_statement_comments(&mut self) -> bool {
        if self.comments.h_enclosing_kind != k::IfStatement || self.comments.h_following == 0 {
            return false;
        }
        if self.next_char_behind_comment() == 41 {
            self.add_trailing(self.comments.h_preceding, self.comments.h_comment);
            return true;
        }
        let consequent = self.n.at(self.comments.h_enclosing + 5);
        if self.comments.h_following == consequent {
            self.add_leading(self.comments.h_following, self.comments.h_comment);
            return true;
        }
        if self.comments.h_preceding == consequent
            && self.comments.h_following == self.n.at(self.comments.h_enclosing + 6)
        {
            // find the `else`
            let else_index = self.seek(SOUGHT_ELSE, self.n.at(consequent + 2), |q, from| {
                let mut else_index = from;
                loop {
                    else_index = q.index_of_outside_comments(101, else_index);
                    if else_index < 0
                        || (q.t.at(else_index + 1) == 108
                            && q.t.at(else_index + 2) == 115
                            && q.t.at(else_index + 3) == 101)
                    {
                        return else_index;
                    }
                    else_index += 1;
                }
            });
            if self.comments.h_start >= else_index {
                self.add_leading(self.comments.h_following, self.comments.h_comment);
                return true;
            }
            if self.comments.h_preceding_kind != k::BlockStatement
                && self.is_single_line_comment()
                && !self
                    .has_newline_before_comment_from(self.n.at(self.comments.h_preceding + 2), 0)
            {
                self.add_trailing(self.comments.h_preceding, self.comments.h_comment);
                return true;
            }
            self.add_dangling(self.comments.h_enclosing, self.comments.h_comment);
            return true;
        }
        return false;
    }

    pub(crate) fn handle_while_like_comments(&mut self) -> bool {
        if (self.comments.h_enclosing_kind != k::WhileStatement
            && self.comments.h_enclosing_kind != k::WithStatement)
            || self.comments.h_following == 0
        {
            return false;
        }
        if self.next_char_behind_comment() == 41 {
            self.add_trailing(self.comments.h_preceding, self.comments.h_comment);
            return true;
        }
        if self.n.at(self.comments.h_enclosing + 5) == self.comments.h_following {
            self.add_leading(self.comments.h_following, self.comments.h_comment);
            return true;
        }
        return false;
    }

    pub(crate) fn handle_switch_statement_comments(&mut self) -> bool {
        if !(self.comments.h_enclosing_kind == k::SwitchStatement
            && self.n.at(self.n.at(self.comments.h_enclosing + 5)) == 0
            && self.comments.h_following == 0
            && self.comments.h_preceding == self.n.at(self.comments.h_enclosing + 4))
        {
            return false;
        }
        if self.next_char_behind_comment() == 125 {
            self.add_dangling(self.comments.h_enclosing, self.comments.h_comment);
            return true;
        }
        return false;
    }

    pub(crate) fn handle_try_statement_comments(&mut self) -> bool {
        if (self.comments.h_enclosing_kind != k::TryStatement
            && self.comments.h_enclosing_kind != k::CatchClause)
            || self.comments.h_following == 0
        {
            return false;
        }
        if self.comments.h_enclosing_kind == k::CatchClause && self.comments.h_preceding != 0 {
            self.add_trailing(self.comments.h_preceding, self.comments.h_comment);
            return true;
        }
        if self.comments.h_following_kind == k::BlockStatement {
            self.add_block_statement_first_comment(
                self.comments.h_following,
                self.comments.h_comment,
            );
            return true;
        }
        if self.comments.h_following_kind == k::TryStatement {
            self.add_block_or_not_comment(
                self.n.at(self.comments.h_following + 6),
                self.comments.h_comment,
            );
            return true;
        }
        if self.comments.h_following_kind == k::CatchClause {
            self.add_block_or_not_comment(
                self.n.at(self.comments.h_following + 5),
                self.comments.h_comment,
            );
            return true;
        }
        return false;
    }

    pub(crate) fn handle_class_comments(&mut self) -> bool {
        if self.comments.h_enclosing_kind != k::ClassDeclaration
            && self.comments.h_enclosing_kind != k::ClassExpression
            && self.comments.h_enclosing_kind != k::InterfaceDeclaration
            && self.comments.h_enclosing_kind != k::DeclareClass
        {
            return false;
        }
        let decorators = self.n.at(self.comments.h_enclosing + 7);
        if self.n.at(decorators) > 0 && self.comments.h_following_kind != k::Decorator {
            self.add_trailing(
                self.n.at(decorators + self.n.at(decorators)),
                self.comments.h_comment,
            );
            return true;
        }
        let body = self.n.at(self.comments.h_enclosing + 6);
        if self.comments.h_following == body {
            self.add_block_statement_first_comment(body, self.comments.h_comment);
            return true;
        }
        if self.comments.h_following != 0 {
            let super_class = self.n.at(self.comments.h_enclosing + 5);
            let type_parameters = self.n.at(self.comments.h_enclosing + CL_TYPE_PARAMETERS);
            if super_class != 0
                && self.comments.h_following == super_class
                && self.comments.h_preceding != 0
                && (self.comments.h_preceding == self.n.at(self.comments.h_enclosing + 4)
                    || self.comments.h_preceding == type_parameters)
            {
                self.add_trailing(self.comments.h_preceding, self.comments.h_comment);
                return true;
            }
            let mut i: i32 = 0;
            while i < 3 {
                'c1: {
                    let list = self.n.at(self.comments.h_enclosing
                        + (if i == 0 {
                            CL_IMPLEMENTS
                        } else {
                            if i == 1 { CL_EXTENDS } else { CL_MIXINS }
                        }));
                    if self.n.at(list) == 0 || self.comments.h_following != self.n.at(list + 1) {
                        break 'c1;
                    }
                    if self.comments.h_preceding != 0
                        && (self.comments.h_preceding == self.n.at(self.comments.h_enclosing + 4)
                            || self.comments.h_preceding == type_parameters
                            || self.comments.h_preceding == super_class)
                    {
                        self.add_trailing(self.comments.h_preceding, self.comments.h_comment);
                    } else {
                        self.add_dangling(self.comments.h_enclosing, self.comments.h_comment);
                        let v0 = self.comments.h_comment * C_STRIDE + C_FLAGS;
                        self.lexer.c.put(
                            v0,
                            self.lexer.c.at(v0)
                                | (if i == 0 {
                                    CF_MARK_IMPLEMENTS
                                } else {
                                    if i == 1 {
                                        CF_MARK_EXTENDS
                                    } else {
                                        CF_MARK_MIXINS
                                    }
                                }),
                        );
                    }
                    return true;
                }
                i += 1;
            }
        }
        return false;
    }

    pub(crate) fn handle_for_x_statement_comments(&mut self) -> bool {
        let k = self.comments.h_enclosing_kind;
        if self.comments.h_following == 0 {
            return false;
        }
        let body: i32;
        if k == k::ForInStatement || k == k::ForOfStatement {
            body = self.n.at(self.comments.h_enclosing + 6);
        } else if k == k::ForStatement {
            body = self.n.at(self.comments.h_enclosing + 7);
        } else {
            return false;
        }
        if self.comments.h_following != body {
            return false;
        }
        if self.comments.h_start
            > self.seek(
                SOUGHT_LAST_PAREN,
                self.n.at(self.comments.h_following + 1),
                |q, from| q.last_index_of_outside_comments(41, from),
            )
        {
            self.add_leading(self.comments.h_following, self.comments.h_comment);
            return true;
        }
        return false;
    }

    pub(crate) fn handle_only_comments(&mut self) -> bool {
        if self.comments.h_enclosing_kind == k::Program
            && self.n.at(self.n.at(self.comments.h_enclosing + 5)) == 0
            && self.n.at(self.n.at(self.comments.h_enclosing + 4)) == 0
        {
            if self.comments.h_is_last {
                self.add_dangling(self.comments.h_enclosing, self.comments.h_comment);
            } else {
                self.add_leading(self.comments.h_enclosing, self.comments.h_comment);
            }
            return true;
        }
        return false;
    }

    pub(crate) fn handle_module_specifiers_comments(&mut self) -> bool {
        if self.comments.h_enclosing_kind == k::ImportSpecifier
            || self.comments.h_enclosing_kind == k::ExportSpecifier
        {
            self.add_leading(self.comments.h_enclosing, self.comments.h_comment);
            return true;
        }
        let is_import = self.comments.h_preceding_kind == k::ImportSpecifier
            && self.comments.h_enclosing_kind == k::ImportDeclaration;
        let is_export = self.comments.h_preceding_kind == k::ExportSpecifier
            && self.comments.h_enclosing_kind == k::ExportNamedDeclaration;
        if (is_import || is_export) && self.has_newline(self.comments.h_end) {
            self.add_trailing(self.comments.h_preceding, self.comments.h_comment);
            return true;
        }
        return false;
    }

    pub(crate) fn handle_assignment_pattern_comments(&mut self) -> bool {
        if self.comments.h_enclosing_kind == k::AssignmentPattern {
            self.add_leading(self.comments.h_enclosing, self.comments.h_comment);
            return true;
        }
        return false;
    }
}
pub(crate) fn is_property_like(kind: i32) -> bool {
    return kind == k::ClassMethod || kind == k::ClassProperty || kind == k::ParameterProperty;
}

impl Quick {
    pub(crate) fn handle_method_name_comments(&mut self) -> bool {
        if (self.mode.is_type_script || self.mode.is_flow)
            && self.comments.h_preceding_kind == k::Identifier
            && (self.comments.h_enclosing_kind == k::ObjectMethod
                || self.comments.h_enclosing_kind == k::ObjectProperty
                || self.is_abstract_method(self.comments.h_enclosing))
            && self.n.at(self.comments.h_enclosing + 4) == self.comments.h_preceding
            && self.next_char_behind_comment() == 40
            && self.seek(
                SOUGHT_NEXT,
                self.n.at(self.comments.h_preceding + 2),
                Self::next_char,
            ) != 58
        {
            self.add_trailing(self.comments.h_preceding, self.comments.h_comment);
            return true;
        }
        if is_property_like(self.comments.h_enclosing_kind)
            && self.comments.h_following == 0
            && self.comments.h_placement == 0
        {
            let to = if self.next_char_behind_comment() == 40 {
                self.comments.h_preceding
            } else {
                self.comments.h_enclosing
            };
            self.add_trailing(to, self.comments.h_comment);
            return true;
        }
        if self.comments.h_preceding_kind == k::Decorator
            && is_property_like(self.comments.h_enclosing_kind)
            && (!self.comments.h_is_block || self.comments.h_placement == CF_OWN_LINE)
        {
            self.add_trailing(self.comments.h_preceding, self.comments.h_comment);
            return true;
        }
        return false;
    }

    pub(crate) fn handle_labeled_statement_comments(&mut self) -> bool {
        if self.comments.h_enclosing_kind == k::LabeledStatement {
            self.add_leading(self.comments.h_enclosing, self.comments.h_comment);
            return true;
        }
        return false;
    }
}

impl Quick {
    pub(crate) fn is_type_cast_comment_at(&self, comment: i32) -> bool {
        let at = comment * C_STRIDE;
        if (self.lexer.c.at(at + C_FLAGS) & CF_BLOCK) == 0 {
            return false;
        }
        let s = self.lexer.c.at(at + C_START);
        let e = self.lexer.c.at(at + C_END);
        if self.t.at(s + 2) != 42 {
            return false;
        }
        let mut p = s + 3;
        while p < e - 2 {
            'c1: {
                if self.t.at(p) != 64 {
                    break 'c1;
                }
                let after: i32;
                if self.t.at(p + 1) == 116
                    && self.t.at(p + 2) == 121
                    && self.t.at(p + 3) == 112
                    && self.t.at(p + 4) == 101
                {
                    after = self.t.at(p + 5);
                } else if self.text_is(p + 1, p + 10, b"satisfies") {
                    after = self.t.at(p + 10);
                } else {
                    break 'c1;
                }
                if !((after >= 48 && after <= 57)
                    || (after >= 65 && after <= 90)
                    || (after >= 97 && after <= 122)
                    || after == 95)
                {
                    return true;
                }
            }
            p += 1;
        }
        return false;
    }

    pub(crate) fn handle_closure_type_cast_comments(&mut self) -> bool {
        if self.comments.h_following != 0 && self.is_type_cast_comment_at(self.comments.h_comment) {
            self.add_leading(self.comments.h_following, self.comments.h_comment);
            return true;
        }
        return false;
    }

    pub(crate) fn handle_call_expression_comments(&mut self) -> bool {
        if self.comments.h_enclosing_kind != k::CallExpression
            && self.comments.h_enclosing_kind != k::NewExpression
        {
            return false;
        }
        let args = self.n.at(self.comments.h_enclosing + 5);
        if self.n.at(self.comments.h_enclosing + 4) != self.comments.h_preceding
            || self.n.at(args) == 0
        {
            return false;
        }
        // is the comment between the parentheses?
        let closing = self.n.at(self.comments.h_enclosing + 2) - 1;
        if self.t.at(closing) != 41 || self.comments.h_end > closing {
            return false;
        }
        let opening = self.seek(
            SOUGHT_PAREN,
            self.n.at(self.comments.h_preceding + 2),
            |q, from| q.index_of_outside_comments(40, from),
        );
        if opening < 0 || self.comments.h_start <= opening {
            return false;
        }
        self.add_leading(self.n.at(args + 1), self.comments.h_comment);
        return true;
    }

    pub(crate) fn handle_property_comments(&mut self) -> bool {
        if self.comments.h_enclosing_kind == k::ObjectProperty {
            self.add_leading(self.comments.h_enclosing, self.comments.h_comment);
            return true;
        }
        return false;
    }

    pub(crate) fn handle_assignment_like_comments(&mut self) -> bool {
        if (self.comments.h_enclosing_kind == k::VariableDeclarator
            || self.comments.h_enclosing_kind == k::AssignmentExpression
            || self.comments.h_enclosing_kind == k::TypeAlias)
            && self.comments.h_following != 0
            && self.comments.h_placement == CF_END_OF_LINE
        {
            let k = self.comments.h_following_kind;
            if k == k::ObjectExpression
                || k == k::ArrayExpression
                || k == k::TemplateLiteral
                || k == k::TaggedTemplateExpression
                || k == k::TypeLiteral
                || self.comments.h_is_block
            {
                return self.add_leading_comment_to_possible_union_type(self.comments.h_following);
            }
        }
        if self.comments.h_enclosing_kind == k::TypeAlias
            && self.comments.h_following != 0
            && self.comments.h_start
                >= self.seek(
                    SOUGHT_EQUALS,
                    self.n.at(self.n.at(self.comments.h_enclosing + 4) + 2),
                    |q, from| q.index_of_outside_comments(61, from),
                )
        {
            return self.add_leading_comment_to_possible_union_type(self.comments.h_following);
        }
        return false;
    }

    pub(crate) fn handle_switch_default_case_comments(&mut self) -> bool {
        if self.comments.h_enclosing_kind != k::SwitchCase
            || self.n.at(self.comments.h_enclosing + 4) != 0
            || self.comments.h_following == 0
        {
            return false;
        }
        let consequent = self.n.at(self.comments.h_enclosing + 5);
        if self.n.at(consequent) == 0 || self.comments.h_following != self.n.at(consequent + 1) {
            return false;
        }
        if self.comments.h_following_kind == k::BlockStatement && !self.comments.h_is_block {
            self.add_block_statement_first_comment(
                self.comments.h_following,
                self.comments.h_comment,
            );
        } else {
            self.add_dangling(self.comments.h_enclosing, self.comments.h_comment);
        }
        return true;
    }

    pub(crate) fn handle_last_binary_operator_operand(&mut self) -> bool {
        if self.comments.h_following == 0
            && self.comments.h_enclosing_kind == k::UnaryExpression
            && (self.comments.h_preceding_kind == k::LogicalExpression
                || self.comments.h_preceding_kind == k::BinaryExpression)
        {
            let right = self.n.at(self.comments.h_preceding + 5);
            let right_start = self.n.at(right + 1);
            if self.seek(
                SOUGHT_LINE_BREAK,
                self.n.at(self.n.at(self.comments.h_enclosing + 4) + 1),
                |q, from| i32::from(q.has_newline_in_range(from, right_start)),
            ) != 0
                && self.is_single_line_comment()
                && !self.has_newline_before_comment_from(right_start, 1)
            {
                self.add_trailing(right, self.comments.h_comment);
                return true;
            }
        }
        return false;
    }

    pub(crate) fn handle_arrow_expression_comments(&mut self) -> bool {
        if self.comments.h_enclosing_kind != k::ArrowFunctionExpression
            || self.comments.h_following == 0
            || self.comments.h_preceding == 0
        {
            return false;
        }
        // the `=>` before the body
        let body = self.n.at(self.comments.h_enclosing + 5);
        let arrow = self.seek(SOUGHT_ARROW, self.n.at(body + 1), |q, from| {
            let mut arrow = from;
            loop {
                arrow = q.last_index_of_outside_comments(61, arrow);
                if arrow < 0 || q.t.at(arrow + 1) == 62 {
                    return arrow;
                }
                arrow -= 1;
            }
        });
        if !(self.comments.h_end < arrow) {
            self.add_block_or_not_comment(self.comments.h_following, self.comments.h_comment);
            return true;
        }
        return false;
    }

    pub(crate) fn handle_parenthesized_expression_trailing_comment(&mut self) -> bool {
        if self.comments.h_following != 0
            || self.comments.h_enclosing == 0
            || self.comments.h_preceding == 0
        {
            return false;
        }
        if self.comments.h_enclosing_kind == k::ExpressionStatement
            && self.n.at(self.comments.h_enclosing + 4) == self.comments.h_preceding
        {
            self.add_trailing(self.comments.h_enclosing, self.comments.h_comment);
            return true;
        }
        let is_sequence = self.comments.h_preceding_kind == k::SequenceExpression;
        let is_assignment = self.comments.h_preceding_kind == k::AssignmentExpression;
        if (is_sequence || is_assignment)
            && ((self.comments.h_enclosing_kind == k::ArrowFunctionExpression
                && self.n.at(self.comments.h_enclosing + 5) == self.comments.h_preceding)
                || (self.comments.h_enclosing_kind == k::VariableDeclarator
                    && self.n.at(self.comments.h_enclosing + 5) == self.comments.h_preceding)
                || (self.comments.h_enclosing_kind == k::ReturnStatement
                    && self.n.at(self.comments.h_enclosing + 4) == self.comments.h_preceding)
                || (self.comments.h_enclosing_kind == k::AssignmentExpression
                    && self.n.at(self.comments.h_enclosing + 5) == self.comments.h_preceding))
        {
            if is_sequence {
                let l = self.n.at(self.comments.h_preceding + 4);
                self.add_trailing(self.n.at(l + self.n.at(l)), self.comments.h_comment);
            } else {
                self.add_trailing(
                    self.n.at(self.comments.h_preceding + 5),
                    self.comments.h_comment,
                );
            }
            return true;
        }
        return false;
    }

    pub(crate) fn handle_comment_after_arrow_params(&mut self) -> bool {
        if self.comments.h_enclosing_kind != k::ArrowFunctionExpression {
            return false;
        }
        let index = self.next_index_behind_comment();
        if self.t.at(index) == 61 && self.t.at(index + 1) == 62 {
            self.add_dangling(self.comments.h_enclosing, self.comments.h_comment);
            let v0 = self.comments.h_comment * C_STRIDE + C_FLAGS;
            self.lexer.c.put(v0, self.lexer.c.at(v0) | CF_BEFORE_ARROW);
            return true;
        }
        return false;
    }

    pub(crate) fn handle_function_name_comments(&mut self) -> bool {
        if self.next_char_behind_comment() != 40 {
            return false;
        }
        if self.comments.h_preceding != 0 && is_function_like(self.comments.h_enclosing_kind) {
            self.add_trailing(self.comments.h_preceding, self.comments.h_comment);
            return true;
        }
        return false;
    }

    pub(crate) fn handle_own_line(&mut self) -> bool {
        return self.handle_comment_in_empty_parens()
            || self.handle_conditional_expression_comments()
            || self.handle_last_function_parameter_comments()
            || self.handle_member_expression_comments()
            || self.handle_if_statement_comments()
            || self.handle_while_like_comments()
            || self.handle_switch_statement_comments()
            || self.handle_try_statement_comments()
            || self.handle_class_comments()
            || self.handle_for_x_statement_comments()
            || self.handle_union_type_comments()
            || self.handle_only_comments()
            || self.handle_module_specifiers_comments()
            || self.handle_assignment_pattern_comments()
            || self.handle_method_name_comments()
            || self.handle_labeled_statement_comments()
            || self.handle_comments_in_destructuring_pattern()
            || self.handle_ts_mapped_type_comments()
            || self.handle_binary_cast_expression_comment()
            || self.handle_union_type_leading_comments();
    }

    pub(crate) fn handle_end_of_line(&mut self) -> bool {
        return self.handle_comment_in_empty_parens()
            || self.handle_closure_type_cast_comments()
            || self.handle_last_function_parameter_comments()
            || self.handle_conditional_expression_comments()
            || self.handle_module_specifiers_comments()
            || self.handle_if_statement_comments()
            || self.handle_while_like_comments()
            || self.handle_switch_statement_comments()
            || self.handle_try_statement_comments()
            || self.handle_class_comments()
            || self.handle_for_x_statement_comments()
            || self.handle_labeled_statement_comments()
            || self.handle_call_expression_comments()
            || self.handle_property_comments()
            || self.handle_only_comments()
            || self.handle_assignment_like_comments()
            || self.handle_switch_default_case_comments()
            || self.handle_last_union_element_in_expression()
            || self.handle_last_binary_operator_operand()
            || self.handle_ts_mapped_type_comments()
            || self.handle_arrow_expression_comments()
            || self.handle_parenthesized_expression_trailing_comment()
            || self.handle_property_signature_comments()
            || self.handle_binary_cast_expression_comment();
    }

    pub(crate) fn handle_remaining(&mut self) -> bool {
        return self.handle_comment_in_empty_parens()
            || self.handle_if_statement_comments()
            || self.handle_while_like_comments()
            || self.handle_switch_statement_comments()
            || self.handle_for_x_statement_comments()
            || self.handle_method_name_comments()
            || self.handle_only_comments()
            || self.handle_assignment_like_comments()
            || self.handle_ts_mapped_type_comments()
            || self.handle_comment_after_arrow_params()
            || self.handle_function_name_comments()
            || self.handle_ts_function_trailing_comments()
            || self.handle_parenthesized_expression_trailing_comment()
            || self.handle_binary_cast_expression_comment()
            || self.handle_union_type_leading_comments();
    }

    /// merge_nestled_jsdoc_comments: a doc comment that starts where another ends is one comment with it.
    pub(crate) fn merge_nestled_jsdoc_comments(&mut self) {
        const GONE: i32 = -1;
        let mut any_gone = false;
        // Whether the comment behind the one at hand is indentable, if that is known. Two that are make one that is.
        let mut behind: Option<bool> = None;
        let mut i = self.lexer.c_count - 2;
        while i >= self.lexer.c_base {
            let at = i * C_STRIDE;
            let mut this = None;
            if self.lexer.c.at(at + C_END) == self.lexer.c.at(at + C_STRIDE + C_START) {
                let is_indentable = self.is_indentable_block_comment_at(i);
                this = Some(is_indentable);
                if is_indentable
                    && behind.unwrap_or_else(|| self.is_indentable_block_comment_at(i + 1))
                {
                    self.lexer
                        .c
                        .put(at + C_END, self.lexer.c.at(at + C_STRIDE + C_END));
                    let v0 = at + C_FLAGS;
                    self.lexer.c.put(
                        v0,
                        (self.lexer.c.at(v0)
                            & (self.lexer.c.at(at + C_STRIDE + C_FLAGS)
                                | !(CF_PLAIN | CF_INDENTABLE)))
                            | CF_NESTLED,
                    );
                    self.lexer.c.put(at + C_STRIDE + C_START, GONE);
                    any_gone = true;
                }
            }
            behind = this;
            i -= 1;
        }
        if !any_gone {
            return;
        }
        let mut to = self.lexer.c_base;
        let mut from = self.lexer.c_base;
        while from < self.lexer.c_count {
            if self.lexer.c.at(from * C_STRIDE + C_START) != GONE {
                if to != from {
                    self.lexer
                        .c
                        .move_within(to * C_STRIDE, from * C_STRIDE, (from + 1) * C_STRIDE);
                }
                to += 1;
            }
            from += 1;
        }
        self.set_comment_count(to);
    }

    pub(crate) fn attach_comments(&mut self, program: i32) -> R<()> {
        if self.lexer.c_count - self.lexer.c_base > 1 {
            self.merge_nestled_jsdoc_comments();
        }
        let count = self.lexer.c_count;
        if count == self.lexer.c_base {
            return Ok(());
        }
        self.make_room_in_map(count - self.lexer.c_base)?;
        self.comments.ch_pos = 0;
        self.comments.path_pos = 0;
        self.comments.tie_count = 0;
        self.comments.gap_last = -1;
        self.comments.gap_next_of = NO_COMMENT;
        self.comments.own_line_of = NO_COMMENT;
        self.comments.end_of_line_to = NO_COMMENT;
        self.comments.sought = [0; 3];
        self.comments.lines_from = [[0; 3]; 2];
        self.comments.union_line = [0; 3];
        self.comments.asked.clear();
        self.push_level(program);
        let mut i = self.lexer.c_base;
        while i < count {
            if (self.lexer.c.at(i * C_STRIDE + C_FLAGS) & CF_CLAIMED) == 0 {
                self.decorate(i)?;
            }
            i += 1;
        }
        let mut i = self.lexer.c_base;
        while i < count {
            'c2: {
                let at = i * C_STRIDE;
                if (self.lexer.c.at(at + C_FLAGS) & CF_CLAIMED) != 0 {
                    break 'c2;
                }
                self.comments.h_comment = i;
                self.comments.h_start = self.lexer.c.at(at + C_START);
                self.comments.h_end = self.lexer.c.at(at + C_END);
                self.comments.h_enclosing = self.lexer.c.at(at + C_ENCLOSING);
                self.comments.h_preceding = self.lexer.c.at(at + C_PRECEDING);
                self.comments.h_following = self.lexer.c.at(at + C_FOLLOWING);
                self.comments.h_enclosing_kind = self.n.at(self.comments.h_enclosing) & 0xff;
                self.comments.h_preceding_kind = self.n.at(self.comments.h_preceding) & 0xff;
                self.comments.h_following_kind = self.n.at(self.comments.h_following) & 0xff;
                self.comments.h_is_block = (self.lexer.c.at(at + C_FLAGS) & CF_BLOCK) != 0;
                self.comments.h_is_last = i == count - 1;
                self.comments.h_placement = if self.is_own_line(i) {
                    CF_OWN_LINE
                } else {
                    if self.is_end_of_line(i) {
                        CF_END_OF_LINE
                    } else {
                        0
                    }
                };
                let v0 = at + C_FLAGS;
                self.lexer
                    .c
                    .put(v0, self.lexer.c.at(v0) | self.comments.h_placement);
                if !self.is_comment_taken(i) {
                    let stop = self.rare(rare::COMMENT);
                    self.failed_at
                        .set(self.comments.h_start - self.text.src_start);
                    return Err(stop);
                }
                if self.comments.h_placement == CF_OWN_LINE {
                    if self.handle_own_line() {
                    } else if self.comments.h_following != 0 {
                        self.add_leading(self.comments.h_following, i);
                    } else if self.comments.h_preceding != 0 {
                        self.add_trailing(self.comments.h_preceding, i);
                    } else {
                        self.add_dangling(self.comments.h_enclosing, i);
                    }
                } else if self.comments.h_placement == CF_END_OF_LINE {
                    if self.handle_end_of_line() {
                    } else if self.comments.h_preceding != 0 {
                        self.add_trailing(self.comments.h_preceding, i);
                    } else if self.comments.h_following != 0 {
                        self.add_leading(self.comments.h_following, i);
                    } else {
                        self.add_dangling(self.comments.h_enclosing, i);
                    }
                } else {
                    if self.handle_remaining() {
                    } else if self.comments.h_preceding != 0 && self.comments.h_following != 0 {
                        if self.comments.tie_count > 0
                            && self
                                .lexer
                                .c
                                .at(
                                    self.comments.ties.at(self.comments.tie_count - 1) * C_STRIDE
                                        + C_FOLLOWING,
                                )
                                != self.comments.h_following
                        {
                            self.break_ties();
                        }
                        if self.comments.tie_count >= (self.comments.ties.len() as i32) {
                            self.make_room(|q| &mut q.comments.ties, self.comments.tie_count + 1);
                        }
                        self.comments.ties.put(self.comments.tie_count, i);
                        self.comments.tie_count += 1;
                    } else if self.comments.h_preceding != 0 {
                        self.add_trailing(self.comments.h_preceding, i);
                    } else if self.comments.h_following != 0 {
                        self.add_leading(self.comments.h_following, i);
                    } else {
                        self.add_dangling(self.comments.h_enclosing, i);
                    }
                }
            }
            i += 1;
        }
        self.break_ties();
        Ok(())
    }
}
