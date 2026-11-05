//! A recursive descent parser for JavaScript with JSX. It builds the tree that Babel would build (as Prettier sees it after
//! its post-processing), because Prettier's layout rules and comment placement depend on node kinds and ranges.
//! It accepts a superset of the language: a formatter has no use for early errors.

use crate::arena::SUB_SHIFT;
use crate::ast::{
    EXT_AT, F_ACCESSOR, F_AFTER_EMPTY, F_ANY_WIDTH, F_ASYNC, F_AWAIT, F_CHAIN, F_COMPUTED,
    F_DECIDED, F_DEFINITE, F_DELEGATE, F_EXPR_BODY, F_EXT, F_EXTRA, F_GENERATOR, F_LINES,
    F_OPTIONAL, F_PAREN, F_PREFIX, F_SELF_CLOSING, F_SHORTHAND, F_STANDS, F_STATIC, IK_SHIFT,
    IK_TYPE, M_CONSTRUCTOR, M_GET, M_METHOD, M_SET, P_DEFER, P_MODULE, P_NONE, P_SOURCE,
    V_AWAIT_USING, V_CONST, V_LET, V_USING, V_VAR, k,
};
use crate::fast::{
    AFTER_BLOCK, AFTER_REFUSED, BLOCK_ASYNC, BLOCK_CLASS, BLOCK_FUNCTION, BLOCK_INTERFACE,
    BLOCK_JSX, BLOCK_OBJECT, JSX_ELEMENT, JSX_REFUSED, MEMBER_OF_CLASS, STARTS_READY,
    STARTS_READY_MEMBER,
};
use crate::holes::FILTER_END_OF_LINE;
use crate::lexer::{C_END, C_FLAGS, C_START, C_STRIDE, CF_BLOCK, CF_CLAIMED, PREC, kw, tk};
use crate::mode::SINGLE_JSX_IN_MARKDOWN;
use crate::options::{EOL_LF, QUOTE_PROPS_CONSISTENT};
use crate::{Quick, R, Stop, Words, rare, why, zeros};

pub(crate) struct Parse {
    // ---- context
    pub(crate) in_function: i32,
    pub(crate) in_async: i32,
    pub(crate) in_generator: i32,
    /// bit 0: `in` is no operator here (the head of a `for`); bit 1: NO_IN_FSHARP_BODY. Whatever is in brackets starts with 0.
    pub(crate) no_in: i32,
    pub(crate) typed: i32,
    /// Is `<a>` an element? Not in a .ts file.
    pub(crate) jsx_enabled: bool,
    /// A .cjs or .cts file: `await` is a name outside of async functions.
    pub(crate) is_common_js: bool,
    // ---- trying a reading of the text. While this is not 0, a syntax error is thrown without a message: whoever tries catches it.
    pub(crate) speculating: i32,
    /// TypeScript and Flow: the next call of parse_maybe_assign() parses something that may turn out to be a parameter of an arrow
    /// function, so `?` and `: type` can follow its left side.
    pub(crate) paren_item: i32,
    /// babel-flow: where the consequent of the conditional expression that was entered last starts
    pub(crate) consequent_start: i32,
    /// Where the last statement that semicolon() ended stops, without the semicolon.
    pub(crate) content_end: i32,
    /// The statement that ended the directive prologue.
    pub(crate) pending_statement: i32,
    /// Whoever calls for a block, or the body of a class, and goes on reading bytes behind it sets this: the lexer then stays at the end of the block and does not look at what follows.
    pub(crate) lexer_stays: bool,
    // ------------------------------------------------------------------------------------------------------- statements
    /// Simple statements are read, and printed, without tokens and nodes: see fast.rs.
    pub(crate) reads_ahead: bool,
    pub(crate) top_level_await: bool,
    /// How many lists are open whose items are indented: blocks, bodies of classes, objects, arguments and arrays that start on a new line.
    pub(crate) list_depth: i32,
    /// How many comments there were when claim_comments() looked last.
    pub(crate) comments_seen: i32,
    /// Where a statement starts that fast.rs has looked at and cannot read.
    pub(crate) refused_at: i32,
    // ---- What stands in the source as it will be printed is one text, however many lines it has: statements and members that fast.rs has read and not changed, one behind the other, each
    /// indented as the lists around it say, with no more than one empty line between two of them; and a statement with blocks, if all that is in the blocks stands like that.
    /// Whether the lists are right about the indentation is for the printer to say: see standing() of doc.rs.
    pub(crate) joins_lines: bool,
    /// The item that stands and was pushed last. It counts if it is the last item of the list at hand.
    pub(crate) last_standing: i32,
    /// list_depth for the statements of the cases of the innermost `switch`: there a comment can belong to the next `case`.
    pub(crate) cases_depth: i32,
    /// What parse_statement_with_blocks() found: the statement stands, from its start to where the function says that it ends. It has not been pushed then.
    pub(crate) wrap_stands: bool,
    /// from the last `}` on
    pub(crate) wrap_last_length: i32,
    pub(crate) wrap_kind: i32,
    /// F_DECIDED, if that goes for something in the blocks
    pub(crate) wrap_decided: i32,
    /// Blocks that have been read, for a parser that comes by a second time: see parse_statement_with_blocks().
    pub(crate) known_blocks: Vec<i32>,
    pub(crate) known_blocks_count: i32,
    /// Where the last block of the statement that parse_statement_with_blocks() has at hand ends.
    pub(crate) block_end: i32,
    /// Decorators that stood before `abstract class` or `declare class`.
    pub(crate) pending_decorators: i32,
    // ---------------------------------------------------------------------------------------------------------- classes
    /// The call of parse_subscripts() that comes next is for a superclass or the like: a `{` behind it starts something else than a record.
    pub(crate) no_record_expression: i32,
    /// The call of parse_subscripts() that comes next is for a decorator.
    pub(crate) in_decorator: i32,
    /// Set when an item between parentheses got a `?` or a type: an arrow has to follow.
    pub(crate) saw_typed_item: i32,
    /// TypeScript, Flow: the arguments that are parsed next may be the parameters of `async (..) => ..`
    pub(crate) arguments_may_be_parameters: i32,
    /// The object that is parsed next is known to be a pattern.
    pub(crate) object_is_binding: bool,
    /// Set by parse_attributes: F_EXTRA when the keyword is `assert`.
    pub(crate) attributes_flag: i32,
}
impl Parse {
    pub(crate) fn new() -> Self {
        Self {
            in_function: 0,
            in_async: 0,
            in_generator: 0,
            no_in: 0,
            typed: 0,
            jsx_enabled: true,
            is_common_js: false,
            speculating: 0,
            paren_item: 0,
            consequent_start: -1,
            content_end: 0,
            pending_statement: 0,
            lexer_stays: false,
            reads_ahead: false,
            top_level_await: false,
            list_depth: 0,
            comments_seen: 0,
            refused_at: 0,
            joins_lines: false,
            last_standing: 0,
            cases_depth: -1,
            wrap_stands: false,
            wrap_last_length: 0,
            wrap_kind: 0,
            wrap_decided: 0,
            known_blocks: zeros(16),
            known_blocks_count: 0,
            block_end: 0,
            pending_decorators: 0,
            no_record_expression: 0,
            in_decorator: 0,
            saw_typed_item: 0,
            arguments_may_be_parameters: 0,
            object_is_binding: false,
            attributes_flag: 0,
        }
    }
}

// ---- which language: 0 JavaScript, 1 TypeScript, 2 Flow
pub(crate) const TYPED_TS: i32 = 1;
pub(crate) const TYPED_FLOW: i32 = 2;
impl Quick {
    pub(crate) fn set_parser_mode(&mut self, language: i32, jsx: bool) {
        self.parse.typed = language;
        self.parse.jsx_enabled = jsx;
    }

    pub(crate) fn set_is_common_js(&mut self, value: bool) {
        self.parse.is_common_js = value;
    }

    /// Forgets the comments from `p` on: the lexer is about to read them a second time.
    pub(crate) fn drop_comments_from(&mut self, p: i32) {
        let mut count = self.lexer.c_count;
        while count > self.lexer.c_base && self.lexer.c.at((count - 1) * C_STRIDE + C_START) >= p {
            count -= 1;
        }
        self.set_comment_count(count);
    }

    pub(crate) fn set_speculating(&mut self, depth: i32) {
        self.parse.speculating = depth;
    }

    pub(crate) fn unexpected(&self) -> Stop {
        if self.parse.speculating != 0 {
            return self.stop(why::SYNTAX);
        }
        return self.fail(self.lexer.tok_start);
    }

    // The context, for those who try: four small numbers in one.
    pub(crate) fn save_context(&self) -> i32 {
        return self.parse.in_function
            | (self.parse.in_async << 1)
            | (self.parse.in_generator << 2)
            | (self.parse.no_in << 4)
            | (self.parse.list_depth << 8);
    }

    pub(crate) fn restore_context(&mut self, saved: i32) {
        self.parse.in_function = saved & 1;
        self.parse.in_async = (saved >> 1) & 1;
        self.parse.in_generator = (saved >> 2) & 1;
        self.parse.no_in = (saved >> 4) & 7;
        self.parse.list_depth = saved >> 8;
        self.parse.paren_item = 0;
    }
}
// A bit of `no_in`, which is put aside and cleared wherever brackets open: between the `?` and the `:` of a conditional expression,
// where `(a): b => c` needs a second look.
pub(crate) const NO_IN_CONSEQUENT: i32 = 4;
impl Quick {
    pub(crate) fn expect(&mut self, type_: i32) -> R<()> {
        if self.lexer.tok != type_ {
            return Err(self.unexpected());
        }
        self.next()?;
        Ok(())
    }

    pub(crate) fn eat(&mut self, type_: i32) -> R<bool> {
        if self.lexer.tok == type_ {
            self.next()?;
            return Ok(true);
        }
        return Ok(false);
    }

    pub(crate) fn is_word(&self) -> bool {
        return self.lexer.tok == tk::Name || self.lexer.tok >= tk::In;
    }

    pub(crate) fn is_kw(&self, kw: i32) -> bool {
        return self.lexer.tok == tk::Name && self.lexer.tok_kw == kw;
    }

    /// Consumes a semicolon, written or inserted.
    /// The token is a `;` or the `,` of a member of a type. Where the empty lines around it and the comments behind it go, and what these
    /// count for, depends on where the node before it is taken to end. Code without semicolons has `;[a].b()` and `;(a)()`, which are plain.
    #[inline(always)]
    pub(crate) fn check_semicolon_at_line_start(&self) -> R<()> {
        if self.lexer.tok_nl != 0 {
            let next = self.t.at(self.lexer.tok_end);
            if next <= 32 || next == 47 || next == 59 {
                return Err(self.rare(rare::SEMICOLON));
            }
        }
        Ok(())
    }

    pub(crate) fn semicolon(&mut self) -> R<()> {
        self.parse.content_end = self.lexer.prev_end;
        if self.lexer.tok == tk::Semi {
            self.check_semicolon_at_line_start()?;
            self.next()?;
        } else if self.lexer.tok != tk::BraceR
            && self.lexer.tok != tk::EOF
            && self.lexer.tok_nl == 0
        {
            return Err(self.unexpected());
        }
        Ok(())
    }

    pub(crate) fn set_kind(&mut self, n: i32, kind: i32) {
        self.n.put(n, (self.n.at(n) & 0x00ffff00) | kind);
    }

    /// A node without children that has room for a type annotation and decorators (F_EXT).
    pub(crate) fn leaf_with_room(&mut self, head: i32, start: i32, end: i32) -> i32 {
        let n = self.node_raw(head, start, end, 2);
        self.n.put(n + 4, 0);
        self.n.put(n + 5, 0);
        return n;
    }

    pub(crate) fn identifier(&mut self) -> R<i32> {
        // `let` and `async` are the two names that can need parentheses
        let head = k::Identifier
            | self.lexer.tok_flags
            | (if self.lexer.tok_kw == kw::Let || self.lexer.tok_kw == kw::Async {
                F_EXTRA
            } else {
                0
            });
        let n = if self.parse.typed == 0 {
            self.node0(head, self.lexer.tok_start, self.lexer.tok_end)
        } else {
            self.leaf_with_room(head, self.lexer.tok_start, self.lexer.tok_end)
        };
        self.next()?;
        return Ok(n);
    }

    pub(crate) fn parse_ident(&mut self) -> R<i32> {
        if self.lexer.tok != tk::Name {
            return Err(self.unexpected());
        }
        return self.identifier();
    }

    /// After a dot or as a key: any word.
    pub(crate) fn parse_ident_name(&mut self) -> R<i32> {
        if !self.is_word() {
            return Err(self.unexpected());
        }
        return self.identifier();
    }

    // ---------------------------------------------------------------------------------------------------------- program
    pub(crate) fn parse_program(&mut self) -> R<i32> {
        self.reserve_ast((self.text.src_end - self.text.src_start) * 2 + 1024);
        self.reset_lexer()?;
        self.parse.no_in = 0;
        self.parse.in_generator = 0;
        self.parse.in_async = 0;
        self.parse.in_function = 0;
        self.reset_typed();
        self.parse.known_blocks_count = 0;
        self.parse.refused_at = 0;
        self.parse.list_depth = 0;
        // (a syntax error can have left these as they were)
        self.parse.lexer_stays = false;
        self.parse.cases_depth = -1;
        self.parse.last_standing = 0;
        self.parse.comments_seen = self.lexer.c_count;
        self.forget_source_unit();
        self.set_jsx_is_on(self.parse.jsx_enabled);
        self.parse.reads_ahead = self.options.short_cuts
            && self.options.guessing
            && (self.doc.text_filter == 0 || self.doc.text_filter == FILTER_END_OF_LINE)
            && self.options.semi
            && !self.options.operator_position_start
            && self.options.quote_props != QUOTE_PROPS_CONSISTENT
            && (self.mode.single_statement_mode == 0
                || self.mode.single_statement_mode == SINGLE_JSX_IN_MARKDOWN);
        self.parse.top_level_await =
            !self.parse.is_common_js && (self.parse.typed != TYPED_FLOW || self.mode.is_babel_flow);
        // (MDX looks at each statement)
        self.parse.joins_lines = self.parse.reads_ahead
            && self.lang.guest_column == 0
            && self.doc.text_filter == 0
            && self.options.end_of_line == EOL_LF
            && !self.options.use_tabs
            && self.mode.single_statement_mode == 0;
        self.set_may_break_lines(self.parse.joins_lines);
        let mut known: i32 = 0;
        if self.fast.verified_end != 0 {
            if self.parse.reads_ahead
                && self.fast.verified_start == self.text.src_start
                && self.parse.typed != TYPED_FLOW
                && self.lang.guest_column == 0
            {
                known = self.node_raw(
                    k::ReadyLines,
                    self.text.src_start,
                    self.fast.verified_end,
                    0,
                );
                self.set_pos(self.fast.verified_end);
            }
            self.set_verified(0, 0);
        }
        self.next()?;
        let directives = if known == 0 {
            self.parse_directives()?
        } else {
            0
        };
        let mark = self.arena.ls_pos;
        if known != 0 {
            self.list_push(known);
        }
        if self.parse.pending_statement != 0 {
            self.list_push(self.parse.pending_statement);
            self.parse.pending_statement = 0;
        }
        while self.lexer.tok != tk::EOF {
            if self.lexer.c_count != self.parse.comments_seen {
                self.claim_comments(false);
            }
            if self.parse.reads_ahead && STARTS_READY.at(self.lexer.tok) != 0 {
                let behind = self.parse_statements_in_list()?;
                if behind != 0 {
                    self.catch_up(behind)?;
                }
            } else {
                let v0 = self.parse_statement()?;
                self.list_push(v0);
            }
        }
        let body = self.list_finish(mark);
        return Ok(self.node_ll(
            k::Program,
            self.text.src_start,
            self.text.src_end,
            directives,
            body,
        ));
    }

    pub(crate) fn reset_typed(&mut self) {
        // a syntax error can have left any of these set
        self.parse.pending_decorators = 0;
        self.parse.no_record_expression = 0;
        self.parse.in_decorator = 0;
        self.parse.arguments_may_be_parameters = 0;
        self.parse.saw_typed_item = 0;
        self.parse.paren_item = 0;
        self.parse.speculating = 0;
        self.parse.object_is_binding = false;
        self.parse.consequent_start = -1;
        // whatever the language now: the last file may have been Flow, and have ended in the middle
        self.ts_reset_context();
    }

    pub(crate) fn parse_directives(&mut self) -> R<i32> {
        self.parse.pending_statement = 0;
        if self.lexer.tok != tk::String {
            return Ok(0);
        }
        let mark = self.arena.ls_pos;
        while self.lexer.tok == tk::String {
            let statement = self.parse_statement()?;
            let expression = self.n.at(statement + 4);
            if (self.n.at(statement) & 0xff) == k::ExpressionStatement
                && (self.n.at(expression) & (0xff | F_PAREN)) == k::StringLiteral
            {
                self.set_kind_keep_flags(expression, k::DirectiveLiteral);
                self.set_kind(statement, k::Directive);
                self.list_push(statement);
            } else {
                self.parse.pending_statement = statement;
                break;
            }
        }
        return Ok(self.list_finish(mark));
    }

    pub(crate) fn set_kind_keep_flags(&mut self, n: i32, kind: i32) {
        self.n.put(n, (self.n.at(n) & !0xff) | kind);
    }

    /// `{ directives statements }`; the current token is `{`.
    pub(crate) fn parse_block_like(&mut self, kind: i32, with_directives: bool) -> R<i32> {
        let start = self.lexer.tok_start;
        let stays = self.parse.lexer_stays;
        self.parse.lexer_stays = false;
        if self.parse.known_blocks_count != 0 && self.lexer.tok == tk::BraceL {
            let known = self.known_block_at(start);
            if known != 0 {
                self.set_pos(self.n.at(known + 2));
                if !stays {
                    self.next()?;
                }
                return Ok(known);
            }
        }
        if self.lexer.tok != tk::BraceL {
            return Err(self.unexpected());
        }
        self.parse.list_depth += 1;
        let mut directives: i32 = 0;
        let mut mark = self.arena.ls_pos;
        // not 0: the lexer has been left behind, and this is the end of the last statement
        let mut behind: i32 = 0;
        let mut started = false;
        if self.parse.reads_ahead && self.t.at(self.lexer.tok_end) == 10 {
            let mut read = self.read_next_statement_of(
                self.lexer.tok_end,
                self.parse.typed,
                self.parse.in_async != 0
                    || (self.parse.in_function == 0 && self.parse.top_level_await),
                self.parse.list_depth.wrapping_mul(self.options.tab_width),
            )?;
            let mut from = self.lexer.tok_end;
            if !read && self.fast.ready_start == 0 && self.parse.joins_lines {
                let end = self.read_comments(
                    from,
                    self.parse.list_depth.wrapping_mul(self.options.tab_width),
                    false,
                );
                if end != 0 {
                    self.push_standing(
                        self.fast.comments_start,
                        end,
                        self.fast.comments_last_length,
                        k::None,
                        0,
                    );
                    from = end;
                    behind = end;
                    read = self.read_next_statement(from)?;
                }
            }
            if read {
                behind = self.read_statements(self.fast.ready_start, from)?;
                from = 0;
            } else {
                self.parse.refused_at = self.fast.ready_start;
            }
            if from == self.lexer.tok_end {
                self.next()?;
            } else {
                started = true;
            }
        } else {
            self.next()?;
        }
        if !started {
            if with_directives {
                directives = self.parse_directives()?;
                mark = self.arena.ls_pos;
                if self.parse.pending_statement != 0 {
                    self.list_push(self.parse.pending_statement);
                    self.parse.pending_statement = 0;
                }
            }
        }
        let end: i32;
        loop {
            if behind != 0 {
                let brace = self.closing_brace_behind(behind);
                if brace != 0 {
                    end = brace + 1;
                    break;
                }
                self.catch_up(behind)?;
                behind = 0;
            }
            if self.lexer.tok == tk::BraceR {
                end = self.lexer.tok_end;
                break;
            }
            if self.lexer.tok == tk::EOF {
                return Err(self.unexpected());
            }
            if self.lexer.c_count != self.parse.comments_seen {
                self.claim_comments(false);
            }
            if self.parse.reads_ahead && STARTS_READY.at(self.lexer.tok) != 0 {
                behind = self.parse_statements_in_list()?;
            } else {
                let v0 = self.parse_statement()?;
                self.list_push(v0);
            }
        }
        let body = self.list_finish(mark);
        self.parse.list_depth -= 1;
        self.set_pos(end);
        if !stays {
            self.next()?;
        }
        if kind == k::StaticBlock {
            return Ok(self.node_l(kind, start, end, body));
        }
        return Ok(self.node_ll(kind, start, end, directives, body));
    }

    /// Where the `}` stands, if nothing but blanks and ends of lines comes before it behind p; else 0.
    pub(crate) fn closing_brace_behind(&self, p: i32) -> i32 {
        let mut q = p;
        while self.t.at(q) == 10 || self.t.at(q) == 32 {
            q += 1;
        }
        return if self.t.at(q) == 125 { q } else { 0 };
    }

    /// The lexer was left behind. It goes on behind p, where the last thing that was read from the bytes ends.
    pub(crate) fn catch_up(&mut self, p: i32) -> R<()> {
        self.set_pos(p);
        self.next()?;
        Ok(())
    }

    /// A block whose statements somebody will look at.
    pub(crate) fn parse_block_of_nodes(&mut self) -> R<i32> {
        let saved = self.parse.reads_ahead;
        self.parse.reads_ahead = false;
        let v0 = (|| -> R<i32> {
            return self.parse_block();
        })();
        self.parse.reads_ahead = saved;
        return v0;
    }

    pub(crate) fn parse_block(&mut self) -> R<i32> {
        return self.parse_block_like(k::BlockStatement, false);
    }

    pub(crate) fn enter_list(&mut self) {
        self.parse.list_depth += 1;
    }

    pub(crate) fn leave_list(&mut self) {
        self.parse.list_depth -= 1;
    }

    /// A statement with decorators has been read: it has to be a class.
    pub(crate) fn decorated(&self, n: i32) -> R<i32> {
        let k = self.n.at(n) & 0xff;
        let d = if k == k::ExportNamedDeclaration || k == k::ExportDefaultDeclaration {
            self.n.at(n + 4)
        } else {
            n
        };
        if d == 0 || (self.n.at(d) & 0xff) != k::ClassDeclaration {
            return Err(self.fail(self.n.at(n + 1)));
        }
        return Ok(n);
    }

    /// The current token starts an item of a list of statements or members. The comments between the last token and this one become items of the list
    /// themselves (K.ReadyComment), if each stands alone on its lines: Prettier gives them to the item that follows, and prints them in front of
    /// it, each on lines of its own, with the empty lines of the source. So nobody has to find out where they belong. Those on the line of the last token
    /// are not among them. All or none: "prettier-ignore" in any of them is about the item that follows.
    pub(crate) fn claim_comments(&mut self, members: bool) {
        if self.parse.joins_lines && self.parse.reads_ahead {
            let end = self.read_comments(
                if self.lexer.prev_end == self.text.src_start {
                    self.text.src_start - 1
                } else {
                    self.lexer.prev_end
                },
                self.parse.list_depth.wrapping_mul(self.options.tab_width),
                members,
            );
            if end != 0 {
                self.drop_comments_from(self.lexer.prev_end);
                self.parse.comments_seen = self.lexer.c_count;
                self.push_standing(
                    self.fast.comments_start,
                    end,
                    self.fast.comments_last_length,
                    k::None,
                    0,
                );
                return;
            }
        }
        let count = self.lexer.c_count;
        self.parse.comments_seen = count;
        // (a comment in front of a template can say in which language that is)
        if !self.parse.reads_ahead
            || self.lexer.tok == tk::ParenL
            || self.lexer.tok == tk::Semi
            || self.t.at(self.lexer.tok_start) == 96
        {
            return;
        }
        let from = self.lexer.prev_end;
        let mut first = count;
        while first > self.lexer.c_base && self.lexer.c.at((first - 1) * C_STRIDE + C_START) >= from
        {
            first -= 1;
        }
        let mut claimed = count;
        let mut i = first;
        while i < count {
            'c2: {
                let s = self.lexer.c.at(i * C_STRIDE + C_START);
                let mut b = s;
                while self.t.at(b - 1) == 32 || self.t.at(b - 1) == 9 {
                    b -= 1;
                }
                if self.t.at(b - 1) != 10 && self.t.at(b - 1) != 0 {
                    // behind something on its line: the last token, or another comment
                    if claimed != count {
                        return;
                    }
                    break 'c2;
                }
                if claimed == count {
                    claimed = i;
                }
                let mut v = s + 2;
                if (self.lexer.c.at(i * C_STRIDE + C_FLAGS) & CF_BLOCK) != 0 {
                    let mut e = self.lexer.c.at(i * C_STRIDE + C_END);
                    while self.t.at(e) == 32 || self.t.at(e) == 9 {
                        e += 1;
                    }
                    if self.t.at(e) != 10 {
                        return;
                    }
                    // `/*:: ..` and `/*: ..` can be code
                    if self.t.at(v) == 58 {
                        return;
                    }
                    if self.t.at(v) == 42 {
                        v += 1;
                    }
                }
                while self.t.at(v) == 32 || self.t.at(v) == 9 || self.t.at(v) == 10 {
                    v += 1;
                }
                if self.t.at(v) == 112 && self.text_is(v, v + 15, b"prettier-ignore") {
                    return;
                }
            }
            i += 1;
        }
        let mut i = claimed;
        while i < count {
            let at = i * C_STRIDE;
            let n = self.node_raw(
                k::ReadyComment,
                self.lexer.c.at(at + C_START),
                self.lexer.c.at(at + C_END),
                1,
            );
            self.n.put(n + 4, self.lexer.c.at(at + C_FLAGS));
            let v0 = at + C_FLAGS;
            self.lexer.c.put(v0, self.lexer.c.at(v0) | CF_CLAIMED);
            self.list_push(n);
            i += 1;
        }
    }

    /// Pushes a statement of a list, where each starts a line of the output; and the simple statements that follow it, if it is one itself.
    /// Returns 0 if the current token is what follows. Else the lexer has been left behind, and what is returned is where the last statement ends: see catch_up().
    pub(crate) fn parse_statements_in_list(&mut self) -> R<i32> {
        let start = self.lexer.tok_start;
        if start == self.parse.refused_at
            || !self.read_statement(
                start,
                self.parse.typed,
                self.parse.in_async != 0
                    || (self.parse.in_function == 0 && self.parse.top_level_await),
                self.parse.list_depth.wrapping_mul(self.options.tab_width),
            )?
        {
            let v0 = self.parse_statement()?;
            self.list_push(v0);
            return Ok(0);
        }
        return self.read_statements(start, self.lexer.prev_end);
    }

    /// fast.rs has read the statement at `start`; what stands in front of it ends at `behind`. Pushes it and those that follow, as far as fast.rs reads them. Returns what parse_statements_in_list() returns.
    pub(crate) fn read_statements(&mut self, mut start: i32, mut behind: i32) -> R<i32> {
        loop {
            if self.fast.ready_block != 0 {
                let last = self.parse.last_standing;
                behind = self.parse_statement_with_blocks(start, behind, false)?;
                if behind == 0 {
                    return Ok(0);
                }
                self.parse.last_standing = last;
                if self.parse.wrap_stands {
                    self.push_standing(
                        start,
                        behind,
                        self.parse.wrap_last_length,
                        self.parse.wrap_kind,
                        self.parse.wrap_decided,
                    );
                } else {
                    self.parse.last_standing = 0;
                }
                if !self.read_next_statement_of(
                    behind,
                    self.parse.typed,
                    self.parse.in_async != 0
                        || (self.parse.in_function == 0 && self.parse.top_level_await),
                    self.parse.list_depth.wrapping_mul(self.options.tab_width),
                )? {
                    if self.fast.ready_start != 0
                        || !self.parse.joins_lines
                        || self.parse.list_depth == self.parse.cases_depth
                    {
                        break;
                    }
                    let end = self.read_comments(
                        behind,
                        self.parse.list_depth.wrapping_mul(self.options.tab_width),
                        false,
                    );
                    if end == 0 {
                        break;
                    }
                    self.push_standing(
                        self.fast.comments_start,
                        end,
                        self.fast.comments_last_length,
                        k::None,
                        0,
                    );
                    behind = end;
                    if !self.read_next_statement(behind)? {
                        break;
                    }
                }
            } else {
                if self.fast.ready_stands
                    && self.parse.joins_lines
                    && start + self.fast.ready_length == self.fast.ready_next
                {
                    self.push_standing(
                        start,
                        self.fast.ready_next,
                        self.fast.ready_last_length,
                        self.fast.ready_kind,
                        0,
                    );
                } else if self.fast.ready_last_length != self.fast.ready_length {
                    // lines that the reader has put together
                    let n = self.node_raw(
                        k::Ready
                            | F_LINES
                            | self.fast.ready_flags
                            | (self.fast.ready_kind << SUB_SHIFT),
                        start,
                        self.fast.ready_end,
                        4,
                    );
                    self.n.put(n + 4, self.fast.ready_text);
                    self.n.put(n + 5, self.fast.ready_length);
                    self.n.put(n + 6, self.fast.ready_column);
                    self.n.put(n + 7, self.fast.ready_last_length);
                    self.list_push(n);
                    self.parse.last_standing = 0;
                } else {
                    let n = self.node_raw(
                        k::Ready | self.fast.ready_flags | (self.fast.ready_kind << SUB_SHIFT),
                        start,
                        self.fast.ready_end,
                        2,
                    );
                    self.n.put(n + 4, self.fast.ready_text);
                    self.n.put(n + 5, self.fast.ready_length);
                    self.list_push(n);
                    self.parse.last_standing = 0;
                }
                behind = self.fast.ready_next;
                self.parse.content_end = self.fast.ready_end;
                if !self.read_next_statement(behind)? {
                    if self.fast.ready_start != 0
                        || !self.parse.joins_lines
                        || self.parse.list_depth == self.parse.cases_depth
                    {
                        break;
                    }
                    let end = self.read_comments(
                        behind,
                        self.parse.list_depth.wrapping_mul(self.options.tab_width),
                        false,
                    );
                    if end == 0 {
                        break;
                    }
                    self.push_standing(
                        self.fast.comments_start,
                        end,
                        self.fast.comments_last_length,
                        k::None,
                        0,
                    );
                    behind = end;
                    if !self.read_next_statement(behind)? {
                        break;
                    }
                }
            }
            start = self.fast.ready_start;
        }
        self.parse.refused_at = self.fast.ready_start;
        return Ok(behind);
    }

    /// The item that fast.rs has read last stands: T[start, end), whose last line has `last_length` bytes. It goes on the text before it, or becomes a node.
    pub(crate) fn push_standing(
        &mut self,
        start: i32,
        end: i32,
        last_length: i32,
        kind: i32,
        decided: i32,
    ) {
        let last = self.parse.last_standing;
        let column = self.parse.list_depth.wrapping_mul(self.options.tab_width);
        let head = k::Ready | F_STANDS | self.fast.ready_flags | decided | (kind << SUB_SHIFT);
        if last != 0
            && self.arena.ls_pos > 0
            && self.arena.ls.at(self.arena.ls_pos - 1) == last
            && self.n.at(last + 6) == column
        {
            // a line break, or two, and the indentation
            let last_end = self.n.at(last + 4) + self.n.at(last + 5);
            let between = start - last_end - column;
            if self.t.at(last_end) == 10
                && (between == 1 || (between == 2 && self.t.at(last_end + 1) == 10))
            {
                self.n
                    .put(last, head | F_LINES | (self.n.at(last) & F_DECIDED));
                self.n.put(last + 2, self.fast.ready_end);
                self.n.put(last + 5, end - self.n.at(last + 4));
                self.n.put(last + 7, last_length);
                return;
            }
        }
        // (a comment may be as long as it likes)
        let n = self.node_raw(
            if end - start != last_length || kind == k::None {
                head | F_LINES
            } else {
                head
            },
            start,
            self.fast.ready_end,
            4,
        );
        self.n.put(n + 4, start);
        self.n.put(n + 5, end - start);
        self.n.put(n + 6, column);
        self.n.put(n + 7, last_length);
        self.list_push(n);
        self.parse.last_standing = n;
    }

    /// Is all that the block or body of a class `block`, of a statement that is indented by `column`, holds one text that stands, and do its braces stand as they are printed?
    pub(crate) fn block_stands(&self, block: i32, list: i32, column: i32) -> bool {
        if self.n.at(list) != 1 {
            return false;
        }
        let item = self.n.at(list + 1);
        if (self.n.at(item) & (0xff | F_STANDS)) != (k::Ready | F_STANDS) {
            return false;
        }
        let from = self.n.at(item + 4);
        // `{`, a line break, the indentation
        if from - self.n.at(block + 1) != self.n.at(item + 6) + 2
            || self.n.at(item + 6) != column + self.options.tab_width
        {
            return false;
        }
        // a line break, the indentation, `}`
        let mut p = from + self.n.at(item + 5);
        let brace = self.n.at(block + 2) - 1;
        if self.t.at(p) != 10 || brace - p != column + 1 {
            return false;
        }
        p += 1;
        while p < brace {
            if self.t.at(p) != 32 {
                return false;
            }
            p += 1;
        }
        return true;
    }

    /// Pushes the member of a class or an interface at hand, and the simple ones that follow it, if fast.rs can read it; else nothing has happened.
    pub(crate) fn parse_ready_members(&mut self, where_: i32) -> R<bool> {
        let start = self.lexer.tok_start;
        if !self.parse.reads_ahead
            || start == self.parse.refused_at
            || !self.read_member(
                start,
                where_,
                self.parse.typed,
                self.parse.list_depth.wrapping_mul(self.options.tab_width),
            )?
        {
            return Ok(false);
        }
        let behind = self.read_members(start, self.lexer.prev_end, where_)?;
        if behind != 0 {
            self.catch_up(behind)?;
        }
        return Ok(true);
    }

    /// read_statements() for members.
    pub(crate) fn read_members(&mut self, mut start: i32, mut behind: i32, where_: i32) -> R<i32> {
        loop {
            if self.fast.ready_block != 0 {
                let last = self.parse.last_standing;
                behind = self.parse_statement_with_blocks(start, behind, true)?;
                if behind == 0 {
                    return Ok(0);
                }
                self.parse.last_standing = last;
                if self.parse.wrap_stands {
                    self.push_standing(
                        start,
                        behind,
                        self.parse.wrap_last_length,
                        self.parse.wrap_kind,
                        self.parse.wrap_decided,
                    );
                } else {
                    self.parse.last_standing = 0;
                }
                if !self.read_next_member_of(
                    behind,
                    where_,
                    self.parse.typed,
                    self.parse.list_depth.wrapping_mul(self.options.tab_width),
                )? {
                    if self.fast.ready_start != 0
                        || !self.parse.joins_lines
                        || where_ != MEMBER_OF_CLASS
                    {
                        break;
                    }
                    let end = self.read_comments(
                        behind,
                        self.parse.list_depth.wrapping_mul(self.options.tab_width),
                        true,
                    );
                    if end == 0 {
                        break;
                    }
                    self.push_standing(
                        self.fast.comments_start,
                        end,
                        self.fast.comments_last_length,
                        k::None,
                        0,
                    );
                    behind = end;
                    if !self.read_next_member(behind, where_)? {
                        break;
                    }
                }
            } else {
                if self.fast.ready_stands
                    && self.parse.joins_lines
                    && start + self.fast.ready_length == self.fast.ready_next
                {
                    self.push_standing(
                        start,
                        self.fast.ready_next,
                        self.fast.ready_last_length,
                        self.fast.ready_kind,
                        0,
                    );
                } else if self.fast.ready_last_length != self.fast.ready_length {
                    let n = self.node_raw(
                        k::Ready
                            | F_LINES
                            | self.fast.ready_flags
                            | (self.fast.ready_kind << SUB_SHIFT),
                        start,
                        self.fast.ready_end,
                        4,
                    );
                    self.n.put(n + 4, self.fast.ready_text);
                    self.n.put(n + 5, self.fast.ready_length);
                    self.n.put(n + 6, self.fast.ready_column);
                    self.n.put(n + 7, self.fast.ready_last_length);
                    self.list_push(n);
                    self.parse.last_standing = 0;
                } else {
                    let n = self.node_raw(
                        k::Ready | self.fast.ready_flags | (self.fast.ready_kind << SUB_SHIFT),
                        start,
                        self.fast.ready_end,
                        2,
                    );
                    self.n.put(n + 4, self.fast.ready_text);
                    self.n.put(n + 5, self.fast.ready_length);
                    self.list_push(n);
                    self.parse.last_standing = 0;
                }
                behind = self.fast.ready_next;
                if !self.read_next_member(behind, where_)? {
                    if self.fast.ready_start != 0
                        || !self.parse.joins_lines
                        || where_ != MEMBER_OF_CLASS
                    {
                        break;
                    }
                    let end = self.read_comments(
                        behind,
                        self.parse.list_depth.wrapping_mul(self.options.tab_width),
                        true,
                    );
                    if end == 0 {
                        break;
                    }
                    self.push_standing(
                        self.fast.comments_start,
                        end,
                        self.fast.comments_last_length,
                        k::None,
                        0,
                    );
                    behind = end;
                    if !self.read_next_member(behind, where_)? {
                        break;
                    }
                }
            }
            start = self.fast.ready_start;
        }
        self.parse.refused_at = self.fast.ready_start;
        return Ok(behind);
    }

    pub(crate) fn known_block_at(&self, start: i32) -> i32 {
        let mut i = self.parse.known_blocks_count - 1;
        while i >= 0 {
            if self.n.at(self.parse.known_blocks.at(i)) != 0
                && self.n.at(self.parse.known_blocks.at(i) + 1) == start
            {
                return self.parse.known_blocks.at(i);
            }
            i -= 1;
        }
        return 0;
    }

    /// fast.rs has read the statement up to the `{` of a block. The block is read here, then fast.rs goes on behind it. If it does not like what it
    /// finds there (`}, 100);`, `}).then(..)`), the statement is parsed like any other, but for the blocks, which are not read again.
    /// What stands in front of the statement ends at `behind`. Pushes the statement, and returns what parse_statements_in_list() returns.
    pub(crate) fn parse_statement_with_blocks(
        &mut self,
        start: i32,
        behind: i32,
        is_class_member: bool,
    ) -> R<i32> {
        self.stack()?;
        let kind = self.fast.ready_kind;
        let column = self.fast.ready_column;
        let list_mark = self.arena.ls_pos;
        let node_mark = self.arena.n_pos;
        let any_width = self.fast.ready_flags & F_ANY_WIDTH;
        let mut stands = self.fast.ready_stands && self.parse.joins_lines;
        let mut decided = self.fast.ready_flags & F_DECIDED;
        // the head can have more than one line
        let head_last_length = self.fast.ready_last_length;
        let head_has_lines = self.fast.ready_last_length != self.fast.ready_length;
        let mut after: i32;
        // Has the lexer looked at what follows the last block?
        let mut looked: bool;
        loop {
            if stands && self.fast.ready_text + self.fast.ready_length != self.fast.ready_block {
                stands = false;
            }
            let pending = self.fast.ready_pending;
            let flags = self.fast.ready_block_flags;
            self.list_push(self.fast.ready_text);
            self.list_push(self.fast.ready_length);
            if (flags & BLOCK_JSX) != 0 {
                // `(`, an element, `)`: the element brings the parentheses with it, if it breaks
                self.set_pos(self.fast.ready_block + 1);
                self.next()?;
                let f = self.parse.in_function;
                let a = self.parse.in_async;
                let g = self.parse.in_generator;
                if (flags & BLOCK_FUNCTION) != 0 {
                    self.parse.in_function = 1;
                    self.parse.in_async = if (flags & BLOCK_ASYNC) != 0 { 1 } else { 0 };
                    self.parse.in_generator = 0;
                }
                self.parse.list_depth += 1;
                let element = self.parse_jsx_element(JSX_IN_PARENS)?;
                self.parse.list_depth -= 1;
                self.parse.in_function = f;
                self.parse.in_async = a;
                self.parse.in_generator = g;
                let comments_inside = self.lexer.c_count;
                self.next()?;
                self.list_push(element);
                looked = true;
                stands = false;
                if self.lexer.tok != tk::ParenR || self.lexer.c_count != comments_inside {
                    after = AFTER_REFUSED;
                    break;
                }
                self.next()?;
            } else {
                self.at_brace(self.fast.ready_block);
                looked = (flags & (BLOCK_INTERFACE | BLOCK_OBJECT)) != 0;
                self.parse.lexer_stays = !looked;
                let block = if (flags & BLOCK_CLASS) != 0 {
                    self.parse_class_body()?
                } else {
                    if (flags & BLOCK_INTERFACE) != 0 {
                        self.ts_parse_interface_body()?
                    } else {
                        if (flags & BLOCK_OBJECT) != 0 {
                            self.parse_object()?
                        } else {
                            if (flags & BLOCK_FUNCTION) != 0 {
                                self.parse_function_body(if (flags & BLOCK_ASYNC) != 0 {
                                    F_ASYNC
                                } else {
                                    0
                                })?
                            } else {
                                self.parse_block()?
                            }
                        }
                    }
                };
                self.list_push(block);
                if stands {
                    let list = self
                        .n
                        .at(block + (if (flags & BLOCK_CLASS) != 0 { 4 } else { 5 }));
                    stands = !looked
                        && ((flags & BLOCK_CLASS) != 0 || self.n.at(self.n.at(block + 4)) == 0)
                        && self.block_stands(block, list, column);
                    if stands {
                        decided |= self.n.at(self.n.at(list + 1)) & F_DECIDED;
                    }
                }
            }
            // (where the lexer stays, it stays at the end of the block)
            let end = if looked {
                self.lexer.prev_end
            } else {
                self.lexer.tok_end
            };
            // (`else`, `catch` and `finally` are all that matters)
            let mut follows = if looked {
                self.lexer.tok
            } else {
                if (pending & 15) >= 2 && (pending & 15) <= 4 {
                    self.word_behind_block(end)
                } else {
                    0
                }
            };
            if follows < 0 {
                self.next()?;
                looked = true;
                follows = self.lexer.tok;
            }
            after = self.read_after_block(
                end,
                pending,
                column,
                follows,
                self.parse.typed,
                self.parse.in_async != 0
                    || (self.parse.in_function == 0 && self.parse.top_level_await),
            )?;
            if !self.fast.ready_stands
                || (after != AFTER_BLOCK
                    && self.fast.ready_length != 0
                    && end + self.fast.ready_length != self.fast.ready_next)
            {
                stands = false;
            }
            if after != AFTER_BLOCK {
                self.parse.block_end = end;
            }
            if !(after == AFTER_BLOCK) {
                break;
            }
        }
        let count = (self.arena.ls_pos - list_mark) / 3;
        if after == AFTER_REFUSED {
            let base = self.parse.known_blocks_count;
            if base + count > (self.parse.known_blocks.len() as i32) {
                let mut grown = zeros::<i32>((base + count) * 2);
                grown.set_all(&self.parse.known_blocks, 0);
                self.parse.known_blocks = grown;
            }
            let mut i: i32 = 0;
            while i < count {
                self.parse
                    .known_blocks
                    .put(base + i, self.arena.ls.at(list_mark + i * 3 + 2));
                i += 1;
            }
            self.parse.known_blocks_count = base + count;
            self.list_truncate(list_mark);
            // the comments in the blocks stay; those behind the last block will be read again
            self.drop_comments_from(self.n.at(self.parse.known_blocks.at(base + count - 1) + 2));
            self.next_at(start, behind)?;
            let v0 = (|| -> R<i32> {
                let v1 = if !is_class_member {
                    self.parse_statement()?
                } else {
                    if self.parse.typed != 0 {
                        self.ts_parse_class_member()?
                    } else {
                        self.parse_class_member()?
                    }
                };
                self.list_push(v1);
                return Ok(0);
            })();
            self.parse.known_blocks_count = base;
            return v0;
        }
        self.parse.wrap_stands = stands;
        if stands {
            // nobody will look at the blocks
            self.list_truncate(list_mark);
            self.truncate_ast(node_mark);
            self.parse.content_end = self.fast.ready_end;
            self.parse.wrap_kind = kind;
            self.parse.wrap_decided = decided;
            let resume = if self.fast.ready_length != 0 {
                self.fast.ready_next
            } else {
                self.parse.block_end
            };
            self.parse.wrap_last_length = resume - self.parse.block_end + 1;
            if looked {
                self.drop_comments_from(resume);
            }
            return Ok(resume);
        }
        let list = self.alloc_ast(count + 1);
        let n = self.node_raw(
            k::ReadyWrap
                | self.fast.ready_flags
                | any_width
                | (if head_has_lines { F_LINES } else { 0 })
                | (kind << SUB_SHIFT),
            start,
            self.fast.ready_end,
            5 + count * 2,
        );
        self.n.put(list, count);
        self.n.put(n + 4, list);
        let mut i: i32 = 0;
        while i < count {
            let block = self.arena.ls.at(list_mark + i * 3 + 2);
            self.n.put(list + 1 + i, block);
            self.n.put(block + 3, n);
            self.n
                .put(n + 5 + i * 2, self.arena.ls.at(list_mark + i * 3));
            self.n
                .put(n + 6 + i * 2, self.arena.ls.at(list_mark + i * 3 + 1));
            i += 1;
        }
        self.n.put(n + 5 + count * 2, self.fast.ready_text);
        self.n.put(n + 6 + count * 2, self.fast.ready_length);
        self.n.put(n + 7 + count * 2, column);
        self.n.put(n + 8 + count * 2, head_last_length);
        self.list_truncate(list_mark);
        self.list_push(n);
        self.parse.content_end = self.fast.ready_end;
        let resume = if self.fast.ready_length != 0 {
            self.fast.ready_next
        } else {
            self.parse.block_end
        };
        // the lexer may have looked at the token behind the block, and at the comments before that token
        if looked {
            self.drop_comments_from(resume);
        }
        return Ok(resume);
    }

    pub(crate) fn parse_statement(&mut self) -> R<i32> {
        self.stack()?;
        let start = self.lexer.tok_start;
        's0: {
            match self.lexer.tok {
                tk::BraceL => {
                    return self.parse_block();
                }
                tk::Semi => {
                    // The body of a loop or of an `if` stands behind a `)` or a word.
                    let before = self.t.at(self.lexer.prev_end - 1);
                    if self.lexer.tok_nl == 0 && (before == 125 || before == 59) {
                        return Err(self.rare(rare::SEMICOLON));
                    }
                    self.check_semicolon_at_line_start()?;
                    self.next()?;
                    return Ok(self.node0(k::EmptyStatement, start, self.lexer.prev_end));
                }
                tk::Var => {
                    return self.parse_var_statement(start, V_VAR);
                }
                tk::Const => {
                    if self.parse.typed == TYPED_TS {
                        let declaration = self.ts_parse_statement(start)?;
                        if declaration != 0 {
                            return Ok(declaration);
                        }
                    }
                    return self.parse_var_statement(start, V_CONST);
                }
                tk::Function => {
                    return self.parse_function(start, k::FunctionDeclaration, 0);
                }
                tk::Class => {
                    let declaration = self.parse_class(start, k::ClassDeclaration, 0)?;
                    if self.n.at(declaration + 4) == 0 {
                        return Err(self.fail(start));
                    }
                    return Ok(declaration);
                }
                tk::At => {
                    {
                        let decorators = self.parse_decorators()?;
                        if self.lexer.tok == tk::Export {
                            let v0 = self.parse_export(start, decorators)?;
                            return self.decorated(v0);
                        }
                        if self.parse.typed == TYPED_TS && self.lexer.tok == tk::Name {
                            // @dec abstract class, @dec declare class
                            self.parse.pending_decorators = decorators;
                            let declaration = self.ts_parse_statement(start)?;
                            if declaration != 0 {
                                return self.decorated(declaration);
                            }
                        }
                        if self.lexer.tok != tk::Class {
                            return Err(self.unexpected());
                        }
                        return self.parse_class(start, k::ClassDeclaration, decorators);
                    }
                }
                tk::If => {
                    self.next()?;
                    let test = self.parse_paren_expression()?;
                    let consequent = self.parse_statement()?;
                    let mut alternate: i32 = 0;
                    if self.eat(tk::Else)? {
                        alternate = self.parse_statement()?;
                    }
                    return Ok(self.node3(
                        k::IfStatement,
                        start,
                        self.n.at((if alternate != 0 {
                            alternate
                        } else {
                            consequent
                        }) + 2),
                        test,
                        consequent,
                        alternate,
                    ));
                }
                tk::Return | tk::Throw => {
                    let kind = if self.lexer.tok == tk::Return {
                        k::ReturnStatement
                    } else {
                        k::ThrowStatement
                    };
                    self.next()?;
                    let mut argument: i32 = 0;
                    if self.lexer.tok != tk::Semi
                        && self.lexer.tok != tk::BraceR
                        && self.lexer.tok != tk::EOF
                        && self.lexer.tok_nl == 0
                    {
                        argument = self.parse_expression()?;
                    }
                    let end = self.lexer.prev_end;
                    self.semicolon()?;
                    return Ok(self.node1(kind, start, end, argument));
                }
                tk::For => {
                    return self.parse_for(start);
                }
                tk::While => {
                    self.next()?;
                    let test = self.parse_paren_expression()?;
                    let body = self.parse_statement()?;
                    return Ok(self.node2(
                        k::WhileStatement,
                        start,
                        self.n.at(body + 2),
                        test,
                        body,
                    ));
                }
                tk::Do => {
                    self.next()?;
                    let body = self.parse_statement()?;
                    self.expect(tk::While)?;
                    let test = self.parse_paren_expression()?;
                    let end = self.lexer.prev_end;
                    self.eat(tk::Semi)?;
                    return Ok(self.node2(k::DoWhileStatement, start, end, body, test));
                }
                tk::Break | tk::Continue => {
                    let kind = if self.lexer.tok == tk::Break {
                        k::BreakStatement
                    } else {
                        k::ContinueStatement
                    };
                    self.next()?;
                    let mut label: i32 = 0;
                    if self.lexer.tok == tk::Name && self.lexer.tok_nl == 0 {
                        label = self.identifier()?;
                    }
                    let end = self.lexer.prev_end;
                    self.semicolon()?;
                    return Ok(self.node1(kind, start, end, label));
                }
                tk::Switch => {
                    return self.parse_switch(start);
                }
                tk::Try => {
                    self.next()?;
                    let block = self.parse_block()?;
                    let mut handler: i32 = 0;
                    let mut finalizer: i32 = 0;
                    if self.lexer.tok == tk::Catch {
                        let clause_start = self.lexer.tok_start;
                        self.next()?;
                        let mut param: i32 = 0;
                        if self.eat(tk::ParenL)? {
                            param = self.parse_binding_atom()?;
                            if self.parse.typed != 0 && self.lexer.tok == tk::Colon {
                                self.parse_binding_suffix(param)?;
                            }
                            self.expect(tk::ParenR)?;
                        }
                        let body = self.parse_block()?;
                        handler = self.node2(
                            k::CatchClause,
                            clause_start,
                            self.lexer.prev_end,
                            param,
                            body,
                        );
                    }
                    if self.eat(tk::Finally)? {
                        finalizer = self.parse_block()?;
                    }
                    if handler == 0 && finalizer == 0 {
                        return Err(self.unexpected());
                    }
                    return Ok(self.node3(
                        k::TryStatement,
                        start,
                        self.lexer.prev_end,
                        block,
                        handler,
                        finalizer,
                    ));
                }
                tk::With => {
                    self.next()?;
                    let object = self.parse_paren_expression()?;
                    let body = self.parse_statement()?;
                    return Ok(self.node2(
                        k::WithStatement,
                        start,
                        self.n.at(body + 2),
                        object,
                        body,
                    ));
                }
                tk::Debugger => {
                    self.next()?;
                    let end = self.lexer.prev_end;
                    self.semicolon()?;
                    return Ok(self.node0(k::DebuggerStatement, start, end));
                }
                tk::Import => {
                    {
                        // import( and import. start expressions
                        self.save();
                        self.next()?;
                        let after = self.lexer.tok;
                        self.restore();
                        if after == tk::ParenL || after == tk::Dot {
                            break 's0;
                        }
                        return self.parse_import(start);
                    }
                }
                tk::Export => {
                    return self.parse_export(start, 0);
                }
                tk::Name => {
                    if self.parse.typed != 0 {
                        let declaration = if self.parse.typed == TYPED_TS {
                            self.ts_parse_statement(start)?
                        } else {
                            self.flow_parse_statement(start)?
                        };
                        if declaration != 0 {
                            return Ok(declaration);
                        }
                    }
                    match self.lexer.tok_kw {
                        kw::Let => {
                            self.save();
                            self.next()?;
                            let is_declaration = self.lexer.tok == tk::Name
                                || self.lexer.tok == tk::BracketL
                                || self.lexer.tok == tk::BraceL;
                            self.restore();
                            if is_declaration {
                                return self.parse_var_statement(start, V_LET);
                            }
                        }
                        kw::Async => {
                            self.save();
                            self.next()?;
                            let is_function =
                                self.lexer.tok == tk::Function && self.lexer.tok_nl == 0;
                            if is_function {
                                return self.parse_function(start, k::FunctionDeclaration, F_ASYNC);
                            }
                            self.restore();
                        }
                        kw::Using => {
                            self.save();
                            self.next()?;
                            let is_declaration = (self.lexer.tok == tk::Void
                                || (self.lexer.tok == tk::Name && self.lexer.tok_kw != kw::Of))
                                && self.lexer.tok_nl == 0;
                            self.restore();
                            if is_declaration {
                                return self.parse_var_statement(start, V_USING);
                            }
                        }
                        kw::Await => {
                            self.save();
                            self.next()?;
                            let mut is_declaration =
                                self.is_kw(kw::Using) && self.lexer.tok_nl == 0;
                            if is_declaration {
                                self.next()?;
                                is_declaration = (self.lexer.tok == tk::Name
                                    || self.lexer.tok == tk::Void)
                                    && self.lexer.tok_nl == 0;
                            }
                            self.restore();
                            if is_declaration {
                                self.next()?;
                                return self.parse_var_statement(start, V_AWAIT_USING);
                            }
                        }
                        _ => {}
                    }
                }
                _ => {}
            }
        }
        let expression = self.parse_expression()?;
        if self.lexer.tok == tk::Colon
            && (self.n.at(expression) & (0xff | F_PAREN)) == k::Identifier
        {
            self.next()?;
            let body = self.parse_statement()?;
            return Ok(self.node2(
                k::LabeledStatement,
                start,
                self.n.at(body + 2),
                expression,
                body,
            ));
        }
        let end = self.lexer.prev_end;
        self.semicolon()?;
        return Ok(self.node1(k::ExpressionStatement, start, end, expression));
    }

    pub(crate) fn parse_paren_expression(&mut self) -> R<i32> {
        self.expect(tk::ParenL)?;
        let expression = self.parse_expression()?;
        self.expect(tk::ParenR)?;
        return Ok(expression);
    }

    pub(crate) fn take_pending_decorators(&mut self) -> i32 {
        let decorators = self.parse.pending_decorators;
        self.parse.pending_decorators = 0;
        return decorators;
    }

    /// TypeScript, Flow: `?` and `: type` behind the name or pattern `n`, which has room for them.
    pub(crate) fn parse_binding_suffix(&mut self, n: i32) -> R<()> {
        if self.lexer.tok == tk::Question {
            self.n.put(n, self.n.at(n) | F_OPTIONAL);
            self.next()?;
            self.n.put(n + 2, self.lexer.prev_end);
        }
        if self.lexer.tok == tk::Colon {
            if EXT_AT.at(self.n.at(n) & 0xff) == 0 {
                // `void: T`: there is no room, and no such thing
                return Err(self.unexpected());
            }
            let annotation = self.ts_parse_type_annotation()?;
            self.n.put(n, self.n.at(n) | F_EXT);
            self.set_child(n, EXT_AT.at(self.n.at(n) & 0xff), annotation);
            self.n.put(n + 2, self.lexer.prev_end);
        }
        Ok(())
    }

    /// The current token is the keyword (the last one of `await using`).
    pub(crate) fn parse_var(&mut self, start: i32, kind: i32) -> R<i32> {
        self.next()?;
        let mark = self.arena.ls_pos;
        let mut last: i32;
        loop {
            let decl_start = self.lexer.tok_start;
            let id = self.parse_binding_atom()?;
            let mut flags: i32 = 0;
            if self.parse.typed != 0 {
                if self.parse.typed == TYPED_TS
                    && self.lexer.tok == tk::Not
                    && self.lexer.tok_nl == 0
                {
                    flags = F_DEFINITE;
                    self.n.put(id, self.n.at(id) | F_DEFINITE);
                    self.next()?;
                }
                if self.lexer.tok == tk::Colon {
                    self.parse_binding_suffix(id)?;
                }
            }
            let mut init: i32 = 0;
            if self.eat(tk::Eq)? {
                init = self.parse_maybe_assign()?;
            }
            last = self.node2(
                k::VariableDeclarator | flags,
                decl_start,
                self.lexer.prev_end,
                id,
                init,
            );
            self.list_push(last);
            if !self.eat(tk::Comma)? {
                break;
            }
        }
        let v0 = k::VariableDeclaration | (kind << SUB_SHIFT);
        let v1 = self.n.at(last + 2);
        let v2 = self.list_finish(mark);
        return Ok(self.node_l(v0, start, v1, v2));
    }

    pub(crate) fn parse_var_statement(&mut self, start: i32, kind: i32) -> R<i32> {
        let declaration = self.parse_var(start, kind)?;
        if kind >= V_USING && self.parse.typed != 0 && !self.mode.is_babel_flow {
            // only Babel lets this pass
            let list = self.n.at(declaration + 4);
            let mut i: i32 = 1;
            while i <= self.n.at(list) {
                if self.n.at(self.n.at(list + i) + 5) == 0 {
                    return Err(self.fail(self.n.at(self.n.at(list + i) + 1)));
                }
                i += 1;
            }
        }
        self.semicolon()?;
        return Ok(declaration);
    }

    pub(crate) fn parse_for(&mut self, start: i32) -> R<i32> {
        self.next()?;
        let mut await_flag: i32 = 0;
        if self.is_kw(kw::Await) {
            await_flag = F_AWAIT;
            self.next()?;
        }
        self.expect(tk::ParenL)?;
        let mut init: i32 = 0;
        if self.lexer.tok != tk::Semi {
            let init_start = self.lexer.tok_start;
            let mut var_kind: i32 = -1;
            if self.lexer.tok == tk::Var {
                var_kind = V_VAR;
            } else if self.lexer.tok == tk::Const {
                var_kind = V_CONST;
            } else if self.lexer.tok == tk::Name
                && (self.lexer.tok_kw == kw::Let
                    || self.lexer.tok_kw == kw::Using
                    || self.lexer.tok_kw == kw::Await)
            {
                let kw = self.lexer.tok_kw;
                self.save();
                self.next()?;
                if kw == kw::Let {
                    if self.lexer.tok == tk::Name
                        || self.lexer.tok == tk::BracketL
                        || self.lexer.tok == tk::BraceL
                    {
                        var_kind = V_LET;
                    }
                } else if kw == kw::Using {
                    if (self.lexer.tok == tk::Void
                        || (self.lexer.tok == tk::Name && self.lexer.tok_kw != kw::Of))
                        && self.lexer.tok_nl == 0
                    {
                        var_kind = V_USING;
                    }
                } else if self.is_kw(kw::Using) && self.lexer.tok_nl == 0 {
                    self.next()?;
                    if (self.lexer.tok == tk::Name || self.lexer.tok == tk::Void)
                        && self.lexer.tok_nl == 0
                    {
                        var_kind = V_AWAIT_USING;
                    }
                }
                self.restore();
                if var_kind == V_AWAIT_USING {
                    self.next()?;
                }
            }
            let saved_no_in = self.parse.no_in;
            self.parse.no_in = 1;
            if var_kind >= 0 {
                init = self.parse_var(init_start, var_kind)?;
            } else {
                init = self.parse_expression()?;
            }
            self.parse.no_in = saved_no_in;
            if self.lexer.tok == tk::In || self.is_kw(kw::Of) {
                let kind = if self.lexer.tok == tk::In {
                    k::ForInStatement
                } else {
                    k::ForOfStatement
                };
                if var_kind < 0 {
                    self.to_assignable(init)?;
                    if self.parse.typed != TYPED_TS {
                        self.check_target(init, true)?;
                    }
                }
                self.next()?;
                let right = if kind == k::ForInStatement {
                    self.parse_expression()?
                } else {
                    self.parse_maybe_assign()?
                };
                self.expect(tk::ParenR)?;
                let body = self.parse_statement()?;
                return Ok(self.node3(
                    kind | await_flag,
                    start,
                    self.n.at(body + 2),
                    init,
                    right,
                    body,
                ));
            }
        }
        self.expect(tk::Semi)?;
        let test = if self.lexer.tok == tk::Semi {
            0
        } else {
            self.parse_expression()?
        };
        self.expect(tk::Semi)?;
        let update = if self.lexer.tok == tk::ParenR {
            0
        } else {
            self.parse_expression()?
        };
        self.expect(tk::ParenR)?;
        let body = self.parse_statement()?;
        return Ok(self.node4(
            k::ForStatement,
            start,
            self.n.at(body + 2),
            init,
            test,
            update,
            body,
        ));
    }

    pub(crate) fn parse_switch(&mut self, start: i32) -> R<i32> {
        self.next()?;
        let discriminant = self.parse_paren_expression()?;
        self.expect(tk::BraceL)?;
        self.parse.list_depth += 2;
        let outer_cases = self.parse.cases_depth;
        self.parse.cases_depth = self.parse.list_depth;
        let mark = self.arena.ls_pos;
        while self.lexer.tok != tk::BraceR {
            let case_start = self.lexer.tok_start;
            let mut test: i32 = 0;
            if self.eat(tk::Case)? {
                test = self.parse_expression()?;
            } else {
                self.expect(tk::Default)?;
            }
            self.expect(tk::Colon)?;
            let inner = self.arena.ls_pos;
            while self.lexer.tok != tk::Case
                && self.lexer.tok != tk::Default
                && self.lexer.tok != tk::BraceR
            {
                if self.lexer.tok == tk::EOF {
                    return Err(self.unexpected());
                }
                if self.parse.reads_ahead && STARTS_READY.at(self.lexer.tok) != 0 {
                    let behind = self.parse_statements_in_list()?;
                    if behind != 0 {
                        self.catch_up(behind)?;
                    }
                } else {
                    let v0 = self.parse_statement()?;
                    self.list_push(v0);
                }
            }
            let consequent = self.list_finish(inner);
            let v1 = self.node1_l(
                k::SwitchCase,
                case_start,
                self.lexer.prev_end,
                test,
                consequent,
            );
            self.list_push(v1);
        }
        let cases = self.list_finish(mark);
        self.parse.cases_depth = outer_cases;
        self.parse.list_depth -= 2;
        self.next()?;
        return Ok(self.node1_l(
            k::SwitchStatement,
            start,
            self.lexer.prev_end,
            discriminant,
            cases,
        ));
    }

    // -------------------------------------------------------------------------------------------------------- functions
    /// `( params )`; returns the list.
    pub(crate) fn parse_params(&mut self) -> R<i32> {
        self.expect(tk::ParenL)?;
        let saved_no_in = self.parse.no_in;
        self.parse.no_in = 0;
        let mark = self.arena.ls_pos;
        while self.lexer.tok != tk::ParenR {
            let v0 = self.parse_binding_element()?;
            self.list_push(v0);
            if self.lexer.tok != tk::ParenR {
                self.expect(tk::Comma)?;
            }
        }
        self.next()?;
        self.parse.no_in = saved_no_in;
        return Ok(self.list_finish(mark));
    }

    pub(crate) fn node1_with_room(&mut self, head: i32, start: i32, end: i32, child: i32) -> i32 {
        let n = self.node_raw(head, start, end, 3);
        self.n.put(n + 4, child);
        self.n.put(n + 5, 0);
        self.n.put(n + 6, 0);
        self.n.put(child + 3, n);
        return n;
    }

    pub(crate) fn node2_with_room(
        &mut self,
        head: i32,
        start: i32,
        end: i32,
        c0: i32,
        c1: i32,
    ) -> i32 {
        let n = self.node_raw(head, start, end, 4);
        self.n.put(n + 4, c0);
        self.n.put(n + 5, c1);
        self.n.put(n + 6, 0);
        self.n.put(n + 7, 0);
        self.n.put(c0 + 3, n);
        self.n.put(c1 + 3, n);
        return n;
    }

    pub(crate) fn list_node_with_room(
        &mut self,
        head: i32,
        start: i32,
        end: i32,
        list: i32,
    ) -> i32 {
        let n = self.node_raw(head, start, end, 3);
        self.n.put(n + 5, 0);
        self.n.put(n + 6, 0);
        self.set_list(n, 4, list);
        return n;
    }

    /// A copy of the parameter `n` with room for decorators.
    pub(crate) fn with_room(&mut self, n: i32) -> R<i32> {
        let head = self.n.at(n);
        let start = self.n.at(n + 1);
        let end = self.n.at(n + 2);
        match head & 0xff {
            k::Identifier => {
                return Ok(self.leaf_with_room(head, start, end));
            }
            k::ObjectPattern | k::ArrayPattern => {
                return Ok(self.list_node_with_room(head, start, end, self.n.at(n + 4)));
            }
            k::RestElement => {
                return Ok(self.node1_with_room(head, start, end, self.n.at(n + 4)));
            }
            k::AssignmentPattern => {
                return Ok(self.node2_with_room(
                    head,
                    start,
                    end,
                    self.n.at(n + 4),
                    self.n.at(n + 5),
                ));
            }
            _ => {}
        }
        return Err(self.unexpected());
    }

    pub(crate) fn parse_typed_binding_element(&mut self) -> R<i32> {
        let start = self.lexer.tok_start;
        let decorators = if self.lexer.tok == tk::At {
            self.parse_decorators()?
        } else {
            0
        };
        let modifiers_start = self.lexer.tok_start;
        let modifiers = if self.parse.typed == TYPED_TS {
            self.ts_parse_binding_modifiers()?
        } else {
            0
        };
        let element_start = self.lexer.tok_start;
        let mut element: i32;
        if self.lexer.tok == tk::Ellipsis {
            self.next()?;
            let argument = self.parse_binding_atom()?;
            // the type of a rest parameter belongs to the name in Flow
            if self.parse.typed == TYPED_FLOW {
                self.parse_binding_suffix(argument)?;
            }
            element =
                self.node1_with_room(k::RestElement, element_start, self.lexer.prev_end, argument);
            self.parse_binding_suffix(element)?;
        } else {
            element = self.parse_binding_atom()?;
            self.parse_binding_suffix(element)?;
            if self.lexer.tok == tk::Eq {
                self.next()?;
                let right = self.parse_maybe_assign()?;
                element = self.node2_with_room(
                    k::AssignmentPattern,
                    element_start,
                    self.lexer.prev_end,
                    element,
                    right,
                );
            }
        }
        if modifiers != 0 {
            return Ok(self.node1_l(
                k::ParameterProperty | (modifiers & 0x00ffff00) | (modifiers << SUB_SHIFT),
                if decorators != 0 {
                    start
                } else {
                    modifiers_start
                },
                self.lexer.prev_end,
                element,
                decorators,
            ));
        }
        if decorators != 0 {
            self.n.put(element, self.n.at(element) | F_EXT);
            self.n.put(element + 1, start);
            self.set_list(
                element,
                EXT_AT.at(self.n.at(element) & 0xff) + 1,
                decorators,
            );
        }
        return Ok(element);
    }

    pub(crate) fn parse_binding_element(&mut self) -> R<i32> {
        self.stack()?;
        if self.parse.typed != 0 {
            return self.parse_typed_binding_element();
        }
        let start = self.lexer.tok_start;
        if self.lexer.tok == tk::At {
            let decorators = self.parse_decorators()?;
            let v0 = self.parse_binding_element()?;
            let element = self.with_room(v0)?;
            self.n.put(element, self.n.at(element) | F_EXT);
            self.n.put(element + 1, start);
            self.set_list(
                element,
                EXT_AT.at(self.n.at(element) & 0xff) + 1,
                decorators,
            );
            return Ok(element);
        }
        if self.lexer.tok == tk::Ellipsis {
            self.next()?;
            let argument = self.parse_binding_atom()?;
            return Ok(self.node1(k::RestElement, start, self.lexer.prev_end, argument));
        }
        let target = self.parse_binding_atom()?;
        if self.lexer.tok == tk::Eq {
            self.next()?;
            let right = self.parse_maybe_assign()?;
            return Ok(self.node2(
                k::AssignmentPattern,
                start,
                self.lexer.prev_end,
                target,
                right,
            ));
        }
        return Ok(target);
    }

    pub(crate) fn parse_binding_atom(&mut self) -> R<i32> {
        if self.lexer.tok == tk::BracketL || self.lexer.tok == tk::BraceL {
            let saved_no_in = self.parse.no_in;
            self.parse.no_in = 0;
            self.parse.object_is_binding = self.lexer.tok == tk::BraceL;
            let pattern = if self.lexer.tok == tk::BracketL {
                self.parse_array()?
            } else {
                self.parse_object()?
            };
            self.parse.no_in = saved_no_in;
            self.to_assignable(pattern)?;
            return Ok(pattern);
        }
        if self.lexer.tok == tk::Void {
            return Err(self.text_refuse());
        }
        if self.parse.typed != 0 && self.lexer.tok == tk::This {
            // the type of `this`, written as a parameter
            return self.identifier();
        }
        return self.parse_ident();
    }

    pub(crate) fn parse_function_body(&mut self, flags: i32) -> R<i32> {
        let f = self.parse.in_function;
        let a = self.parse.in_async;
        let g = self.parse.in_generator;
        let i = self.parse.no_in;
        self.parse.in_function = 1;
        self.parse.in_async = if (flags & F_ASYNC) != 0 { 1 } else { 0 };
        self.parse.in_generator = if (flags & F_GENERATOR) != 0 { 1 } else { 0 };
        self.parse.no_in = 0;
        let body = self.parse_block_like(k::BlockStatement, true)?;
        self.parse.in_function = f;
        self.parse.in_async = a;
        self.parse.in_generator = g;
        self.parse.no_in = i;
        return Ok(body);
    }

    /// The current token is `function`. `flags` can hold modifiers in the place of the sub-kind.
    pub(crate) fn parse_function(&mut self, start: i32, kind: i32, mut flags: i32) -> R<i32> {
        self.next()?;
        if self.eat(tk::Mul)? {
            flags |= F_GENERATOR;
        }
        let mut id: i32 = 0;
        if self.lexer.tok == tk::Name {
            id = self.identifier()?;
        }
        let type_parameters = if self.parse.typed != 0 && self.lexer.tok == tk::Lt {
            self.ts_parse_type_parameters()?
        } else {
            0
        };
        let a = self.parse.in_async;
        let g = self.parse.in_generator;
        self.parse.in_async = if (flags & F_ASYNC) != 0 { 1 } else { 0 };
        self.parse.in_generator = if (flags & F_GENERATOR) != 0 { 1 } else { 0 };
        let params = self.parse_params()?;
        self.parse.in_async = a;
        self.parse.in_generator = g;
        let return_type = if self.parse.typed != 0 && self.lexer.tok == tk::Colon {
            self.ts_parse_return_type()?
        } else {
            0
        };
        if self.parse.typed != 0
            && self.lexer.tok != tk::BraceL
            && kind == k::FunctionDeclaration
            && !self.mode.is_babel_flow
        {
            // an overload, or `declare function`; in Flow, a function in `declare module` or a .js.flow file
            self.semicolon()?;
            return Ok(self.function_node(
                k::TSDeclareFunction | flags,
                start,
                self.lexer.prev_end,
                id,
                0,
                params,
                0,
                type_parameters,
                return_type,
            ));
        }
        let predicate = if self.parse_flow.flow_predicate != 0 {
            self.flow_take_predicate()
        } else {
            0
        };
        let body = self.parse_function_body(flags)?;
        let n = self.function_node(
            kind | flags,
            start,
            self.lexer.prev_end,
            id,
            body,
            params,
            0,
            type_parameters,
            return_type,
        );
        if predicate != 0 {
            self.set_child(n, 10, predicate);
        }
        return Ok(n);
    }

    /// Type parameters, params and body of a method; the current token is `(` or `<`.
    pub(crate) fn parse_method_rest(
        &mut self,
        head: i32,
        start: i32,
        key: i32,
        decorators: i32,
    ) -> R<i32> {
        let type_parameters = if self.parse.typed != 0 && self.lexer.tok == tk::Lt {
            self.ts_parse_type_parameters()?
        } else {
            0
        };
        let params = self.parse_params()?;
        let return_type = if self.parse.typed != 0 && self.lexer.tok == tk::Colon {
            self.ts_parse_return_type()?
        } else {
            0
        };
        if self.parse.typed == TYPED_TS
            && self.lexer.tok != tk::BraceL
            && (head & 0xff) == k::ClassMethod
        {
            // an overload, an abstract method, a method of a `declare class`
            self.semicolon()?;
            return Ok(self.function_node(
                head,
                start,
                self.lexer.prev_end,
                key,
                0,
                params,
                decorators,
                type_parameters,
                return_type,
            ));
        }
        let predicate = if self.parse_flow.flow_predicate != 0 {
            self.flow_take_predicate()
        } else {
            0
        };
        let body = self.parse_function_body(head)?;
        let n = self.function_node(
            head,
            start,
            self.lexer.prev_end,
            key,
            body,
            params,
            decorators,
            type_parameters,
            return_type,
        );
        if predicate != 0 {
            self.set_child(n, 10, predicate);
        }
        return Ok(n);
    }

    /// The current token is `=>`.
    pub(crate) fn parse_arrow_rest(&mut self, start: i32, params: i32, flags: i32) -> R<i32> {
        return self.parse_typed_arrow_rest(start, params, flags, 0, 0);
    }

    pub(crate) fn parse_typed_arrow_rest(
        &mut self,
        start: i32,
        params: i32,
        mut flags: i32,
        type_parameters: i32,
        return_type: i32,
    ) -> R<i32> {
        let predicate = if self.parse_flow.flow_predicate != 0 {
            self.flow_take_predicate()
        } else {
            0
        };
        self.next()?;
        let saved_no_in = self.parse.no_in;
        self.parse.no_in = saved_no_in & !NO_IN_CONSEQUENT;
        let body: i32;
        if self.lexer.tok == tk::BraceL {
            body = self.parse_function_body(flags)?;
        } else {
            let f = self.parse.in_function;
            let a = self.parse.in_async;
            let g = self.parse.in_generator;
            self.parse.in_function = 1;
            self.parse.in_async = if (flags & F_ASYNC) != 0 { 1 } else { 0 };
            self.parse.in_generator = 0;
            body = self.parse_maybe_assign()?;
            self.parse.in_function = f;
            self.parse.in_async = a;
            self.parse.in_generator = g;
            flags |= F_EXPR_BODY;
        }
        self.parse.no_in = saved_no_in;
        let n = self.function_node(
            k::ArrowFunctionExpression | flags,
            start,
            self.lexer.prev_end,
            0,
            body,
            params,
            0,
            type_parameters,
            return_type,
        );
        if predicate != 0 {
            self.set_child(n, 10, predicate);
        }
        return Ok(n);
    }

    pub(crate) fn parse_decorators(&mut self) -> R<i32> {
        let mark = self.arena.ls_pos;
        while self.lexer.tok == tk::At {
            let start = self.lexer.tok_start;
            self.next()?;
            let mut expression: i32;
            if self.parse.typed == TYPED_TS {
                // any expression that can be called, but `@a [b]() {}` is a decorator before a computed key
                let expr_start = self.lexer.tok_start;
                let atom = self.parse_expr_atom()?;
                self.parse.in_decorator = 1;
                expression = self.parse_subscripts(atom, expr_start, false)?;
                self.parse.in_decorator = 0;
            } else if self.lexer.tok == tk::ParenL {
                expression = self.parse_paren_and_distinguish()?;
            } else {
                let expr_start = self.lexer.tok_start;
                expression = self.parse_ident_name()?;
                while self.lexer.tok == tk::Dot {
                    self.next()?;
                    let property = if self.lexer.tok == tk::PrivateName {
                        self.private_name()?
                    } else {
                        self.parse_ident_name()?
                    };
                    expression = self.node2(
                        k::MemberExpression,
                        expr_start,
                        self.lexer.prev_end,
                        expression,
                        property,
                    );
                }
                if self.lexer.tok == tk::ParenL {
                    let args = self.parse_arguments()?;
                    expression = self.call_node(
                        k::CallExpression,
                        expr_start,
                        self.lexer.prev_end,
                        expression,
                        args,
                        0,
                    );
                }
            }
            let v0 = self.node1(k::Decorator, start, self.lexer.prev_end, expression);
            self.list_push(v0);
        }
        return Ok(self.list_finish(mark));
    }

    pub(crate) fn private_name(&mut self) -> R<i32> {
        let n = self.node0(
            k::PrivateName | self.lexer.tok_flags,
            self.lexer.tok_start,
            self.lexer.tok_end,
        );
        self.next()?;
        return Ok(n);
    }

    /// The current token is `class`. `kind` can hold modifiers in the place of the sub-kind.
    /// `{ members }`; the current token is the `{`.
    pub(crate) fn parse_class_body(&mut self) -> R<i32> {
        let body_start = self.lexer.tok_start;
        let stays = self.parse.lexer_stays;
        self.parse.lexer_stays = false;
        if self.lexer.tok != tk::BraceL {
            return Err(self.unexpected());
        }
        self.parse.list_depth += 1;
        let mark = self.arena.ls_pos;
        let mut behind: i32 = 0;
        if self.parse.reads_ahead && self.t.at(self.lexer.tok_end) == 10 {
            let mut read = self.read_next_member_of(
                self.lexer.tok_end,
                MEMBER_OF_CLASS,
                self.parse.typed,
                self.parse.list_depth.wrapping_mul(self.options.tab_width),
            )?;
            let mut from = self.lexer.tok_end;
            if !read && self.fast.ready_start == 0 && self.parse.joins_lines {
                let end = self.read_comments(
                    from,
                    self.parse.list_depth.wrapping_mul(self.options.tab_width),
                    true,
                );
                if end != 0 {
                    self.push_standing(
                        self.fast.comments_start,
                        end,
                        self.fast.comments_last_length,
                        k::None,
                        0,
                    );
                    from = end;
                    behind = end;
                    read = self.read_next_member(from, MEMBER_OF_CLASS)?;
                }
            }
            if read {
                behind = self.read_members(self.fast.ready_start, from, MEMBER_OF_CLASS)?;
                from = 0;
            } else {
                self.parse.refused_at = self.fast.ready_start;
            }
            if from == self.lexer.tok_end {
                self.next()?;
            }
        } else {
            self.next()?;
        }
        let end: i32;
        loop {
            if behind != 0 {
                let brace = self.closing_brace_behind(behind);
                if brace != 0 {
                    end = brace + 1;
                    break;
                }
                self.catch_up(behind)?;
                behind = 0;
            }
            if self.lexer.tok == tk::BraceR {
                end = self.lexer.tok_end;
                break;
            }
            if self.lexer.tok == tk::Semi {
                return Err(self.rare(rare::SEMICOLON));
            }
            if self.lexer.tok == tk::EOF {
                return Err(self.unexpected());
            }
            if self.lexer.c_count != self.parse.comments_seen {
                self.claim_comments(true);
            }
            if self.parse.reads_ahead
                && STARTS_READY_MEMBER.at(self.lexer.tok) != 0
                && self.lexer.tok_start != self.parse.refused_at
                && self.read_member(
                    self.lexer.tok_start,
                    MEMBER_OF_CLASS,
                    self.parse.typed,
                    self.parse.list_depth.wrapping_mul(self.options.tab_width),
                )?
            {
                behind =
                    self.read_members(self.lexer.tok_start, self.lexer.prev_end, MEMBER_OF_CLASS)?;
                continue;
            }
            let v0 = if self.parse.typed != 0 {
                self.ts_parse_class_member()?
            } else {
                self.parse_class_member()?
            };
            self.list_push(v0);
        }
        let members = self.list_finish(mark);
        self.parse.list_depth -= 1;
        self.set_pos(end);
        if !stays {
            self.next()?;
        }
        return Ok(self.node_l(k::ClassBody, body_start, end, members));
    }

    pub(crate) fn parse_class(&mut self, start: i32, kind: i32, decorators: i32) -> R<i32> {
        self.next()?;
        let mut id: i32 = 0;
        if self.lexer.tok == tk::Name
            && !(self.parse.typed != 0
                && self.lexer.tok_end - self.lexer.tok_start == 10
                && self.text_is(self.lexer.tok_start, self.lexer.tok_end, b"implements"))
        {
            id = self.identifier()?;
        }
        let type_parameters = if self.parse.typed != 0 && self.lexer.tok == tk::Lt {
            self.ts_parse_type_parameters()?
        } else {
            0
        };
        let mut super_class: i32 = 0;
        let mut super_type_arguments: i32 = 0;
        let mut implemented: i32 = 0;
        if self.eat(tk::Extends)? {
            if self.parse.typed == TYPED_FLOW {
                self.parse.no_record_expression = 1;
            }
            super_class = self.parse_expr_subscripts()?;
            self.parse.no_record_expression = 0;
            if self.parse.typed != 0 {
                if (self.n.at(super_class) & (0xff | F_PAREN)) == k::InstantiationExpression {
                    super_type_arguments = self.n.at(super_class + 5);
                    super_class = self.n.at(super_class + 4);
                } else if self.lexer.tok == tk::Lt {
                    // TypeScript does not split a `<<` here
                    super_type_arguments = self.ts_parse_type_arguments()?;
                }
            }
        }
        if self.parse.typed != 0 && self.lexer.tok == tk::Name {
            implemented = if self.parse.typed == TYPED_TS {
                self.ts_parse_class_heritage()?
            } else {
                self.flow_parse_class_implements()?
            };
        }
        let body = self.parse_class_body()?;
        let n = self.class_node(
            kind,
            start,
            self.lexer.prev_end,
            id,
            super_class,
            body,
            decorators,
        );
        if self.parse.typed != 0 {
            self.set_list(n, 8, implemented);
            self.set_child(n, 9, type_parameters);
            self.set_child(n, 10, super_type_arguments);
        }
        return Ok(n);
    }

    /// After a word that may be a modifier: does the member's name still have to come?
    pub(crate) fn word_was_key(&self) -> bool {
        return self.lexer.tok == tk::ParenL
            || self.lexer.tok == tk::Eq
            || self.lexer.tok == tk::Semi
            || self.lexer.tok == tk::BraceR
            || self.lexer.tok == tk::EOF;
    }

    /// The current token is the `{` behind `static`.
    pub(crate) fn parse_static_block(&mut self, start: i32) -> R<i32> {
        let block = self.parse_block_like(k::StaticBlock, false)?;
        self.n.put(block + 1, start);
        return Ok(block);
    }

    /// Is this key, which is not computed, the word or the string "constructor"?
    pub(crate) fn is_constructor_key(&self, key: i32) -> bool {
        let k = self.n.at(key) & 0xff;
        if k == k::Identifier {
            return self.text_is(self.n.at(key + 1), self.n.at(key + 2), b"constructor");
        }
        return k == k::StringLiteral
            && self.text_is(
                self.n.at(key + 1) + 1,
                self.n.at(key + 2) - 1,
                b"constructor",
            );
    }

    /// ` = value` of a class property, or nothing.
    pub(crate) fn parse_class_property_value(&mut self) -> R<i32> {
        if !self.eat(tk::Eq)? {
            return Ok(0);
        }
        let f = self.parse.in_function;
        let a = self.parse.in_async;
        let g = self.parse.in_generator;
        self.parse.in_function = 1;
        self.parse.in_generator = 0;
        self.parse.in_async = 0;
        let value = self.parse_maybe_assign()?;
        self.parse.in_function = f;
        self.parse.in_async = a;
        self.parse.in_generator = g;
        return Ok(value);
    }

    pub(crate) fn parse_class_member(&mut self) -> R<i32> {
        let start = self.lexer.tok_start;
        let decorators = if self.lexer.tok == tk::At {
            self.parse_decorators()?
        } else {
            0
        };
        let mut flags: i32 = 0;
        let mut method = M_METHOD;
        let mut key: i32 = 0;
        if self.is_kw(kw::Static) {
            let word = self.identifier()?;
            if self.word_was_key() {
                key = word;
            } else if self.lexer.tok == tk::BraceL {
                let f = self.parse.in_function;
                let a = self.parse.in_async;
                let g = self.parse.in_generator;
                self.parse.in_function = 1;
                self.parse.in_generator = 0;
                self.parse.in_async = 0;
                let block = self.parse_static_block(start)?;
                self.parse.in_function = f;
                self.parse.in_async = a;
                self.parse.in_generator = g;
                return Ok(block);
            } else {
                flags |= F_STATIC;
            }
        }
        if key == 0 && self.is_kw(kw::Accessor) {
            let word = self.identifier()?;
            if self.word_was_key() || self.lexer.tok_nl != 0 {
                key = word;
            } else {
                flags |= F_ACCESSOR;
            }
        }
        if key == 0 && self.is_kw(kw::Async) {
            let word = self.identifier()?;
            if self.word_was_key() || self.lexer.tok_nl != 0 {
                key = word;
            } else {
                flags |= F_ASYNC;
            }
        }
        if key == 0 && self.lexer.tok == tk::Mul {
            self.next()?;
            flags |= F_GENERATOR;
        }
        if key == 0
            && (flags & (F_ASYNC | F_GENERATOR | F_ACCESSOR)) == 0
            && self.lexer.tok == tk::Name
            && (self.lexer.tok_kw == kw::Get || self.lexer.tok_kw == kw::Set)
        {
            let kw = self.lexer.tok_kw;
            let word = self.identifier()?;
            if self.word_was_key() {
                key = word;
            } else {
                method = if kw == kw::Get { M_GET } else { M_SET };
            }
        }
        if key == 0 {
            if self.lexer.tok == tk::BracketL {
                flags |= F_COMPUTED;
            }
            key = self.parse_property_name()?;
        }
        if self.lexer.tok == tk::ParenL {
            if method == M_METHOD
                && (flags & (F_STATIC | F_COMPUTED)) == 0
                && self.is_constructor_key(key)
            {
                method = M_CONSTRUCTOR;
            }
            return self.parse_method_rest(
                k::ClassMethod | flags | (method << SUB_SHIFT),
                start,
                key,
                decorators,
            );
        }
        // `*`, `async`, `get` and `set` announce a method
        if (flags & (F_GENERATOR | F_ASYNC)) != 0 || method != M_METHOD {
            return Err(self.unexpected());
        }
        let value = self.parse_class_property_value()?;
        self.semicolon()?;
        return Ok(self.class_property_node(
            k::ClassProperty | flags,
            start,
            self.lexer.prev_end,
            key,
            value,
            decorators,
            0,
            0,
        ));
    }

    /// A key of an object or class member. The caller sets F_COMPUTED when it sees `[`.
    pub(crate) fn parse_property_name(&mut self) -> R<i32> {
        match self.lexer.tok {
            tk::String => {
                let n = self.node0(
                    k::StringLiteral | self.lexer.tok_flags,
                    self.lexer.tok_start,
                    self.lexer.tok_end,
                );
                self.next()?;
                return Ok(n);
            }
            tk::Num => {
                let n = self.node0(k::NumericLiteral, self.lexer.tok_start, self.lexer.tok_end);
                self.next()?;
                return Ok(n);
            }
            tk::BigInt => {
                let n = self.node0(k::BigIntLiteral, self.lexer.tok_start, self.lexer.tok_end);
                self.next()?;
                return Ok(n);
            }
            tk::BracketL => {
                self.next()?;
                let saved_no_in = self.parse.no_in;
                self.parse.no_in = 0;
                let n = self.parse_maybe_assign()?;
                self.parse.no_in = saved_no_in;
                self.expect(tk::BracketR)?;
                return Ok(n);
            }
            tk::PrivateName => {
                return self.private_name();
            }
            _ => {}
        }
        return self.parse_ident_name();
    }

    // ------------------------------------------------------------------------------------------------------ expressions
    pub(crate) fn parse_expression(&mut self) -> R<i32> {
        let start = self.lexer.tok_start;
        let first = self.parse_maybe_assign()?;
        if self.lexer.tok != tk::Comma {
            return Ok(first);
        }
        let mark = self.arena.ls_pos;
        self.list_push(first);
        while self.eat(tk::Comma)? {
            let v0 = self.parse_maybe_assign()?;
            self.list_push(v0);
        }
        let v1 = self.lexer.prev_end;
        let v2 = self.list_finish(mark);
        return Ok(self.node_l(k::SequenceExpression, start, v1, v2));
    }

    pub(crate) fn is_bare_arrow(&self, n: i32) -> bool {
        return (self.n.at(n) & (0xff | F_PAREN)) == k::ArrowFunctionExpression;
    }

    pub(crate) fn starts_expression(&self) -> bool {
        match self.lexer.tok {
            tk::ParenR
            | tk::BracketR
            | tk::BraceR
            | tk::Comma
            | tk::Semi
            | tk::Colon
            | tk::EOF
            | tk::In => {
                return false;
            }
            _ => {}
        }
        return !self.is_kw(kw::Of);
    }

    /// `?` and `: type` behind what may be a parameter of an arrow function.
    pub(crate) fn parse_paren_item_suffix(&mut self, left: i32) -> R<i32> {
        if self.parse.typed == TYPED_FLOW {
            if self.lexer.tok == tk::Question {
                self.n.put(left, self.n.at(left) | F_OPTIONAL);
                self.next()?;
                self.n.put(left + 2, self.lexer.prev_end);
                self.parse.saw_typed_item = 1;
            }
            if self.lexer.tok != tk::Colon {
                return Ok(left);
            }
            // `(a: T)`: a cast, or a parameter of an arrow function, see to_assignable_parameter()
            let annotation = self.ts_parse_type_annotation()?;
            return Ok(self.node2(
                k::TypeCastExpression,
                self.n.at(left + 1),
                self.lexer.prev_end,
                left,
                annotation,
            ));
        }
        let k = self.n.at(left) & (0xff | F_PAREN);
        if k != k::Identifier && k != k::ObjectExpression && k != k::ArrayExpression {
            return Err(self.unexpected());
        }
        self.parse_binding_suffix(left)?;
        self.parse.saw_typed_item = 1;
        return Ok(left);
    }

    pub(crate) fn parse_maybe_assign(&mut self) -> R<i32> {
        self.stack()?;
        let start = self.lexer.tok_start;
        let mut is_paren_item: i32 = 0;
        if self.parse.typed != 0 {
            is_paren_item = self.parse.paren_item;
            self.parse.paren_item = 0;
        }
        if self.parse.in_generator != 0 && self.is_kw(kw::Yield) {
            self.next()?;
            let mut flags: i32 = 0;
            let mut argument: i32 = 0;
            if self.lexer.tok_nl == 0 {
                if self.eat(tk::Mul)? {
                    flags = F_DELEGATE;
                    argument = self.parse_maybe_assign()?;
                } else if self.starts_expression() {
                    argument = self.parse_maybe_assign()?;
                }
            }
            return Ok(self.node1(
                k::YieldExpression | flags,
                start,
                self.lexer.prev_end,
                argument,
            ));
        }
        let mut left = self.parse_maybe_conditional()?;
        if is_paren_item != 0 && (self.lexer.tok == tk::Colon || self.lexer.tok == tk::Question) {
            left = self.parse_paren_item_suffix(left)?;
        }
        if self.lexer.tok >= tk::Eq && self.lexer.tok <= tk::NullishEq {
            let op = self.lexer.tok;
            let lk = self.n.at(left) & 0xff;
            if lk != k::Identifier && lk != k::MemberExpression {
                if op == tk::Eq {
                    self.to_assignable(left)?;
                }
                if self.parse.typed == TYPED_TS {
                    self.check_target_of_type_script(left)?;
                } else {
                    self.check_target(left, op == tk::Eq)?;
                }
            }
            self.next()?;
            let right = self.parse_maybe_assign()?;
            return Ok(self.node2(
                k::AssignmentExpression | (op << SUB_SHIFT),
                start,
                self.lexer.prev_end,
                left,
                right,
            ));
        }
        return Ok(left);
    }

    pub(crate) fn parse_maybe_conditional(&mut self) -> R<i32> {
        let start = self.lexer.tok_start;
        let v0 = self.parse_maybe_unary()?;
        let test = self.parse_expr_op(v0, start, 0)?;
        if self.lexer.tok != tk::Question || self.is_bare_arrow(test) {
            return Ok(test);
        }
        if self.parse.typed != 0 {
            // `(a?: T) => ..`, `(a?, b) => ..`: the mark of an optional parameter
            self.save();
            self.next()?;
            let is_optional_mark = self.lexer.tok == tk::Colon
                || self.lexer.tok == tk::Comma
                || self.lexer.tok == tk::ParenR
                || self.lexer.tok == tk::Eq;
            self.restore();
            if is_optional_mark {
                return Ok(test);
            }
        }
        self.next()?;
        let saved_no_in = self.parse.no_in;
        self.parse.no_in = NO_IN_CONSEQUENT;
        if self.mode.is_babel_flow {
            self.parse.consequent_start = self.lexer.tok_start;
        }
        let consequent = self.parse_maybe_assign()?;
        self.parse.no_in = saved_no_in;
        self.expect(tk::Colon)?;
        let alternate = self.parse_maybe_assign()?;
        return Ok(self.node3(
            k::ConditionalExpression,
            start,
            self.lexer.prev_end,
            test,
            consequent,
            alternate,
        ));
    }

    pub(crate) fn make_logical(
        &mut self,
        op: i32,
        start: i32,
        end: i32,
        left: i32,
        right: i32,
    ) -> R<i32> {
        self.stack()?;
        // Prettier turns `a || (b || c)` into `(a || b) || c`
        let r = self.n.at(right);
        if (r & 0xff) == k::LogicalExpression && ((r as u32) >> SUB_SHIFT) as i32 == op {
            let inner = self.make_logical(
                op,
                self.n.at(left + 1),
                self.n.at(self.n.at(right + 4) + 2),
                left,
                self.n.at(right + 4),
            )?;
            return self.make_logical(op, start, end, inner, self.n.at(right + 5));
        }
        return Ok(self.node2(
            k::LogicalExpression | (op << SUB_SHIFT),
            start,
            end,
            left,
            right,
        ));
    }

    pub(crate) fn parse_expr_op(
        &mut self,
        mut left: i32,
        left_start: i32,
        min_prec: i32,
    ) -> R<i32> {
        self.stack()?;
        loop {
            let op = self.lexer.tok;
            let prec = PREC.at(op);
            if prec <= min_prec
                || (op == tk::In && (self.parse.no_in & 1) != 0)
                || self.is_bare_arrow(left)
            {
                if self.parse.typed != 0
                    && op == tk::Name
                    && min_prec < 8
                    && self.lexer.tok_nl == 0
                    && !self.is_bare_arrow(left)
                    && self.ts_is_as_or_satisfies()
                {
                    left = self.ts_parse_as_or_satisfies(left, left_start)?;
                    continue;
                }
                return Ok(left);
            }
            self.next()?;
            let right_start = self.lexer.tok_start;
            if op == tk::Pipeline {
                return Err(self.text_refuse());
            }
            let v0 = self.parse_maybe_unary()?;
            let right =
                self.parse_expr_op(v0, right_start, if op == tk::Pow { prec - 1 } else { prec })?;
            if op == tk::LOr || op == tk::LAnd || op == tk::Nullish {
                left = self.make_logical(op, left_start, self.lexer.prev_end, left, right)?;
            } else {
                left = self.node2(
                    k::BinaryExpression | (op << SUB_SHIFT),
                    left_start,
                    self.lexer.prev_end,
                    left,
                    right,
                );
            }
        }
    }

    /// TypeScript takes `await x` for what it looks like wherever a word or a literal follows on the same line.
    pub(crate) fn is_operand_of_await_in_type_script(&mut self) -> R<bool> {
        self.save();
        self.next()?;
        let result = self.lexer.tok_nl == 0
            && (self.is_word()
                || self.lexer.tok == tk::Num
                || self.lexer.tok == tk::BigInt
                || self.lexer.tok == tk::String);
        self.restore();
        return Ok(result);
    }

    pub(crate) fn parse_maybe_unary(&mut self) -> R<i32> {
        self.stack()?;
        let start = self.lexer.tok_start;
        match self.lexer.tok {
            tk::Not
            | tk::Tilde
            | tk::Add
            | tk::Sub
            | tk::Typeof
            | tk::Void
            | tk::Delete
            | tk::Throw => {
                {
                    let op = self.lexer.tok;
                    if op == tk::Throw {
                        return Err(self.text_refuse());
                    }
                    self.next()?;
                    // `void` where a binding can stand
                    if op == tk::Void
                        && (self.lexer.tok == tk::Comma
                            || self.lexer.tok == tk::ParenR
                            || self.lexer.tok == tk::BracketR
                            || self.lexer.tok == tk::BraceR
                            || self.lexer.tok == tk::Eq
                            || self.lexer.tok == tk::In
                            || self.is_kw(kw::Of))
                    {
                        return Err(self.text_refuse());
                    }
                    let argument = self.parse_maybe_unary()?;
                    return Ok(self.node1(
                        k::UnaryExpression | (op << SUB_SHIFT),
                        start,
                        self.lexer.prev_end,
                        argument,
                    ));
                }
            }
            tk::Inc | tk::Dec => {
                let op = self.lexer.tok;
                self.next()?;
                let argument = self.parse_maybe_unary()?;
                self.check_target(argument, false)?;
                return Ok(self.node1(
                    k::UpdateExpression | F_PREFIX | (op << SUB_SHIFT),
                    start,
                    self.lexer.prev_end,
                    argument,
                ));
            }
            tk::Name => {
                if self.lexer.tok_kw == kw::Await
                    && (self.parse.in_async != 0
                        || (self.parse.in_function == 0
                            && !self.parse.is_common_js
                            && (self.parse.typed != TYPED_FLOW || self.mode.is_babel_flow))
                        || (self.parse.typed == TYPED_TS
                            && self.is_operand_of_await_in_type_script()?))
                {
                    self.save();
                    self.next()?;
                    // `await` alone, or before something that cannot start an operand, is a name
                    let is_operand = self.starts_expression()
                        && self.lexer.tok != tk::Eq
                        && self.lexer.tok != tk::Dot
                        && self.lexer.tok != tk::Arrow
                        && !(PREC.at(self.lexer.tok) != 0
                            && self.lexer.tok != tk::Add
                            && self.lexer.tok != tk::Sub
                            && self.lexer.tok != tk::Div
                            && self.lexer.tok != tk::Lt)
                        && self.lexer.tok != tk::Question
                        && self.lexer.tok != tk::QuestionDot
                        && !(self.lexer.tok >= tk::Eq && self.lexer.tok <= tk::NullishEq);
                    if is_operand || self.parse.in_async != 0 {
                        let argument = self.parse_maybe_unary()?;
                        return Ok(self.node1(
                            k::AwaitExpression,
                            start,
                            self.lexer.prev_end,
                            argument,
                        ));
                    }
                    self.restore();
                }
            }
            _ => {}
        }
        let expression = self.parse_expr_subscripts()?;
        if (self.lexer.tok == tk::Inc || self.lexer.tok == tk::Dec)
            && self.lexer.tok_nl == 0
            && !self.is_bare_arrow(expression)
        {
            let op = self.lexer.tok;
            self.next()?;
            self.check_target(expression, false)?;
            return Ok(self.node1(
                k::UpdateExpression | (op << SUB_SHIFT),
                start,
                self.lexer.prev_end,
                expression,
            ));
        }
        return Ok(expression);
    }

    pub(crate) fn parse_expr_subscripts(&mut self) -> R<i32> {
        let start = self.lexer.tok_start;
        let atom = self.parse_expr_atom()?;
        if self.is_bare_arrow(atom) {
            return Ok(atom);
        }
        return self.parse_subscripts(atom, start, false);
    }

    pub(crate) fn parse_arguments(&mut self) -> R<i32> {
        self.expect(tk::ParenL)?;
        let saved_no_in = self.parse.no_in;
        self.parse.no_in = 0;
        let saved_depth = self.parse.list_depth;
        self.parse.list_depth = saved_depth + self.lexer.tok_nl;
        let mut may_be_parameters: i32 = 0;
        let mut saved_typed_item: i32 = 0;
        if self.parse.typed != 0 {
            may_be_parameters = self.parse.arguments_may_be_parameters;
            saved_typed_item = self.parse.saw_typed_item;
            self.parse.arguments_may_be_parameters = 0;
        }
        let mark = self.arena.ls_pos;
        while self.lexer.tok != tk::ParenR {
            if may_be_parameters != 0 {
                self.parse.paren_item = 1;
            }
            if self.lexer.tok == tk::Ellipsis {
                let start = self.lexer.tok_start;
                self.next()?;
                self.parse.paren_item = 0;
                let argument = self.parse_maybe_assign()?;
                if self.parse.typed == 0 {
                    let v0 = self.node1(k::SpreadElement, start, self.lexer.prev_end, argument);
                    self.list_push(v0);
                } else {
                    let spread = self.node1_with_room(
                        k::SpreadElement,
                        start,
                        self.lexer.prev_end,
                        argument,
                    );
                    if may_be_parameters != 0 && self.lexer.tok == tk::Colon {
                        self.parse_binding_suffix(spread)?;
                        self.parse.saw_typed_item = 1;
                    }
                    self.list_push(spread);
                }
            } else if self.lexer.tok == tk::Question {
                // f(?, x)
                self.save();
                self.next()?;
                if self.lexer.tok == tk::Comma || self.lexer.tok == tk::ParenR {
                    return Err(self.text_refuse());
                }
                self.restore();
                let v1 = self.parse_maybe_assign()?;
                self.list_push(v1);
            } else {
                let v2 = self.parse_maybe_assign()?;
                self.list_push(v2);
            }
            if self.lexer.tok != tk::ParenR {
                self.expect(tk::Comma)?;
            }
        }
        if self.parse.typed != 0 {
            self.parse.paren_item = 0;
            self.parse.saw_typed_item = saved_typed_item;
        }
        self.parse.list_depth = saved_depth;
        self.next()?;
        self.parse.no_in = saved_no_in;
        return Ok(self.list_finish(mark));
    }

    /// `: type =>` behind the parameters of an arrow function, tried: returns the function, or 0 with the lexer where it was.
    /// The current token is the `:`.
    pub(crate) fn try_parse_arrow_with_return_type(
        &mut self,
        start: i32,
        list_mark: i32,
        flags: i32,
    ) -> R<i32> {
        let m = self.mark();
        let context = self.save_context();
        let depth = self.parse.speculating;
        let list_top = self.arena.ls_pos;
        self.parse.speculating = depth + 1;
        let mut result: i32 = 0;
        let v0 = (|| -> R<Option<i32>> {
            let return_type = self.ts_parse_arrow_return_type()?;
            if self.lexer.tok != tk::Arrow || self.lexer.tok_nl != 0 {
                return Err(self.unexpected());
            }
            // the parameters stay on the stack in case this fails
            let mut i = list_mark;
            while i < list_top {
                self.list_push(self.arena.ls.at(i));
                i += 1;
            }
            let params = self.list_finish(list_top);
            self.parse.speculating = if (context & (NO_IN_CONSEQUENT << 4)) != 0 {
                depth + 1
            } else {
                depth
            };
            result = self.parse_typed_arrow_rest(start, params, flags, 0, return_type)?;
            // `a ? (b) : c => d`: the colon belongs to the conditional expression unless another one follows
            if (context & (NO_IN_CONSEQUENT << 4)) != 0 && self.lexer.tok != tk::Colon {
                return Err(self.unexpected());
            }
            Ok(None)
        })();
        let v0 = match v0 {
            Err(Stop) => (|| -> R<Option<i32>> {
                if !(self.why.get() == why::SYNTAX)
                    || (self.parse.speculating == depth && depth == 0)
                {
                    return Err(Stop);
                }
                result = 0;
                Ok(None)
            })(),
            ok => ok,
        };
        if let Some(v) = v0? {
            return Ok(v);
        }
        self.parse.speculating = depth;
        if result == 0 {
            self.rewind(m);
            self.restore_context(context);
            self.list_truncate(list_top);
            return Ok(0);
        }
        self.unmark(m);
        let params = self.n.at(result + 6);
        let mut i: i32 = 1;
        while i <= self.n.at(params) {
            let parameter = self.to_assignable_parameter(self.n.at(params + i))?;
            self.n.put(params + i, parameter);
            self.n.put(parameter + 3, result);
            i += 1;
        }
        self.list_truncate(list_mark);
        return Ok(result);
    }

    pub(crate) fn parse_subscripts(&mut self, mut base: i32, start: i32, no_calls: bool) -> R<i32> {
        let mut chain: i32 = 0;
        let mut is_decorator: i32 = 0;
        let mut is_record_constructor: i32 = 1;
        if (self.parse.in_decorator | self.parse.no_record_expression) != 0 {
            is_decorator = self.parse.in_decorator;
            is_record_constructor = 1 - self.parse.no_record_expression;
            self.parse.no_record_expression = 0;
            self.parse.in_decorator = 0;
        }
        loop {
            match self.lexer.tok {
                tk::Dot => {
                    self.next()?;
                    let property = if self.lexer.tok == tk::PrivateName {
                        self.private_name()?
                    } else {
                        self.parse_ident_name()?
                    };
                    base = self.node2(
                        k::MemberExpression | chain,
                        start,
                        self.lexer.prev_end,
                        base,
                        property,
                    );
                    continue;
                }
                tk::QuestionDot => {
                    if no_calls {
                        return Ok(base);
                    }
                    chain = F_CHAIN;
                    self.next()?;
                    if self.lexer.tok == tk::ParenL {
                        let args = self.parse_arguments()?;
                        base = self.call_node(
                            k::CallExpression | F_CHAIN | F_OPTIONAL,
                            start,
                            self.lexer.prev_end,
                            base,
                            args,
                            0,
                        );
                    } else if self.parse.typed != 0
                        && (self.lexer.tok == tk::Lt || self.lexer.tok == tk::Shl)
                    {
                        let type_arguments = self.ts_parse_type_arguments()?;
                        let args = self.parse_arguments()?;
                        base = self.call_node(
                            k::CallExpression | F_CHAIN | F_OPTIONAL,
                            start,
                            self.lexer.prev_end,
                            base,
                            args,
                            type_arguments,
                        );
                    } else if self.lexer.tok == tk::BracketL {
                        self.next()?;
                        let saved_no_in = self.parse.no_in;
                        self.parse.no_in = 0;
                        let property = self.parse_expression()?;
                        self.parse.no_in = saved_no_in;
                        self.expect(tk::BracketR)?;
                        base = self.node2(
                            k::MemberExpression | F_CHAIN | F_OPTIONAL | F_COMPUTED,
                            start,
                            self.lexer.prev_end,
                            base,
                            property,
                        );
                    } else {
                        let property = if self.lexer.tok == tk::PrivateName {
                            self.private_name()?
                        } else {
                            self.parse_ident_name()?
                        };
                        base = self.node2(
                            k::MemberExpression | F_CHAIN | F_OPTIONAL,
                            start,
                            self.lexer.prev_end,
                            base,
                            property,
                        );
                    }
                    continue;
                }
                tk::BracketL => {
                    if is_decorator != 0 {
                        return Ok(base);
                    }
                    self.next()?;
                    let saved_no_in = self.parse.no_in;
                    self.parse.no_in = 0;
                    let property = self.parse_expression()?;
                    self.parse.no_in = saved_no_in;
                    self.expect(tk::BracketR)?;
                    base = self.node2(
                        k::MemberExpression | F_COMPUTED | chain,
                        start,
                        self.lexer.prev_end,
                        base,
                        property,
                    );
                    continue;
                }
                tk::ParenL => {
                    if no_calls {
                        return Ok(base);
                    }
                    let maybe_async = (self.n.at(base) & (0xff | F_PAREN)) == k::Identifier
                        && self.n.at(base + 2) - self.n.at(base + 1) == 5
                        && self.lexer.tok_nl == 0
                        && self.text_is(self.n.at(base + 1), self.n.at(base + 2), b"async");
                    if maybe_async && self.parse.typed != 0 {
                        self.parse.arguments_may_be_parameters = 1;
                    }
                    let args = self.parse_arguments()?;
                    if maybe_async && self.lexer.tok == tk::Arrow && self.lexer.tok_nl == 0 {
                        let count = self.n.at(args);
                        let mut i: i32 = 1;
                        while i <= count {
                            let v0 = args + i;
                            let v1 = self.to_assignable_parameter(self.n.at(args + i))?;
                            self.n.put(v0, v1);
                            i += 1;
                        }
                        return self.parse_arrow_rest(start, args, F_ASYNC);
                    }
                    if maybe_async && self.parse.typed != 0 && self.lexer.tok == tk::Colon {
                        let list_mark = self.arena.ls_pos;
                        let mut i: i32 = 1;
                        while i <= self.n.at(args) {
                            self.list_push(self.n.at(args + i));
                            i += 1;
                        }
                        let arrow =
                            self.try_parse_arrow_with_return_type(start, list_mark, F_ASYNC)?;
                        if arrow != 0 {
                            return Ok(arrow);
                        }
                        self.list_truncate(list_mark);
                    }
                    base = self.call_node(
                        k::CallExpression | chain,
                        start,
                        self.lexer.prev_end,
                        base,
                        args,
                        0,
                    );
                    continue;
                }
                tk::BackQuote => {
                    let quasi = self.parse_template(false)?;
                    base = self.node3(
                        k::TaggedTemplateExpression,
                        start,
                        self.lexer.prev_end,
                        base,
                        quasi,
                        0,
                    );
                    continue;
                }
                tk::Not => {
                    if !self.mode.allows_non_null || self.lexer.tok_nl != 0 {
                        return Ok(base);
                    }
                    self.next()?;
                    base = self.node1(
                        k::NonNullExpression | chain,
                        start,
                        self.lexer.prev_end,
                        base,
                    );
                    continue;
                }
                tk::Lt | tk::Shl => {
                    if self.parse.typed == 0 {
                        return Ok(base);
                    }
                    let type_arguments = self.ts_try_parse_type_arguments_in_expression()?;
                    if type_arguments == 0 {
                        return Ok(base);
                    }
                    if self.lexer.tok == tk::ParenL && !no_calls {
                        let args = self.parse_arguments()?;
                        base = self.call_node(
                            k::CallExpression | chain,
                            start,
                            self.lexer.prev_end,
                            base,
                            args,
                            type_arguments,
                        );
                    } else if self.lexer.tok == tk::BackQuote {
                        let quasi = self.parse_template(false)?;
                        base = self.node3(
                            k::TaggedTemplateExpression,
                            start,
                            self.lexer.prev_end,
                            base,
                            quasi,
                            type_arguments,
                        );
                    } else if self.lexer.tok == tk::BraceL
                        && self.parse.typed == TYPED_FLOW
                        && is_record_constructor != 0
                    {
                        return self.flow_parse_record_expression(start, base, type_arguments);
                    } else {
                        base = self.node2(
                            k::InstantiationExpression,
                            start,
                            self.lexer.prev_end,
                            base,
                            type_arguments,
                        );
                    }
                    continue;
                }
                tk::BraceL => {
                    {
                        // R {a: 1}
                        if self.parse.typed != TYPED_FLOW
                            || self.lexer.tok_nl != 0
                            || is_record_constructor == 0
                            || chain != 0
                        {
                            return Ok(base);
                        }
                        let k = self.n.at(base) & (0xff | F_PAREN);
                        if k != k::Identifier && k != k::MemberExpression {
                            return Ok(base);
                        }
                        return self.flow_parse_record_expression(start, base, 0);
                    }
                }
                tk::DoubleColon => {
                    if no_calls {
                        return Ok(base);
                    }
                    return Err(self.text_refuse());
                }
                _ => {}
            }
            return Ok(base);
        }
    }

    pub(crate) fn leaf(&mut self, kind: i32) -> R<i32> {
        let n = self.node0(
            kind | self.lexer.tok_flags,
            self.lexer.tok_start,
            self.lexer.tok_end,
        );
        self.next()?;
        return Ok(n);
    }

    pub(crate) fn parse_expr_atom(&mut self) -> R<i32> {
        self.stack()?;
        let start = self.lexer.tok_start;
        match self.lexer.tok {
            tk::Name => {
                {
                    if self.parse.typed == TYPED_FLOW
                        && self.lexer.tok_end - self.lexer.tok_start == 5
                        && self.text_is(self.lexer.tok_start, self.lexer.tok_end, b"match")
                    {
                        let match_ = self.flow_try_parse_match(false)?;
                        if match_ != 0 {
                            return Ok(match_);
                        }
                    }
                    if self.lexer.tok_kw == kw::Async {
                        self.save();
                        self.next()?;
                        if self.lexer.tok_nl == 0 {
                            if self.lexer.tok == tk::Function {
                                return self.parse_function(start, k::FunctionExpression, F_ASYNC);
                            }
                            if self.lexer.tok == tk::Lt && self.parse.typed != 0 {
                                // async <T>(x: T) => y
                                let arrow = self.ts_parse_less_than_expression(start, F_ASYNC)?;
                                if arrow != 0 {
                                    return Ok(arrow);
                                }
                            } else if self.lexer.tok == tk::Name {
                                // async x => y
                                let param = self.identifier()?;
                                if self.lexer.tok == tk::Arrow {
                                    let mark = self.arena.ls_pos;
                                    self.list_push(param);
                                    let v0 = self.list_finish(mark);
                                    return self.parse_arrow_rest(start, v0, F_ASYNC);
                                }
                            } else if self.lexer.tok == tk::Do {
                                return Err(self.text_refuse());
                            }
                        }
                        self.restore();
                    } else if self.lexer.tok_kw == kw::Module {
                        self.save();
                        self.next()?;
                        if self.lexer.tok == tk::BraceL && self.lexer.tok_nl == 0 {
                            return Err(self.text_refuse());
                        }
                        self.restore();
                    }
                    let id = self.identifier()?;
                    if self.lexer.tok == tk::Arrow && self.lexer.tok_nl == 0 {
                        let mark = self.arena.ls_pos;
                        self.list_push(id);
                        let v1 = self.list_finish(mark);
                        return self.parse_arrow_rest(start, v1, 0);
                    }
                    return Ok(id);
                }
            }
            tk::Num => {
                return self.leaf(k::NumericLiteral);
            }
            tk::String => {
                return self.leaf(k::StringLiteral);
            }
            tk::BigInt => {
                return self.leaf(k::BigIntLiteral);
            }
            tk::ParenL => {
                return self.parse_paren_and_distinguish();
            }
            tk::BracketL => {
                return self.parse_array();
            }
            tk::BraceL => {
                return self.parse_object();
            }
            tk::This => {
                return self.leaf(k::ThisExpression);
            }
            tk::Null => {
                return self.leaf(k::NullLiteral);
            }
            tk::True | tk::False => {
                return self.leaf(k::BooleanLiteral);
            }
            tk::Function => {
                if self.t.at(self.lexer.tok_end) == 46
                    && self.text_is(self.lexer.tok_end + 1, self.lexer.tok_end + 5, b"sent")
                {
                    // function.sent
                    let meta = self.leaf(k::Identifier)?;
                    self.next()?;
                    let property = self.parse_ident_name()?;
                    return Ok(self.node2(
                        k::MetaProperty,
                        start,
                        self.lexer.prev_end,
                        meta,
                        property,
                    ));
                }
                return self.parse_function(start, k::FunctionExpression, 0);
            }
            tk::Class => {
                return self.parse_class(start, k::ClassExpression, 0);
            }
            tk::At => {
                let decorators = self.parse_decorators()?;
                if self.lexer.tok != tk::Class {
                    return Err(self.unexpected());
                }
                return self.parse_class(start, k::ClassExpression, decorators);
            }
            tk::New => {
                return self.parse_new();
            }
            tk::BackQuote => {
                return self.parse_template(false);
            }
            tk::Div | tk::DivEq => {
                self.rescan_regex()?;
                return self.leaf(k::RegExpLiteral);
            }
            tk::Super => {
                return self.leaf(k::Super);
            }
            tk::Import => {
                return self.parse_import_expression();
            }
            tk::Lt => {
                {
                    if self.parse.typed != 0 {
                        // <T>(x: T) => y, <T>x
                        let expression = self.ts_parse_less_than_expression(start, 0)?;
                        if expression != 0 {
                            return Ok(expression);
                        }
                    }
                    let element = self.parse_jsx_element(JSX_ELSEWHERE)?;
                    self.next()?;
                    return Ok(element);
                }
            }
            tk::PrivateName => {
                return self.private_name();
            }
            tk::Do | tk::DoubleColon | tk::Mod => {
                return Err(self.text_refuse());
            }
            _ => {}
        }
        return Err(self.unexpected());
    }

    pub(crate) fn is_type_cast_comment(&self, index: i32) -> bool {
        let at = index * C_STRIDE;
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
                let is_word_char = (after >= 48 && after <= 57)
                    || (after >= 65 && after <= 90)
                    || (after >= 97 && after <= 122)
                    || after == 95;
                if !is_word_char {
                    return true;
                }
            }
            p += 1;
        }
        return false;
    }

    pub(crate) fn parse_paren_and_distinguish(&mut self) -> R<i32> {
        let start = self.lexer.tok_start;
        let keep_parens = (self.parse.typed == 0 || self.mode.is_babel_flow)
            && self.lexer.c_count > self.lexer.c_base
            && self.lexer.c.at((self.lexer.c_count - 1) * C_STRIDE + C_END) > self.lexer.prev_end
            && self.lexer.c.at((self.lexer.c_count - 1) * C_STRIDE + C_END) <= start
            && self.is_type_cast_comment(self.lexer.c_count - 1);
        self.next()?;
        let saved_no_in = self.parse.no_in;
        let saved_typed_item = self.parse.saw_typed_item;
        self.parse.no_in = 0;
        self.parse.saw_typed_item = 0;
        let mark = self.arena.ls_pos;
        let inner_start = self.lexer.tok_start;
        let mut saw_rest = false;
        let mut trailing_comma = false;
        while self.lexer.tok != tk::ParenR {
            trailing_comma = false;
            if self.lexer.tok == tk::Ellipsis {
                let rest_start = self.lexer.tok_start;
                self.next()?;
                let argument = self.parse_binding_atom()?;
                if self.parse.typed == 0 {
                    let v0 = self.node1(k::RestElement, rest_start, self.lexer.prev_end, argument);
                    self.list_push(v0);
                } else {
                    let rest = self.node1_with_room(
                        k::RestElement,
                        rest_start,
                        self.lexer.prev_end,
                        argument,
                    );
                    self.parse_binding_suffix(rest)?;
                    self.list_push(rest);
                }
                saw_rest = true;
            } else if self.parse.typed != 0 {
                if self.lexer.tok == tk::This && self.parse.typed == TYPED_TS {
                    // (this: T) => ..
                    self.save();
                    self.next()?;
                    let is_parameter = self.lexer.tok == tk::Colon;
                    self.restore();
                    if is_parameter {
                        let parameter = self.identifier()?;
                        self.parse_binding_suffix(parameter)?;
                        self.parse.saw_typed_item = 1;
                        self.list_push(parameter);
                        if self.lexer.tok != tk::ParenR {
                            self.expect(tk::Comma)?;
                        }
                        continue;
                    }
                }
                self.parse.paren_item = 1;
                let v1 = self.parse_maybe_assign()?;
                self.list_push(v1);
                self.parse.paren_item = 0;
            } else {
                let v2 = self.parse_maybe_assign()?;
                self.list_push(v2);
            }
            if self.lexer.tok != tk::ParenR {
                self.expect(tk::Comma)?;
                trailing_comma = true;
            }
        }
        let inner_end = self.lexer.prev_end;
        self.next()?;
        self.parse.no_in = saved_no_in;
        let typed_item = self.parse.saw_typed_item;
        self.parse.saw_typed_item = saved_typed_item;
        if self.lexer.tok == tk::Arrow && self.lexer.tok_nl == 0 {
            // Babel forgets to turn the casts into parameters if the function is the first thing behind a `?` and has a block for its body
            let mut keeps_casts = false;
            if self.mode.is_babel_flow && start == self.parse.consequent_start {
                self.save();
                self.next()?;
                keeps_casts = self.lexer.tok == tk::BraceL;
                self.restore();
            }
            let mut i = mark;
            while i < self.arena.ls_pos {
                if !(keeps_casts
                    && (self.n.at(self.arena.ls.at(i)) & 0xff) == k::TypeCastExpression)
                {
                    let v3 = self.to_assignable_parameter(self.arena.ls.at(i))?;
                    self.arena.ls.put(i, v3);
                }
                i += 1;
            }
            let v4 = self.list_finish(mark);
            return self.parse_arrow_rest(start, v4, 0);
        }
        if self.parse.typed != 0 && self.lexer.tok == tk::Colon {
            let arrow = self.try_parse_arrow_with_return_type(start, mark, 0)?;
            if arrow != 0 {
                return Ok(arrow);
            }
        }
        let count = self.arena.ls_pos - mark;
        if count == 0 || saw_rest || trailing_comma || typed_item != 0 {
            return Err(self.unexpected());
        }
        let expression: i32;
        if count == 1 {
            expression = self.arena.ls.at(mark);
            self.list_truncate(mark);
        } else {
            let v5 = self.list_finish(mark);
            expression = self.node_l(k::SequenceExpression, inner_start, inner_end, v5);
        }
        if (self.n.at(expression) & (0xff | F_PAREN)) == k::TypeCastExpression
            && self.t.at(self.n.at(expression + 1)) != 40
        {
            // the parentheses are part of the cast
            self.n.put(expression + 1, start);
            self.n.put(expression + 2, self.lexer.prev_end);
            return Ok(expression);
        }
        if keep_parens {
            return Ok(self.node1(
                k::ParenthesizedExpression,
                start,
                self.lexer.prev_end,
                expression,
            ));
        }
        self.n.put(expression, self.n.at(expression) | F_PAREN);
        return Ok(expression);
    }

    pub(crate) fn parse_new(&mut self) -> R<i32> {
        self.stack()?;
        let start = self.lexer.tok_start;
        let meta_end = self.lexer.tok_end;
        self.next()?;
        if self.lexer.tok == tk::Dot {
            let meta = self.node0(k::Identifier, start, meta_end);
            self.next()?;
            let property = self.parse_ident_name()?;
            return Ok(self.node2(k::MetaProperty, start, self.lexer.prev_end, meta, property));
        }
        let callee_start = self.lexer.tok_start;
        let v0 = if self.lexer.tok == tk::New {
            self.parse_new()?
        } else {
            self.parse_expr_atom()?
        };
        let mut callee = self.parse_subscripts(v0, callee_start, true)?;
        let mut type_arguments: i32 = 0;
        if self.parse.typed != 0
            && (self.n.at(callee) & (0xff | F_PAREN)) == k::InstantiationExpression
        {
            type_arguments = self.n.at(callee + 5);
            callee = self.n.at(callee + 4);
        }
        let args = if self.lexer.tok == tk::ParenL {
            self.parse_arguments()?
        } else {
            0
        };
        return Ok(self.call_node(
            k::NewExpression,
            start,
            self.lexer.prev_end,
            callee,
            args,
            type_arguments,
        ));
    }

    pub(crate) fn parse_import_expression(&mut self) -> R<i32> {
        let start = self.lexer.tok_start;
        let meta_end = self.lexer.tok_end;
        self.next()?;
        let mut phase = P_NONE;
        if self.lexer.tok == tk::Dot {
            self.next()?;
            if self.is_kw(kw::Meta) {
                if self.parse.is_common_js && self.parse.typed == 0 {
                    return Err(self.fail(start));
                }
                let meta = self.node0(k::Identifier, start, meta_end);
                let property = self.identifier()?;
                return Ok(self.node2(k::MetaProperty, start, self.lexer.prev_end, meta, property));
            }
            if self.is_kw(kw::Defer) {
                phase = P_DEFER;
            } else if self.is_kw(kw::Source) {
                phase = P_SOURCE;
            } else {
                return Err(self.unexpected());
            }
            self.next()?;
        }
        self.expect(tk::ParenL)?;
        let saved_no_in = self.parse.no_in;
        self.parse.no_in = 0;
        let mark = self.arena.ls_pos;
        let v0 = self.parse_maybe_assign()?;
        self.list_push(v0);
        if self.eat(tk::Comma)? && self.lexer.tok != tk::ParenR {
            let v1 = self.parse_maybe_assign()?;
            self.list_push(v1);
            self.eat(tk::Comma)?;
        }
        self.parse.no_in = saved_no_in;
        self.expect(tk::ParenR)?;
        // the same shape as a call: no callee, then the arguments
        let v2 = k::ImportExpression | (phase << SUB_SHIFT);
        let v3 = self.lexer.prev_end;
        let v4 = self.list_finish(mark);
        return Ok(self.call_node(v2, start, v3, 0, v4, 0));
    }

    /// The current token is "`". `is_type`: between `${` and `}` stand types.
    pub(crate) fn parse_template(&mut self, is_type: bool) -> R<i32> {
        let start = self.lexer.tok_start;
        let mark = self.arena.ls_pos;
        self.scan_template_chunk(self.lexer.tok_end)?;
        loop {
            let flags = self.lexer.tok_flags;
            let v0 = self.node0(
                k::TemplateElement | flags,
                self.lexer.tok_start,
                self.lexer.tok_end,
            );
            self.list_push(v0);
            if (flags & F_PREFIX) != 0 {
                // F_TAIL
                break;
            }
            self.set_pos(self.lexer.pos);
            self.next()?;
            let saved_no_in = self.parse.no_in;
            self.parse.no_in = 0;
            let v1 = if is_type {
                self.ts_parse_type()?
            } else {
                self.parse_expression()?
            };
            self.list_push(v1);
            self.parse.no_in = saved_no_in;
            if self.lexer.tok != tk::BraceR {
                return Err(self.unexpected());
            }
            self.scan_template_chunk(self.lexer.tok_end)?;
        }
        self.set_pos(self.lexer.pos);
        let end = self.lexer.pos;
        // quasis and expressions alternate on the stack
        let count = self.arena.ls_pos - mark;
        let expressions = count >> 1;
        self.reserve_ast(count + 2);
        let split = self.arena.ls_pos;
        let mut i: i32 = 0;
        while i < count {
            self.list_push(self.arena.ls.at(mark + i));
            i += 2;
        }
        let quasi_list = self.list_finish(split);
        let mut i: i32 = 1;
        while i < count {
            self.list_push(self.arena.ls.at(mark + i));
            i += 2;
        }
        let expression_list = if expressions == 0 {
            0
        } else {
            self.list_finish(split)
        };
        self.list_truncate(mark);
        self.next()?;
        return Ok(self.node_ll(
            if is_type && expressions != 0 {
                k::TemplateLiteralType
            } else {
                k::TemplateLiteral
            },
            start,
            end,
            quasi_list,
            expression_list,
        ));
    }

    pub(crate) fn parse_array(&mut self) -> R<i32> {
        let start = self.lexer.tok_start;
        self.next()?;
        let saved_no_in = self.parse.no_in;
        self.parse.no_in = 0;
        let saved_depth = self.parse.list_depth;
        self.parse.list_depth = saved_depth + self.lexer.tok_nl;
        let mark = self.arena.ls_pos;
        while self.lexer.tok != tk::BracketR {
            if self.lexer.tok == tk::Comma {
                self.next()?;
                self.list_push(0);
                continue;
            }
            if self.lexer.tok == tk::Ellipsis {
                let spread_start = self.lexer.tok_start;
                self.next()?;
                let argument = self.parse_maybe_assign()?;
                let v0 = self.node1(
                    k::SpreadElement,
                    spread_start,
                    self.lexer.prev_end,
                    argument,
                );
                self.list_push(v0);
            } else {
                let v1 = self.parse_maybe_assign()?;
                self.list_push(v1);
            }
            if self.lexer.tok != tk::BracketR {
                self.expect(tk::Comma)?;
            }
        }
        self.parse.list_depth = saved_depth;
        self.next()?;
        self.parse.no_in = saved_no_in;
        if self.parse.typed != 0 {
            let v2 = self.lexer.prev_end;
            let v3 = self.list_finish(mark);
            return Ok(self.list_node_with_room(k::ArrayExpression, start, v2, v3));
        }
        let v4 = self.lexer.prev_end;
        let v5 = self.list_finish(mark);
        return Ok(self.node_l(k::ArrayExpression, start, v4, v5));
    }

    pub(crate) fn parse_object(&mut self) -> R<i32> {
        let start = self.lexer.tok_start;
        if self.parse.known_blocks_count != 0 {
            let known = self.known_block_at(start);
            if known != 0 {
                self.parse.object_is_binding = false;
                self.set_pos(self.n.at(known + 2));
                self.next()?;
                return Ok(known);
            }
        }
        self.next()?;
        let saved_no_in = self.parse.no_in;
        self.parse.no_in = 0;
        let mark = self.arena.ls_pos;
        let is_binding = self.parse.object_is_binding;
        self.parse.object_is_binding = false;
        self.parse.list_depth += 1;
        while self.lexer.tok != tk::BraceR {
            if self.parse.reads_ahead
                && self.lexer.tok_nl != 0
                && (self.lexer.tok == tk::Name
                    || self.lexer.tok == tk::String
                    || self.lexer.tok >= tk::In)
                && self.lexer.tok_start != self.parse.refused_at
                && self.read_property(
                    self.lexer.tok_start,
                    self.parse.typed,
                    self.parse.in_async != 0
                        || (self.parse.in_function == 0 && self.parse.top_level_await),
                    is_binding,
                    self.parse.list_depth.wrapping_mul(self.options.tab_width),
                    false,
                )?
            {
                let mut property_start = self.lexer.tok_start;
                let mut behind: i32;
                loop {
                    let n = self.node_raw(
                        k::Ready | self.fast.ready_flags | (k::ObjectProperty << SUB_SHIFT),
                        property_start,
                        self.fast.ready_end,
                        3,
                    );
                    self.n.put(n + 4, self.fast.ready_text);
                    self.n.put(n + 5, self.fast.ready_length);
                    self.n.put(n + 6, self.fast.ready_level);
                    self.list_push(n);
                    behind = self.fast.ready_next;
                    // on without the lexer, as long as properties follow that can be read
                    if self.t.at(behind) != 44 {
                        break;
                    }
                    if !self.read_next_property(behind + 1, is_binding)? {
                        self.parse.refused_at = self.fast.ready_start;
                        break;
                    }
                    property_start = self.fast.ready_start;
                }
                self.set_pos(behind);
                self.next()?;
            } else {
                let v0 = self.parse_object_member()?;
                self.list_push(v0);
            }
            if self.lexer.tok != tk::BraceR {
                self.expect(tk::Comma)?;
            }
        }
        self.parse.list_depth -= 1;
        self.next()?;
        self.parse.no_in = saved_no_in;
        if self.parse.typed != 0 {
            let v1 = self.lexer.prev_end;
            let v2 = self.list_finish(mark);
            return Ok(self.list_node_with_room(k::ObjectExpression, start, v1, v2));
        }
        let v3 = self.lexer.prev_end;
        let v4 = self.list_finish(mark);
        return Ok(self.node_l(k::ObjectExpression, start, v3, v4));
    }

    /// The current token starts a member of an object type of Flow. Pushes it, and those that follow it, if fast.rs can read them; the current token is then what
    /// stands behind the last one, a separator or the end of the type.
    pub(crate) fn parse_ready_type_properties(&mut self) -> R<bool> {
        if !self.parse.reads_ahead
            || self.lexer.tok_nl == 0
            || self.lexer.tok_start == self.parse.refused_at
            || !self.read_type_property(
                self.lexer.tok_start,
                self.parse.list_depth.wrapping_mul(self.options.tab_width),
            )?
        {
            return Ok(false);
        }
        let mut start = self.lexer.tok_start;
        let mut behind: i32;
        loop {
            let n = self.node_raw(
                k::Ready | self.fast.ready_flags | (k::ObjectTypeProperty << SUB_SHIFT),
                start,
                self.fast.ready_end,
                2,
            );
            self.n.put(n + 4, self.fast.ready_text);
            self.n.put(n + 5, self.fast.ready_length);
            self.list_push(n);
            behind = self.fast.ready_next;
            if self.t.at(behind) != 44 && self.t.at(behind) != 59 {
                break;
            }
            if !self.read_next_type_property(behind + 1)? {
                self.parse.refused_at = self.fast.ready_start;
                break;
            }
            start = self.fast.ready_start;
        }
        self.set_pos(behind);
        self.next()?;
        return Ok(true);
    }

    pub(crate) fn object_word_was_key(&self) -> bool {
        return self.lexer.tok == tk::ParenL
            || self.lexer.tok == tk::Comma
            || self.lexer.tok == tk::BraceR
            || self.lexer.tok == tk::Colon
            || self.lexer.tok == tk::Eq
            || (self.lexer.tok == tk::Lt && self.parse.typed != 0);
    }

    pub(crate) fn parse_object_member(&mut self) -> R<i32> {
        let start = self.lexer.tok_start;
        if self.lexer.tok == tk::Ellipsis {
            self.next()?;
            let argument = self.parse_maybe_assign()?;
            return Ok(self.node1(k::SpreadElement, start, self.lexer.prev_end, argument));
        }
        let mut flags: i32 = 0;
        let mut method = M_METHOD;
        let mut key: i32 = 0;
        if self.is_kw(kw::Async) {
            let word = self.identifier()?;
            if self.object_word_was_key() || self.lexer.tok_nl != 0 {
                key = word;
            } else {
                flags |= F_ASYNC;
            }
        }
        if key == 0 && self.lexer.tok == tk::Mul {
            self.next()?;
            flags |= F_GENERATOR;
        }
        if key == 0
            && flags == 0
            && self.lexer.tok == tk::Name
            && (self.lexer.tok_kw == kw::Get || self.lexer.tok_kw == kw::Set)
        {
            let kw = self.lexer.tok_kw;
            let word = self.identifier()?;
            if self.object_word_was_key() {
                key = word;
            } else {
                method = if kw == kw::Get { M_GET } else { M_SET };
            }
        }
        if key == 0 {
            if self.lexer.tok == tk::BracketL {
                flags |= F_COMPUTED;
            }
            key = self.parse_property_name()?;
        }
        if self.lexer.tok == tk::ParenL || (self.lexer.tok == tk::Lt && self.parse.typed != 0) {
            return self.parse_method_rest(
                k::ObjectMethod | flags | (method << SUB_SHIFT),
                start,
                key,
                0,
            );
        }
        if self.eat(tk::Colon)? {
            let value = self.parse_maybe_assign()?;
            return Ok(self.node2(
                k::ObjectProperty | flags,
                start,
                self.lexer.prev_end,
                key,
                value,
            ));
        }
        // shorthand
        if (self.n.at(key) & 0xff) != k::Identifier || (flags & F_COMPUTED) != 0 {
            return Err(self.unexpected());
        }
        let mut value = if self.parse.typed == 0 {
            self.node0(self.n.at(key), self.n.at(key + 1), self.n.at(key + 2))
        } else {
            self.leaf_with_room(self.n.at(key), self.n.at(key + 1), self.n.at(key + 2))
        };
        if self.eat(tk::Eq)? {
            let right = self.parse_maybe_assign()?;
            value = self.node2(
                k::AssignmentPattern,
                start,
                self.lexer.prev_end,
                value,
                right,
            );
        }
        return Ok(self.node2(
            k::ObjectProperty | F_SHORTHAND,
            start,
            self.lexer.prev_end,
            key,
            value,
        ));
    }

    /// Turns an expression into the pattern it covers, in place.
    /// The same for what stood between parentheses and turns out to be a parameter. Returns the node that takes the place of `n`.
    pub(crate) fn to_assignable_parameter(&mut self, n: i32) -> R<i32> {
        self.stack()?;
        if self.parse.typed == TYPED_FLOW {
            let k = self.n.at(n) & 0xff;
            if k == k::TypeCastExpression {
                let expression = self.n.at(n + 4);
                let annotation = self.n.at(n + 5);
                if EXT_AT.at(self.n.at(expression) & 0xff) == 0 {
                    return Err(self.unexpected());
                }
                self.to_assignable(expression)?;
                self.n.put(expression, self.n.at(expression) | F_EXT);
                self.set_child(
                    expression,
                    EXT_AT.at(self.n.at(expression) & 0xff),
                    annotation,
                );
                self.n.put(expression + 2, self.n.at(annotation + 2));
                return Ok(expression);
            }
            if k == k::AssignmentExpression
                && (self.n.at(self.n.at(n + 4)) & 0xff) == k::TypeCastExpression
            {
                let v0 = self.to_assignable_parameter(self.n.at(n + 4))?;
                self.set_child(n, 4, v0);
            }
        }
        self.to_assignable(n)?;
        // what was read as an expression has to have become a name or a pattern
        let mut target = n;
        if (self.n.at(target) & 0xff) == k::AssignmentPattern
            || (self.n.at(target) & 0xff) == k::RestElement
        {
            target = self.n.at(target + 4);
        }
        match self.n.at(target) & 0xff {
            k::Identifier
            | k::ObjectPattern
            | k::ArrayPattern
            | k::TypeCastExpression
            | k::AssignmentPattern => {}
            _ => {
                if self.parse.speculating != 0 {
                    return Err(self.unexpected());
                }
                return Err(self.fail(self.n.at(target + 1)));
            }
        }
        return Ok(n);
    }

    /// Babel's checkLVal() for what is assigned to: a name, a member, or (with `patterns`) a pattern of those, which to_assignable() has
    /// made of the literal. The parsers reject everything else, and a host then leaves the code as it stands.
    pub(crate) fn check_target(&self, n: i32, patterns: bool) -> R<()> {
        self.stack()?;
        let head = self.n.at(n);
        's0: {
            match head & 0xff {
                k::Identifier | k::MemberExpression | k::TypeCastExpression | k::CallExpression => {
                    return Ok(());
                }
                k::ObjectPattern => {
                    {
                        if !patterns || (head & F_PAREN) != 0 {
                            break 's0;
                        }
                        if self.parse.typed == TYPED_TS {
                            // typescript-estree does not look into a pattern
                            return Ok(());
                        }
                        let l = self.n.at(n + 4);
                        let mut i: i32 = 1;
                        while i <= self.n.at(l) {
                            'c2: {
                                let member = self.n.at(l + i);
                                let kind = self.n.at(member) & 0xff;
                                if kind == k::ObjectProperty {
                                    self.check_target(self.n.at(member + 5), true)?;
                                } else if kind == k::Ready {
                                    // to_assignable() has looked at it
                                    break 'c2;
                                } else if kind == k::RestElement {
                                    self.check_target(self.n.at(member + 4), true)?;
                                } else {
                                    return Err(self.fail(self.n.at(member + 1)));
                                }
                            }
                            i += 1;
                        }
                        return Ok(());
                    }
                }
                k::ArrayPattern => {
                    if !patterns || (head & F_PAREN) != 0 {
                        break 's0;
                    }
                    if self.parse.typed == TYPED_TS {
                        return Ok(());
                    }
                    let l = self.n.at(n + 4);
                    let mut i: i32 = 1;
                    while i <= self.n.at(l) {
                        if self.n.at(l + i) != 0 {
                            self.check_target(self.n.at(l + i), true)?;
                        }
                        i += 1;
                    }
                    return Ok(());
                }
                k::RestElement | k::AssignmentPattern => {
                    if !patterns {
                        break 's0;
                    }
                    self.check_target(self.n.at(n + 4), true)?;
                    return Ok(());
                }
                k::ParenthesizedExpression
                | k::NonNullExpression
                | k::AsExpression
                | k::SatisfiesExpression
                | k::InstantiationExpression => {
                    self.check_target(self.n.at(n + 4), false)?;
                    return Ok(());
                }
                k::TypeAssertion => {
                    self.check_target(self.n.at(n + 5), false)?;
                    return Ok(());
                }
                _ => {}
            }
        }
        if self.parse.speculating != 0 {
            return Err(self.unexpected());
        }
        return Err(self.fail(self.n.at(n + 1)));
    }

    /// TypeScript's parser takes `=` behind whatever is a "left-hand side expression" by its form, `3 = a` included.
    pub(crate) fn check_target_of_type_script(&self, n: i32) -> R<()> {
        let head = self.n.at(n);
        if (head & F_PAREN) != 0 {
            return Ok(());
        }
        match head & 0xff {
            k::BinaryExpression
            | k::LogicalExpression
            | k::ConditionalExpression
            | k::UnaryExpression
            | k::UpdateExpression
            | k::AwaitExpression
            | k::YieldExpression
            | k::ArrowFunctionExpression
            | k::AssignmentExpression => {
                if self.parse.speculating != 0 {
                    return Err(self.unexpected());
                }
                return Err(self.fail(self.n.at(n + 1)));
            }
            _ => {}
        }
        Ok(())
    }

    pub(crate) fn to_assignable(&mut self, n: i32) -> R<()> {
        self.stack()?;
        if n == 0 {
            return Ok(());
        }
        match self.n.at(n) & 0xff {
            k::ObjectExpression => {
                self.set_kind_keep_flags(n, k::ObjectPattern);
                let l = self.n.at(n + 4);
                let count = self.n.at(l);
                let mut i: i32 = 1;
                while i <= count {
                    let member = self.n.at(l + i);
                    let kind = self.n.at(member) & 0xff;
                    if kind == k::ObjectProperty {
                        self.to_assignable(self.n.at(member + 5))?;
                    } else if kind == k::SpreadElement {
                        self.to_assignable(member)?;
                    } else if kind == k::Ready && (self.n.at(member) & F_EXTRA) == 0 {
                        return Err(self.redo());
                    }
                    i += 1;
                }
                return Ok(());
            }
            k::ArrayExpression => {
                self.set_kind_keep_flags(n, k::ArrayPattern);
                let l = self.n.at(n + 4);
                let count = self.n.at(l);
                let mut i: i32 = 1;
                while i <= count {
                    self.to_assignable(self.n.at(l + i))?;
                    i += 1;
                }
                return Ok(());
            }
            k::SpreadElement => {
                self.set_kind_keep_flags(n, k::RestElement);
                self.to_assignable(self.n.at(n + 4))?;
                return Ok(());
            }
            k::AssignmentExpression => {
                if ((self.n.at(n) as u32) >> SUB_SHIFT) as i32 == tk::Eq {
                    self.set_kind(n, k::AssignmentPattern);
                }
                return Ok(());
            }
            k::ParenthesizedExpression
            | k::NonNullExpression
            | k::AsExpression
            | k::SatisfiesExpression => {
                self.to_assignable(self.n.at(n + 4))?;
                return Ok(());
            }
            k::TypeAssertion => {
                self.to_assignable(self.n.at(n + 5))?;
                return Ok(());
            }
            _ => {}
        }
        Ok(())
    }

    // ---------------------------------------------------------------------------------------------------------- modules
    pub(crate) fn module_export_name(&mut self) -> R<i32> {
        if self.lexer.tok == tk::String {
            return self.leaf(k::StringLiteral);
        }
        return self.parse_ident_name();
    }

    pub(crate) fn string_literal(&mut self) -> R<i32> {
        if self.lexer.tok != tk::String {
            return Err(self.unexpected());
        }
        return self.leaf(k::StringLiteral);
    }

    /// `with { type: "json" }`, or nothing.
    pub(crate) fn parse_attributes(&mut self) -> R<i32> {
        self.parse.attributes_flag = 0;
        let mut is_assert = false;
        if self.lexer.tok == tk::With {
            self.next()?;
        } else if self.lexer.tok == tk::Name
            && self.lexer.tok_nl == 0
            && self.text_is(self.lexer.tok_start, self.lexer.tok_end, b"assert")
        {
            is_assert = true;
            self.next()?;
        } else {
            return Ok(0);
        }
        if is_assert {
            self.parse.attributes_flag = F_EXTRA;
        }
        self.expect(tk::BraceL)?;
        let mark = self.arena.ls_pos;
        while self.lexer.tok != tk::BraceR {
            let start = self.lexer.tok_start;
            let key = self.module_export_name()?;
            self.expect(tk::Colon)?;
            let value = self.string_literal()?;
            let v0 = self.node2(k::ImportAttribute, start, self.lexer.prev_end, key, value);
            self.list_push(v0);
            if self.lexer.tok != tk::BraceR {
                self.expect(tk::Comma)?;
            }
        }
        self.next()?;
        return Ok(self.list_finish(mark));
    }

    /// The current token is `import`, and a declaration follows.
    pub(crate) fn parse_import(&mut self, start: i32) -> R<i32> {
        self.next()?;
        let mut phase = P_NONE;
        let mark = self.arena.ls_pos;
        if self.lexer.tok == tk::String {
            let source = self.string_literal()?;
            let attributes = self.parse_attributes()?;
            let end = self.lexer.prev_end;
            self.semicolon()?;
            return Ok(self.node1_ll(
                k::ImportDeclaration | self.parse.attributes_flag,
                start,
                end,
                source,
                0,
                attributes,
            ));
        }
        let mut import_kind: i32 = 0;
        if self.parse.typed == TYPED_FLOW {
            import_kind = self.flow_parse_import_kind()?;
        }
        if self.parse.typed == TYPED_TS && self.lexer.tok == tk::Name {
            if self.lexer.tok_end - self.lexer.tok_start == 4
                && self.text_is(self.lexer.tok_start, self.lexer.tok_end, b"type")
            {
                // `import type X from`, `import type { X } from`, `import type * as X from`; but `import type from "x"`, `import type, { X } from`
                self.save();
                self.next()?;
                let is_kind = self.lexer.tok != tk::Comma
                    && self.lexer.tok != tk::Eq
                    && !(self.is_kw(kw::From) && self.peek_is_string());
                if is_kind {
                    import_kind = IK_TYPE;
                } else {
                    self.restore();
                }
            }
            if self.lexer.tok == tk::Name {
                self.save();
                self.next()?;
                let is_equals = self.lexer.tok == tk::Eq;
                self.restore();
                if is_equals {
                    return self.ts_parse_import_equals(start, import_kind);
                }
            }
        }
        if self.lexer.tok == tk::Name
            && (self.lexer.tok_kw == kw::Defer
                || self.lexer.tok_kw == kw::Source
                || self.lexer.tok_kw == kw::Module)
        {
            // `import defer * as ns`, `import source x from`; but `import defer from "x"` imports a default
            let kw = self.lexer.tok_kw;
            self.save();
            self.next()?;
            let is_phase = if kw == kw::Defer {
                self.lexer.tok == tk::Mul
            } else {
                self.lexer.tok == tk::Name
                    && !(self.lexer.tok_kw == kw::From && self.peek_is_string())
            };
            if is_phase {
                phase = if kw == kw::Defer {
                    P_DEFER
                } else {
                    if kw == kw::Source { P_SOURCE } else { P_MODULE }
                };
            } else {
                self.restore();
            }
        }
        let mut flags: i32 = 0;
        if self.lexer.tok == tk::Name {
            let spec_start = self.lexer.tok_start;
            let local = self.identifier()?;
            let v0 = self.node1(
                k::ImportDefaultSpecifier,
                spec_start,
                self.lexer.prev_end,
                local,
            );
            self.list_push(v0);
            if import_kind != 0 && self.parse.typed == TYPED_TS && self.lexer.tok == tk::Comma {
                // a type-only import has a default import or named bindings
                return Err(self.unexpected());
            }
            if self.lexer.tok == tk::Comma {
                self.next()?;
                if self.lexer.tok != tk::Mul && self.lexer.tok != tk::BraceL {
                    return Err(self.unexpected());
                }
            } else if self.lexer.tok == tk::Mul || self.lexer.tok == tk::BraceL {
                // `import type {a}` is no JavaScript
                return Err(self.unexpected());
            }
        }
        if self.lexer.tok == tk::Mul {
            let spec_start = self.lexer.tok_start;
            self.next()?;
            if !self.is_kw(kw::As) {
                return Err(self.unexpected());
            }
            self.next()?;
            let local = self.parse_ident()?;
            let v1 = self.node1(
                k::ImportNamespaceSpecifier,
                spec_start,
                self.lexer.prev_end,
                local,
            );
            self.list_push(v1);
        } else if self.lexer.tok == tk::BraceL {
            // has braces
            flags |= F_SHORTHAND;
            self.next()?;
            while self.lexer.tok != tk::BraceR {
                let spec_start = self.lexer.tok_start;
                if self.parse.typed == TYPED_TS
                    && self.lexer.tok == tk::Name
                    && self.lexer.tok_end - self.lexer.tok_start == 4
                    && self.text_is(self.lexer.tok_start, self.lexer.tok_end, b"type")
                {
                    let v2 = self.ts_parse_import_or_export_specifier(k::ImportSpecifier)?;
                    self.list_push(v2);
                    if self.lexer.tok != tk::BraceR {
                        self.expect(tk::Comma)?;
                    }
                    continue;
                }
                if self.parse.typed == TYPED_FLOW
                    && (self.lexer.tok == tk::Typeof
                        || (self.lexer.tok == tk::Name
                            && self.lexer.tok_end - self.lexer.tok_start == 4
                            && self.text_is(self.lexer.tok_start, self.lexer.tok_end, b"type")))
                {
                    let v3 = self.flow_parse_import_specifier()?;
                    self.list_push(v3);
                    if self.lexer.tok != tk::BraceR {
                        self.expect(tk::Comma)?;
                    }
                    continue;
                }
                let imported = self.module_export_name()?;
                let local: i32;
                if self.is_kw(kw::As) {
                    self.next()?;
                    local = self.parse_ident_name()?;
                } else {
                    local = self.node0(
                        self.n.at(imported),
                        self.n.at(imported + 1),
                        self.n.at(imported + 2),
                    );
                }
                let v4 = self.node2(
                    k::ImportSpecifier,
                    spec_start,
                    self.lexer.prev_end,
                    imported,
                    local,
                );
                self.list_push(v4);
                if self.lexer.tok != tk::BraceR {
                    self.expect(tk::Comma)?;
                }
            }
            self.next()?;
        }
        if !self.is_kw(kw::From) {
            return Err(self.unexpected());
        }
        self.next()?;
        let specifiers = self.list_finish(mark);
        let source = self.string_literal()?;
        let attributes = self.parse_attributes()?;
        let end = self.lexer.prev_end;
        self.semicolon()?;
        return Ok(self.node1_ll(
            k::ImportDeclaration
                | flags
                | self.parse.attributes_flag
                | ((phase | (import_kind << IK_SHIFT)) << SUB_SHIFT),
            start,
            end,
            source,
            specifiers,
            attributes,
        ));
    }

    pub(crate) fn peek_is_string(&self) -> bool {
        // only called between save() and restore(): look one more token ahead by hand
        let p = self.lexer.pos;
        let mut q = p;
        while self.t.at(q) == 32 || self.t.at(q) == 9 || self.t.at(q) == 10 {
            q += 1;
        }
        return self.t.at(q) == 34 || self.t.at(q) == 39;
    }

    /// The end of an export declaration around `declaration`: without the semicolon, if the declaration counts it in.
    pub(crate) fn end_without_semicolon(&self, declaration: i32) -> i32 {
        let end = self.n.at(declaration + 2);
        return if self.t.at(end - 1) == 59 {
            self.parse.content_end
        } else {
            end
        };
    }

    /// The current token is `export`. `decorators` stood in front of it.
    pub(crate) fn parse_export(&mut self, start: i32, decorators: i32) -> R<i32> {
        self.next()?;
        let mut export_kind: i32 = 0;
        if self.parse.typed == TYPED_TS {
            if self.lexer.tok == tk::Name
                || self.lexer.tok == tk::Eq
                || self.lexer.tok == tk::Import
                || self.lexer.tok == tk::Const
            {
                // export =, export as namespace, export import a = b, export declare .., export type .., export interface ..
                self.parse.pending_decorators = decorators;
                let declaration = self.ts_parse_export_declaration(start)?;
                self.parse.pending_decorators = 0;
                if declaration < 0 {
                    // `export type` before `{` or `*`
                    export_kind = IK_TYPE;
                } else if declaration != 0 {
                    let k = self.n.at(declaration) & 0xff;
                    if k == k::ExportAssignment || k == k::NamespaceExportDeclaration {
                        return Ok(declaration);
                    }
                    return Ok(self.node2_ll(
                        k::ExportNamedDeclaration | (if decorators != 0 { F_EXTRA } else { 0 }),
                        start,
                        self.end_without_semicolon(declaration),
                        declaration,
                        0,
                        0,
                        0,
                    ));
                }
            }
        }
        if self.parse.typed == TYPED_FLOW && self.lexer.tok == tk::Name {
            let declaration = self.flow_parse_export_declaration()?;
            if declaration < 0 {
                export_kind = IK_TYPE;
            } else if declaration != 0 {
                return Ok(self.node2_ll(
                    k::ExportNamedDeclaration,
                    start,
                    self.end_without_semicolon(declaration),
                    declaration,
                    0,
                    0,
                    0,
                ));
            }
        }
        if self.lexer.tok == tk::Mul {
            let spec_start = self.lexer.tok_start;
            self.next()?;
            if self.is_kw(kw::As) {
                self.next()?;
                let exported = self.module_export_name()?;
                let mark = self.arena.ls_pos;
                let v0 = self.node1(
                    k::ExportNamespaceSpecifier,
                    spec_start,
                    self.lexer.prev_end,
                    exported,
                );
                self.list_push(v0);
                if self.eat(tk::Comma)? {
                    self.parse_export_specifiers()?;
                }
                return self.finish_export_from(
                    start,
                    mark,
                    true,
                    export_kind << IK_SHIFT << SUB_SHIFT,
                );
            }
            if !self.is_kw(kw::From) {
                return Err(self.unexpected());
            }
            self.next()?;
            let source = self.string_literal()?;
            let attributes = self.parse_attributes()?;
            let end = self.lexer.prev_end;
            self.semicolon()?;
            return Ok(self.node2_l(
                k::ExportAllDeclaration
                    | self.parse.attributes_flag
                    | (export_kind << IK_SHIFT << SUB_SHIFT),
                start,
                end,
                0,
                source,
                attributes,
            ));
        }
        if self.lexer.tok == tk::Default {
            self.next()?;
            let decl_start = self.lexer.tok_start;
            let mut declaration: i32;
            let mut needs_semicolon = false;
            if self.lexer.tok == tk::Function {
                declaration = self.parse_function(decl_start, k::FunctionDeclaration, 0)?;
            } else if self.lexer.tok == tk::Class {
                declaration = self.parse_class(
                    if decorators != 0 { start } else { decl_start },
                    k::ClassDeclaration,
                    decorators,
                )?;
            } else if self.lexer.tok == tk::At {
                let own = self.parse_decorators()?;
                declaration = self.parse_class(decl_start, k::ClassDeclaration, own)?;
            } else {
                declaration = 0;
                if self.parse.typed == TYPED_TS && self.lexer.tok == tk::Name {
                    // export default interface X {}, export default abstract class X {}
                    self.parse.pending_decorators = decorators;
                    declaration =
                        self.ts_parse_statement(if decorators != 0 { start } else { decl_start })?;
                    self.parse.pending_decorators = 0;
                    let k = self.n.at(declaration) & 0xff;
                    if declaration != 0 && k != k::InterfaceDeclaration && k != k::ClassDeclaration
                    {
                        return Err(self.unexpected());
                    }
                }
                if self.parse.typed == TYPED_FLOW && self.lexer.tok == tk::Name {
                    // export default component X() {}, hook, enum, record
                    let m = self.mark();
                    declaration = self.flow_parse_statement(decl_start)?;
                    let k = self.n.at(declaration) & 0xff;
                    if declaration != 0
                        && k != k::ComponentDeclaration
                        && k != k::HookDeclaration
                        && k != k::EnumDeclaration
                        && k != k::RecordDeclaration
                    {
                        self.rewind(m);
                        declaration = 0;
                    } else {
                        self.unmark(m);
                    }
                }
                if declaration == 0 && self.is_kw(kw::Async) {
                    self.save();
                    self.next()?;
                    if self.lexer.tok == tk::Function && self.lexer.tok_nl == 0 {
                        declaration =
                            self.parse_function(decl_start, k::FunctionDeclaration, F_ASYNC)?;
                    } else {
                        self.restore();
                    }
                }
                if declaration == 0 {
                    declaration = self.parse_maybe_assign()?;
                    needs_semicolon = true;
                }
            }
            let end = if needs_semicolon {
                self.lexer.prev_end
            } else {
                self.end_without_semicolon(declaration)
            };
            if needs_semicolon {
                self.semicolon()?;
            }
            return Ok(self.node1(
                k::ExportDefaultDeclaration | (if decorators != 0 { F_EXTRA } else { 0 }),
                start,
                end,
                declaration,
            ));
        }
        if self.lexer.tok == tk::BraceL {
            let mark = self.arena.ls_pos;
            self.parse_export_specifiers()?;
            return self.finish_export_from(
                start,
                mark,
                false,
                F_SHORTHAND | (export_kind << IK_SHIFT << SUB_SHIFT),
            );
        }
        let declaration: i32;
        let decl_start = self.lexer.tok_start;
        's0: {
            match self.lexer.tok {
                tk::Var | tk::Const | tk::Function => {
                    declaration = self.parse_statement()?;
                }
                tk::Class => {
                    declaration = self.parse_class(
                        if decorators != 0 { start } else { decl_start },
                        k::ClassDeclaration,
                        decorators,
                    )?;
                }
                tk::At => {
                    declaration = self.parse_statement()?;
                }
                tk::Name => {
                    if self.lexer.tok_kw == kw::Let
                        || self.lexer.tok_kw == kw::Async
                        || self.lexer.tok_kw == kw::Using
                        || self.lexer.tok_kw == kw::Await
                    {
                        self.save();
                        self.next()?;
                        let looks_like_declaration = self.lexer.tok == tk::Name
                            || self.lexer.tok == tk::Function
                            || self.lexer.tok == tk::BracketL
                            || self.lexer.tok == tk::BraceL;
                        let is_from = self.is_kw(kw::From);
                        self.restore();
                        if looks_like_declaration && !is_from {
                            declaration = self.parse_statement()?;
                            break 's0;
                        }
                    }
                    {
                        // export v from "mod"; export v, { a } from "mod"
                        return Err(self.text_refuse());
                    }
                }
                _ => {
                    return Err(self.unexpected());
                }
            }
        }
        // the end leaves the semicolon of the declaration out
        return Ok(self.node2_ll(
            k::ExportNamedDeclaration | (if decorators != 0 { F_EXTRA } else { 0 }),
            start,
            self.end_without_semicolon(declaration),
            declaration,
            0,
            0,
            0,
        ));
    }

    /// `{ a, b as c }`, pushed on the list stack.
    pub(crate) fn parse_export_specifiers(&mut self) -> R<()> {
        self.expect(tk::BraceL)?;
        while self.lexer.tok != tk::BraceR {
            let spec_start = self.lexer.tok_start;
            if self.parse.typed == TYPED_TS
                && self.lexer.tok == tk::Name
                && self.lexer.tok_end - self.lexer.tok_start == 4
                && self.text_is(self.lexer.tok_start, self.lexer.tok_end, b"type")
            {
                let v0 = self.ts_parse_import_or_export_specifier(k::ExportSpecifier)?;
                self.list_push(v0);
                if self.lexer.tok != tk::BraceR {
                    self.expect(tk::Comma)?;
                }
                continue;
            }
            let local = self.module_export_name()?;
            let exported: i32;
            if self.is_kw(kw::As) {
                self.next()?;
                exported = self.module_export_name()?;
            } else {
                exported = self.node0(self.n.at(local), self.n.at(local + 1), self.n.at(local + 2));
            }
            let v1 = self.node2(
                k::ExportSpecifier,
                spec_start,
                self.lexer.prev_end,
                local,
                exported,
            );
            self.list_push(v1);
            if self.lexer.tok != tk::BraceR {
                self.expect(tk::Comma)?;
            }
        }
        self.next()?;
        Ok(())
    }

    pub(crate) fn finish_export_from(
        &mut self,
        start: i32,
        mark: i32,
        needs_from: bool,
        flags: i32,
    ) -> R<i32> {
        let specifiers = self.list_finish(mark);
        let mut source: i32 = 0;
        let mut attributes: i32 = 0;
        self.parse.attributes_flag = 0;
        if self.is_kw(kw::From) {
            self.next()?;
            source = self.string_literal()?;
            attributes = self.parse_attributes()?;
        } else if needs_from {
            return Err(self.unexpected());
        }
        let end = self.lexer.prev_end;
        self.semicolon()?;
        return Ok(self.node2_ll(
            k::ExportNamedDeclaration | flags | self.parse.attributes_flag,
            start,
            end,
            0,
            source,
            specifiers,
            attributes,
        ));
    }

    // -------------------------------------------------------------------------------------------------------------- JSX
    pub(crate) fn jsx_name(&mut self) -> R<i32> {
        if self.lexer.tok != tk::JSXName {
            return Err(self.unexpected());
        }
        let n = self.node0(
            k::JSXIdentifier | self.lexer.tok_flags,
            self.lexer.tok_start,
            self.lexer.tok_end,
        );
        self.next_jsx_tag()?;
        return Ok(n);
    }

    pub(crate) fn parse_jsx_element_name(&mut self) -> R<i32> {
        let start = self.lexer.tok_start;
        let mut name = self.jsx_name()?;
        if self.lexer.tok == tk::Colon {
            self.next_jsx_tag()?;
            let local = self.jsx_name()?;
            return Ok(self.node2(
                k::JSXNamespacedName,
                start,
                self.lexer.prev_end,
                name,
                local,
            ));
        }
        while self.lexer.tok == tk::Dot {
            self.next_jsx_tag()?;
            let property = self.jsx_name()?;
            name = self.node2(
                k::JSXMemberExpression,
                start,
                self.lexer.prev_end,
                name,
                property,
            );
        }
        return Ok(name);
    }

    /// `{ expression }` in a tag or between tags. The current token is `{`; on return it is the `}`.
    pub(crate) fn parse_jsx_container(&mut self) -> R<i32> {
        let start = self.lexer.tok_start;
        self.next()?;
        if self.lexer.tok == tk::BraceR {
            let empty = self.node0(k::JSXEmptyExpression, start + 1, self.lexer.tok_start);
            return Ok(self.node1(k::JSXExpressionContainer, start, self.lexer.tok_end, empty));
        }
        if self.lexer.tok == tk::Ellipsis {
            self.next()?;
            let expression = self.parse_expression()?;
            if self.lexer.tok != tk::BraceR {
                return Err(self.unexpected());
            }
            return Ok(self.node1(k::JSXSpreadChild, start, self.lexer.tok_end, expression));
        }
        let expression = self.parse_expression()?;
        if self.lexer.tok != tk::BraceR {
            return Err(self.unexpected());
        }
        return Ok(self.node1(
            k::JSXExpressionContainer,
            start,
            self.lexer.tok_end,
            expression,
        ));
    }

    pub(crate) fn is_same_jsx_name(&self, a: i32, b: i32) -> R<bool> {
        self.stack()?;
        let k = self.n.at(a) & 0xff;
        if k != (self.n.at(b) & 0xff) {
            return Ok(false);
        }
        if k != k::JSXIdentifier {
            return Ok(self.is_same_jsx_name(self.n.at(a + 4), self.n.at(b + 4))?
                && self.is_same_jsx_name(self.n.at(a + 5), self.n.at(b + 5))?);
        }
        let start = self.n.at(a + 1);
        let length = self.n.at(a + 2) - start;
        let other = self.n.at(b + 1);
        if self.n.at(b + 2) - other != length {
            return Ok(false);
        }
        let mut i: i32 = 0;
        while i < length {
            if self.t.at(start + i) != self.t.at(other + i) {
                return Ok(false);
            }
            i += 1;
        }
        return Ok(true);
    }

    /// Is `name` the name in the opening tag?
    pub(crate) fn closes_jsx(&self, opening: i32, name: i32) -> R<bool> {
        if (self.n.at(opening) & 0xff) != k::Ready {
            return self.is_same_jsx_name(self.n.at(opening + 4), name);
        }
        // The name in the opening tag is written without blanks or comments. If this one is not, it is not found to be the same, and the long way finds out.
        let length = self.n.at(opening + 6);
        let start = self.n.at(opening + 1) + 1;
        let other = self.n.at(name + 1);
        if self.n.at(name + 2) - other != length {
            return Err(self.redo());
        }
        let mut i: i32 = 0;
        while i < length {
            if self.t.at(start + i) != self.t.at(other + i) {
                return Ok(false);
            }
            i += 1;
        }
        return Ok(true);
    }

    /// A node for what fast.rs has read of an element.
    pub(crate) fn ready_jsx(&mut self, kind: i32, start: i32) -> i32 {
        let n = self.node_raw(
            k::Ready | self.fast.ready_flags | (kind << SUB_SHIFT),
            start,
            self.fast.ready_end,
            3,
        );
        self.n.put(n + 4, self.fast.ready_text);
        self.n.put(n + 5, self.fast.ready_length);
        self.n.put(n + 6, self.fast.ready_name_length);
        return n;
    }
}
pub(crate) const JSX_ELSEWHERE: i32 = 0;
pub(crate) const JSX_CHILD: i32 = 1;
/// a child behind `{}`, in which there can be a comment that says to leave it alone
pub(crate) const JSX_CHILD_AFTER_EMPTY: i32 = 2;
/// in parentheses that count as a list
pub(crate) const JSX_IN_PARENS: i32 = 3;
impl Quick {
    /// The current token is `<`. On return `pos` stands behind the last `>`, and no token has been read there.
    pub(crate) fn parse_jsx_element(&mut self, where_: i32) -> R<i32> {
        self.stack()?;
        let start = self.lexer.tok_start;
        if self.parse.known_blocks_count != 0 {
            let known = self.known_block_at(start);
            if known != 0 {
                self.set_pos(self.n.at(known + 2));
                return Ok(known);
            }
        }
        let saved_no_in = self.parse.no_in;
        self.parse.no_in = 0;
        let mut opening: i32 = 0;
        let mut is_fragment = false;
        let mut self_closing = false;
        let mut tag_column: i32 = -1;
        if self.parse.reads_ahead {
            let read = self.read_jsx_tag(
                start,
                self.parse.typed,
                self.parse.in_async != 0
                    || (self.parse.in_function == 0 && self.parse.top_level_await),
                self.parse.list_depth.wrapping_mul(self.options.tab_width),
                where_ == JSX_CHILD,
                where_ == JSX_IN_PARENS,
            )?;
            if read != JSX_REFUSED {
                self.set_pos(self.fast.ready_end);
                if read == JSX_ELEMENT {
                    self.parse.no_in = saved_no_in;
                    return Ok(self.ready_jsx(k::JSXElement, start));
                }
                opening = self.ready_jsx(k::JSXOpeningElement, start);
            } else {
                tag_column = self.fast.ready_tag_column;
            }
        }
        if opening == 0 {
            self.set_pos(start + 1);
            self.next_jsx_tag()?;
            if self.lexer.tok == tk::Gt {
                is_fragment = true;
                opening = self.node0(k::JSXOpeningFragment, start, self.lexer.tok_end);
            } else {
                let name = self.parse_jsx_element_name()?;
                let mut type_arguments: i32 = 0;
                if self.parse.typed != 0 && self.lexer.tok == tk::Lt {
                    // <Component<T> prop />
                    if self.t.at(self.lexer.tok_end) == 60 {
                        // nor here
                        return Err(self.unexpected());
                    }
                    type_arguments = self.ts_parse_type_arguments()?;
                    self.drop_comments_from(self.lexer.prev_end);
                    self.set_pos(self.lexer.prev_end);
                    self.next_jsx_tag()?;
                }
                let mark = self.arena.ls_pos;
                // whether there is `jsx` among the attributes of <style> is asked by what is in it
                if tag_column >= 0
                    && self.n.at(name + 2) - self.n.at(name + 1) == 5
                    && self.text_is(self.n.at(name + 1), self.n.at(name + 2), b"style")
                {
                    tag_column = -1;
                }
                while self.lexer.tok != tk::Div && self.lexer.tok != tk::Gt {
                    let mut attr_start = self.lexer.tok_start;
                    if tag_column >= 0
                        && attr_start != self.parse.refused_at
                        && self.read_jsx_attribute(
                            attr_start,
                            self.parse.typed,
                            self.parse.in_async != 0
                                || (self.parse.in_function == 0 && self.parse.top_level_await),
                            tag_column,
                        )?
                    {
                        let mut behind: i32;
                        loop {
                            let v0 = self.ready_jsx(self.fast.ready_kind, attr_start);
                            self.list_push(v0);
                            behind = self.fast.ready_end;
                            if !self.read_next_jsx_attribute(behind, tag_column)? {
                                self.parse.refused_at = self.fast.ready_start;
                                break;
                            }
                            attr_start = self.fast.ready_start;
                        }
                        self.set_pos(behind);
                        self.next_jsx_tag()?;
                        continue;
                    }
                    if self.lexer.tok == tk::BraceL {
                        self.next()?;
                        self.expect(tk::Ellipsis)?;
                        let argument = self.parse_maybe_assign()?;
                        if self.lexer.tok != tk::BraceR {
                            return Err(self.unexpected());
                        }
                        let v1 = self.node1(
                            k::JSXSpreadAttribute,
                            attr_start,
                            self.lexer.tok_end,
                            argument,
                        );
                        self.list_push(v1);
                        self.next_jsx_tag()?;
                        continue;
                    }
                    let mut attr_name = self.jsx_name()?;
                    if self.lexer.tok == tk::Colon {
                        self.next_jsx_tag()?;
                        let local = self.jsx_name()?;
                        attr_name = self.node2(
                            k::JSXNamespacedName,
                            attr_start,
                            self.lexer.prev_end,
                            attr_name,
                            local,
                        );
                    }
                    let mut value: i32 = 0;
                    let mut end = self.lexer.prev_end;
                    if self.lexer.tok == tk::Eq {
                        self.next_jsx_tag()?;
                        if self.lexer.tok == tk::String {
                            value = self.node0(
                                k::StringLiteral | self.lexer.tok_flags,
                                self.lexer.tok_start,
                                self.lexer.tok_end,
                            );
                            end = self.lexer.tok_end;
                        } else if self.lexer.tok == tk::BraceL {
                            value = self.parse_jsx_container()?;
                            // (TypeScript reports that later)
                            if self.parse.typed != TYPED_TS
                                && (self.n.at(self.n.at(value + 4)) & 0xff) == k::JSXEmptyExpression
                            {
                                return Err(self.fail(self.n.at(value + 1)));
                            }
                            end = self.lexer.tok_end;
                        } else if self.lexer.tok == tk::Lt {
                            value = self.parse_jsx_element(JSX_ELSEWHERE)?;
                            end = self.lexer.pos;
                            self.set_pos(self.lexer.pos);
                        } else {
                            return Err(self.unexpected());
                        }
                        self.next_jsx_tag()?;
                    }
                    let v2 = self.node2(k::JSXAttribute, attr_start, end, attr_name, value);
                    self.list_push(v2);
                }
                let attributes = self.list_finish(mark);
                if self.lexer.tok == tk::Div {
                    self_closing = true;
                    self.next_jsx_tag()?;
                    if self.lexer.tok != tk::Gt {
                        return Err(self.unexpected());
                    }
                }
                opening = self.call_node(
                    k::JSXOpeningElement | (if self_closing { F_SELF_CLOSING } else { 0 }),
                    start,
                    self.lexer.tok_end,
                    name,
                    attributes,
                    type_arguments,
                );
            }
        }
        let mut closing: i32 = 0;
        let mut children: i32 = 0;
        if !self_closing {
            let mark = self.arena.ls_pos;
            // the last child but for text is `{}`, with or without a comment in it, which can be "prettier-ignore"
            let mut after_empty = false;
            loop {
                self.next_jsx_child()?;
                if self.lexer.tok == tk::JSXText {
                    let v3 = self.node0(
                        k::JSXText | self.lexer.tok_flags,
                        self.lexer.tok_start,
                        self.lexer.tok_end,
                    );
                    self.list_push(v3);
                } else if self.lexer.tok == tk::BraceL {
                    if self.parse.reads_ahead
                        && self.read_jsx_container(
                            self.lexer.tok_start,
                            self.parse.typed,
                            self.parse.in_async != 0
                                || (self.parse.in_function == 0 && self.parse.top_level_await),
                            self.parse.list_depth.wrapping_mul(self.options.tab_width),
                        )?
                    {
                        let v4 = self.ready_jsx(k::JSXExpressionContainer, self.lexer.tok_start);
                        self.list_push(v4);
                        self.set_pos(self.fast.ready_end);
                        after_empty = false;
                    } else {
                        let container = self.parse_jsx_container()?;
                        after_empty =
                            (self.n.at(self.n.at(container + 4)) & 0xff) == k::JSXEmptyExpression;
                        self.list_push(container);
                    }
                } else {
                    // `<`: a child or the closing tag
                    let tag_start = self.lexer.tok_start;
                    if self.t.at(tag_start + 1) == 47 {
                        // the closing tag, written like most
                        if is_fragment {
                            if self.t.at(tag_start + 2) == 62 {
                                closing =
                                    self.node0(k::JSXClosingFragment, tag_start, tag_start + 3);
                                self.set_pos(tag_start + 3);
                                break;
                            }
                        } else if self.parse.reads_ahead {
                            let is_ready = (self.n.at(opening) & 0xff) == k::Ready;
                            let name = if is_ready {
                                self.n.at(opening + 1) + 1
                            } else {
                                self.n.at(self.n.at(opening + 4) + 1)
                            };
                            let end = self.closing_tag_end(
                                tag_start,
                                name,
                                if is_ready {
                                    self.n.at(opening + 6)
                                } else {
                                    self.n.at(self.n.at(opening + 4) + 2) - name
                                },
                            );
                            if end != 0 {
                                closing = self.node0(
                                    k::Ready | (k::JSXClosingElement << SUB_SHIFT),
                                    tag_start,
                                    end,
                                );
                                self.set_pos(end);
                                break;
                            }
                        }
                    }
                    self.save();
                    let comments_before = self.lexer.c_count;
                    self.next_jsx_tag()?;
                    if self.lexer.tok == tk::Div {
                        self.next_jsx_tag()?;
                        if self.lexer.tok == tk::Gt {
                            closing =
                                self.node0(k::JSXClosingFragment, tag_start, self.lexer.tok_end);
                        } else {
                            let name = self.parse_jsx_element_name()?;
                            if self.lexer.tok != tk::Gt {
                                return Err(self.unexpected());
                            }
                            closing = self.node1(
                                k::JSXClosingElement,
                                tag_start,
                                self.lexer.tok_end,
                                name,
                            );
                        }
                        if if is_fragment {
                            (self.n.at(closing) & 0xff) != k::JSXClosingFragment
                        } else {
                            (self.n.at(closing) & 0xff) != k::JSXClosingElement
                                || !self.closes_jsx(opening, self.n.at(closing + 4))?
                        } {
                            return Err(self.fail(tag_start));
                        }
                        // a comment in the closing tag can break the opening one
                        if self.lexer.c_count != comments_before
                            && (self.n.at(opening) & 0xff) == k::Ready
                        {
                            return Err(self.redo());
                        }
                        break;
                    }
                    self.restore();
                    let v5 = self.parse_jsx_element(if after_empty {
                        JSX_CHILD_AFTER_EMPTY
                    } else {
                        JSX_CHILD
                    })?;
                    self.list_push(v5);
                    self.set_pos(self.lexer.pos);
                    after_empty = false;
                }
            }
            children = self.list_finish(mark);
        }
        self.parse.no_in = saved_no_in;
        return Ok(self.node2_l(
            (if is_fragment {
                k::JSXFragment
            } else {
                k::JSXElement
            }) | (if where_ == JSX_CHILD_AFTER_EMPTY {
                F_AFTER_EMPTY
            } else {
                0
            }),
            start,
            self.lexer.tok_end,
            opening,
            closing,
            children,
        ));
    }
}
