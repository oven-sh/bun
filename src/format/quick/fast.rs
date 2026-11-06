//! The short cut for simple statements.
//!
//! Half of the bytes of real TypeScript are statements that stand on one line and stay on one line: `import { a } from "b";`,
//! `const x = this.y.z(1);`, `expect(a.b()).toBe("c");`, `return x;`. For those the whole machinery (tokens, a tree, a doc with
//! groups, a layout that finds that every group fits) comes to the same as printing the statement flat. This file does that straight
//! from the bytes: it reads a statement of a small part of the language, and what it reads it has printed. There is no token, no node
//! but one (K.Ready), no doc but one text.
//!
//! What makes that right:
//!
//!   1. The statement starts a line, in a list of statements. So it starts a line in the output too.
//!   2. A doc without a forced break, and without a line outside of a group, is printed flat if it fits. Whether it fits is asked
//!      twice: here with the indentation that the statement has in the source, which is a guess, and in the printer with the real
//!      column (fitted() of doc.rs). If the guess was wrong, the file is formatted again without the short cut.
//!   3. Everything here is an "or else": whatever is not known to be printed flat the way it is written below is refused, and the parser
//!      reads the statement. That goes for syntax this file does not know, for comments, for anything beyond ASCII, for what Prettier
//!      breaks whether it fits or not (an array of objects, a chain of three calls with a function among the arguments, two functions
//!      as arguments ..) and for what it puts in parentheses that the source does not have (`a && b || c`, `await a || b`, `a as B ? c : d`).
//!
//! The text is the source itself if that is what would be printed. Otherwise the runs of the source that stay are copied to the generated
//! texts, with the changes between them: `'a'` to `"a"`, `{a}` to `{ a }`, `x => y` to `(x) => y`, blanks.

use crate::ast::{
    F_ANY_WIDTH, F_DECIDED, F_EXTRA, F_NEXT_LINE_EMPTY, F_NEXT_LINE_KNOWN, F_SHORTHAND, k,
};
use crate::lexer::{KW_LENGTHS, kw, tk};
use crate::options::{QUOTE_PROPS_AS_NEEDED, TRAILING_COMMA_ALL, TRAILING_COMMA_NONE};
use crate::parse::core::{SCOPE_DERIVED_CONSTRUCTOR, SCOPE_FUNCTION, SCOPE_TOP};
use crate::{Bytes, Quick, R, Words, bytes_before, div, where_byte_is, where_not_printable};

pub(crate) struct Fast {
    // ---- what read_statement() found
    /// the kind of node the parser would have made
    pub(crate) ready_kind: i32,
    /// where that node would end
    pub(crate) ready_end: i32,
    /// where the lexer goes on
    pub(crate) ready_next: i32,
    pub(crate) ready_text: i32,
    pub(crate) ready_length: i32,
    /// for the head of the node: what those around it will ask
    pub(crate) ready_flags: i32,
    /// The text is the source itself, and it is indented by as many blanks as the lists around it make for. (Behind a block: the text is the source itself.)
    pub(crate) ready_stands: bool,
    /// The text can have line breaks in it, each with the indentation behind it that goes with ready_column. This is how long its last line is, without the indentation.
    pub(crate) ready_last_length: i32,
    /// A statement can hold a block, or several: `it("a", () => { .. });`, `function f() { .. }`, `if (a) { .. } else { .. }`. Then this file reads
    /// what stands before, between and behind the blocks, and the parser reads the blocks (K.ReadyWrap). ready_block is where the `{` of the
    /// next block stands, or 0; the text ends in front of it. Behind the block read_after_block() goes on, with ready_pending and ready_column.
    /// An object whose first key stands on a new line is broken whatever its width, and where a function would be hugged it is, too: `f(a, {`, `const a = {`, `return {`.
    pub(crate) ready_block: i32,
    pub(crate) ready_block_flags: i32,
    pub(crate) ready_pending: i32,
    pub(crate) ready_column: i32,
    /// What stands.rs has found out about the start of the window that starts at verified_start: up to verified_end, the end of a line, it is printed as it stands. The parser goes on from there.
    pub(crate) verified_start: i32,
    pub(crate) verified_end: i32,
    pub(crate) why: i32,
    // ---- the statement at hand
    /// TypeScript
    pub(crate) ts: bool,
    pub(crate) flow: bool,
    /// one of the two
    pub(crate) has_types: bool,
    pub(crate) await_is_operator: bool,
    /// no token may start behind this
    pub(crate) limit: i32,
    /// the source from here on is still to be copied
    pub(crate) run: i32,
    /// the end of the generated text; 0 while the text is the source itself
    pub(crate) out: i32,
    pub(crate) too_long: bool,
    /// what is read is a member of a class
    pub(crate) in_class: bool,
    /// how many are open
    pub(crate) argument_lists: i32,
    pub(crate) saw_less: i32,
    /// not 0: a block that opens here is not the last thing of the statement but for closing parentheses
    pub(crate) no_block: i32,
    /// where the `{` stands at which the reading stopped
    pub(crate) opened: i32,
    pub(crate) opened_flags: i32,
    /// how many lists of arguments were open there
    pub(crate) pending_parens: i32,
    pub(crate) tail: i32,
    pub(crate) shape: i32,
    /// the last chain() can stand on the left of `=`
    pub(crate) assignable: bool,
    /// From which `depth` on is_simple_call_argument(expression, depth) of print/call.rs holds for the last expression; NEVER if for none.
    pub(crate) level: i32,
    /// the highest level among the last list of arguments, 0 if there are none
    pub(crate) arguments_level: i32,
    pub(crate) arguments_count: i32,
    /// The word at the start of the statement, which was looked at to find out what the statement is.
    pub(crate) scanned_at: i32,
    pub(crate) scanned_end: i32,
    pub(crate) scanned_keyword: i32,
    /// of the last list of arguments
    pub(crate) arguments_are_simple: bool,
    pub(crate) arguments_have_function: bool,
    // ---- Texts of more than one line. Only where the parser says that the printer can take them: see standing() of doc.rs.
    pub(crate) may_break_lines: bool,
    /// .. and the item at hand is indented in the source as the lists around it say: where its lines are broken depends on the column, so that has to be beyond doubt
    pub(crate) breaks_here: bool,
    /// how many the text has so far
    pub(crate) line_breaks: i32,
    /// by how much the line at hand is indented
    pub(crate) line_column: i32,
    /// width_up_to() where that line starts, behind its indentation
    pub(crate) line_from: i32,
    /// Where an operand starts whose calls can have their arguments on lines of their own: the whole expression of a statement, the value of a declaration or an assignment, an argument that stands
    /// on a line of its own.
    pub(crate) breakable_at: i32,
    /// that operand stands behind `=`
    pub(crate) is_value: bool,
    /// how many lists of arguments have been read that way
    pub(crate) broken_lists: i32,
    /// How many bytes follow the operand at breakable_at on its line at least: the `;` of the statement, the `,` of an argument; nothing behind the last argument of a list without a comma at its end.
    pub(crate) follow: i32,
    /// one of them, in the value behind `=`, is a single short argument
    pub(crate) has_lone_short_argument: bool,
    /// Parameters on lines of their own: by how many columns what follows the `)`, to the end of the head of the function, has to be wider for the head not to fit on one line; -1 if that is settled.
    pub(crate) parameters_need: i32,
    /// width_up_to() behind the `)`
    pub(crate) parameters_from: i32,
    pub(crate) parameters_count: i32,
    pub(crate) saw_function_type: bool,
    /// Whoever calls parameters() for the head of a function whose parameters can stand on lines of their own sets this.
    pub(crate) parameters_may_break: bool,
    /// What broken_arguments() leaves for chain(): by how many columns what follows the `)`, up to the next place where the line can end, has to be wider for the list not to fit on one line.
    pub(crate) rest_needed: i32,
    /// how many the statement has had so far
    pub(crate) templates: i32,
    /// not 0: a template in this place may be code in another language
    pub(crate) no_templates: i32,
    pub(crate) template_level: i32,
    pub(crate) list_count: i32,
    /// of `{ a, b }` on one line
    pub(crate) list_width: i32,
    /// width_up_to() behind the `}`
    pub(crate) width_at_list_end: i32,
    /// of a property: the level of its value
    pub(crate) ready_level: i32,
    pub(crate) await_in_list: bool,
    /// The indentation that the lists around the item make for, as far as the parser can tell.
    pub(crate) least_column: i32,
    /// By how many columns the source is indented per level; 0 as long as that is not known.
    pub(crate) source_unit: i32,
    /// what is looked at stands one level down, though no list says so
    pub(crate) is_one_level_down: bool,
    /// how many blanks stand in front of the item on its line; -1 if there are tabs
    pub(crate) source_indent: i32,
    /// Where read_next_statement() found a statement, whether it could read it or not.
    pub(crate) ready_start: i32,
    pub(crate) comments_start: i32,
    pub(crate) comments_last_length: i32,
    /// how many columns there are for the text
    pub(crate) room: i32,
    pub(crate) column: i32,
    /// of the name of the element, which starts behind the `<`
    pub(crate) ready_name_length: i32,
    /// where the tag that read_jsx_tag() looked at last will stand, if it starts a line and its attributes can be read; else -1
    pub(crate) ready_tag_column: i32,
    pub(crate) attribute_count: i32,
    /// of the last one: F_SHORTHAND if its value is a string, F_EXTRA if there is an expression in it
    pub(crate) attribute_flags: i32,
    /// how many arrow functions with an element for a body have been read among the arguments of calls
    pub(crate) arrows_to_jsx: i32,
    pub(crate) jsx_is_on: bool,
    /// not 0: what is read is the default value of a parameter, where `await` and `super` are not what they are around the function
    pub(crate) in_parameters: i32,
    /// `export { if }`: `from` has to follow
    pub(crate) needs_from: bool,
}
impl Fast {
    pub(crate) fn new() -> Self {
        Self {
            ready_kind: 0,
            ready_end: 0,
            ready_next: 0,
            ready_text: 0,
            ready_length: 0,
            ready_flags: 0,
            ready_stands: false,
            ready_last_length: 0,
            ready_block: 0,
            ready_block_flags: 0,
            ready_pending: 0,
            ready_column: 0,
            verified_start: 0,
            verified_end: 0,
            why: 0,
            ts: false,
            flow: false,
            has_types: false,
            await_is_operator: false,
            limit: 0,
            run: 0,
            out: 0,
            too_long: false,
            in_class: false,
            argument_lists: 0,
            saw_less: 0,
            no_block: 0,
            opened: 0,
            opened_flags: 0,
            pending_parens: 0,
            tail: 0,
            shape: 0,
            assignable: false,
            level: 0,
            arguments_level: 0,
            arguments_count: 0,
            scanned_at: 0,
            scanned_end: 0,
            scanned_keyword: 0,
            arguments_are_simple: false,
            arguments_have_function: false,
            may_break_lines: false,
            breaks_here: false,
            line_breaks: 0,
            line_column: 0,
            line_from: 0,
            breakable_at: 0,
            is_value: false,
            broken_lists: 0,
            follow: 1,
            has_lone_short_argument: false,
            parameters_need: -1,
            parameters_from: 0,
            parameters_count: 0,
            saw_function_type: false,
            parameters_may_break: false,
            rest_needed: 0,
            templates: 0,
            no_templates: 0,
            template_level: 0,
            list_count: 0,
            list_width: 0,
            width_at_list_end: 0,
            ready_level: 0,
            await_in_list: false,
            least_column: 0,
            source_unit: 0,
            is_one_level_down: false,
            source_indent: 0,
            ready_start: 0,
            comments_start: 0,
            comments_last_length: 0,
            room: 0,
            column: 0,
            ready_name_length: 0,
            ready_tag_column: -1,
            attribute_count: 0,
            attribute_flags: 0,
            arrows_to_jsx: 0,
            jsx_is_on: false,
            in_parameters: 0,
            needs_from: false,
        }
    }
}

pub(crate) const ID_START: i32 = 1;
pub(crate) const ID_PART: i32 = 2;
pub(crate) const DIGIT: i32 = 4;
/// a byte that goes on a name in a way this file does not read: beyond ASCII, a backslash
pub(crate) const BEYOND: i32 = 8;
/// what can hang on to a name, or make something else of it: . ( [ ? ! < ` = and a blank
pub(crate) const HANGS_ON: i32 = 16;
/// what ends an expression for sure: ) , ; ] } : and the end of the line
pub(crate) const ENDS: i32 = 32;
/// what unary() looks at: ! ~ + -, and the first letters of await, delete, typeof and void
pub(crate) const OPERATOR_START: i32 = 64;
/// @ #
pub(crate) const MEMBER_START: i32 = 128;
pub(crate) const QUOTE: i32 = 256;
pub(crate) static CC: [u16; 256] = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 16, 32, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 16, 80, 256, 128, 3, 0, 0, 256, 16, 32, 0, 64, 32, 64, 16, 0, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
    32, 32, 16, 16, 0, 16, 128, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3,
    3, 3, 3, 3, 16, 8, 32, 0, 3, 16, 67, 3, 3, 67, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 67,
    3, 67, 3, 3, 3, 3, 0, 0, 32, 64, 0, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8,
    8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8,
    8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8,
    8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8,
    8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8,
];
pub(crate) static SECOND_LETTER: [u8; 128] = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 119, 0, 0, 101, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 121, 0, 111, 0, 0, 0, 0, 0, 0,
    0, 0, 0,
];
// 1 for what ends the plain part of a string: quotes, the backslash, whatever is not printable ASCII
pub(crate) static STRING_STOP: [u8; 256] = [
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
];
pub(crate) const BLOCK_FUNCTION: i32 = 1;
pub(crate) const BLOCK_ASYNC: i32 = 2;
/// not a block: an object that is broken because its first key stands on a new line
pub(crate) const BLOCK_OBJECT: i32 = 4;
/// the body of a class
pub(crate) const BLOCK_CLASS: i32 = 16;
/// of an interface
pub(crate) const BLOCK_INTERFACE: i32 = 32;
/// no block: `(`, an element on lines of its own, `)`. See open_jsx().
pub(crate) const BLOCK_JSX: i32 = 8;
/// with BLOCK_FUNCTION: of an arrow function
pub(crate) const BLOCK_ARROW: i32 = 64;
/// with BLOCK_FUNCTION: of the constructor of a class
pub(crate) const BLOCK_CONSTRUCTOR: i32 = 128;
/// with BLOCK_CLASS: the class has a superclass
pub(crate) const BLOCK_DERIVED: i32 = 256;
impl Quick {
    pub(crate) fn set_verified(&mut self, start: i32, end: i32) {
        self.fast.verified_start = start;
        self.fast.verified_end = end;
    }
}
// ---- why statements are refused
#[allow(non_upper_case_globals)]
pub(crate) mod refusal {
    pub(crate) const NotAtLineStart: i32 = 1;
    pub(crate) const Narrow: i32 = 2;
    pub(crate) const Start: i32 = 3;
    pub(crate) const Long: i32 = 4;
    pub(crate) const Wide: i32 = 5;
    pub(crate) const NotAscii: i32 = 6;
    pub(crate) const Word: i32 = 7;
    pub(crate) const Operand: i32 = 8;
    pub(crate) const Paren: i32 = 9;
    pub(crate) const Block: i32 = 10;
    pub(crate) const ArrowInside: i32 = 11;
    pub(crate) const ArrowBody: i32 = 12;
    pub(crate) const Template: i32 = 13;
    pub(crate) const Number: i32 = 14;
    pub(crate) const String: i32 = 15;
    pub(crate) const Member: i32 = 16;
    pub(crate) const Less: i32 = 17;
    pub(crate) const Chain: i32 = 18;
    pub(crate) const New: i32 = 19;
    pub(crate) const Arguments: i32 = 20;
    pub(crate) const Spread: i32 = 21;
    pub(crate) const Array: i32 = 22;
    pub(crate) const ArrayBreaks: i32 = 23;
    pub(crate) const Object: i32 = 24;
    pub(crate) const Key: i32 = 25;
    pub(crate) const Unary: i32 = 26;
    pub(crate) const Await: i32 = 27;
    pub(crate) const Update: i32 = 28;
    pub(crate) const Mixed: i32 = 29;
    pub(crate) const As: i32 = 30;
    pub(crate) const Conditional: i32 = 31;
    pub(crate) const Target: i32 = 32;
    pub(crate) const End: i32 = 33;
    pub(crate) const NoSemicolon: i32 = 34;
    pub(crate) const Binding: i32 = 35;
    pub(crate) const Pattern: i32 = 36;
    pub(crate) const Type: i32 = 37;
    pub(crate) const TypeWord: i32 = 38;
    pub(crate) const TypeArguments: i32 = 39;
    pub(crate) const ObjectType: i32 = 40;
    pub(crate) const FunctionType: i32 = 41;
    pub(crate) const Import: i32 = 42;
    pub(crate) const Export: i32 = 43;
    pub(crate) const Declaration: i32 = 44;
    pub(crate) const Jsx: i32 = 45;
    pub(crate) const JsxText: i32 = 46;
    pub(crate) const JsxBreaks: i32 = 47;
}
impl Quick {
    #[cold]
    #[inline(never)]
    pub(crate) fn no(&mut self, reason: i32) -> i32 {
        if self.fast.why == 0 {
            self.fast.why = reason;
        }
        return -1;
    }
}
// what has to follow the block
/// nothing: a declaration of a function, a loop
pub(crate) const TAIL_NONE: i32 = 0;
/// the parentheses, and the end of a statement
pub(crate) const TAIL_STATEMENT: i32 = 1;
/// `else`, or nothing
pub(crate) const TAIL_IF: i32 = 2;
/// `catch` or `finally`
pub(crate) const TAIL_TRY: i32 = 3;
/// `finally`, or nothing
pub(crate) const TAIL_CATCH: i32 = 4;
/// the same as TAIL_STATEMENT for a property of a class, whose end counts the semicolon in
pub(crate) const TAIL_MEMBER: i32 = 5;
// What the last expression was.
pub(crate) const SH_NAME: i32 = 1;
pub(crate) const SH_THIS: i32 = 2;
pub(crate) const SH_LITERAL: i32 = 3;
/// up to here: is_simple_call_argument(), whatever the depth
pub(crate) const SH_MEMBER: i32 = 4;
pub(crate) const SH_CHAIN: i32 = 5;
pub(crate) const SH_NEW: i32 = 6;
pub(crate) const SH_ARRAY: i32 = 7;
/// up to here: can stand behind `...`
pub(crate) const SH_OBJECT: i32 = 8;
pub(crate) const SH_UNARY: i32 = 9;
pub(crate) const SH_UPDATE: i32 = 10;
pub(crate) const SH_AWAIT: i32 = 11;
pub(crate) const SH_BINARY: i32 = 12;
pub(crate) const SH_NULLISH: i32 = 13;
pub(crate) const SH_AS: i32 = 14;
pub(crate) const SH_CONDITIONAL: i32 = 15;
pub(crate) const SH_ARROW: i32 = 16;
pub(crate) const SH_JSX: i32 = 17;
pub(crate) const NEVER: i32 = 100;
impl Quick {
    // ------------------------------------------------------------------------------------------------------------ changes
    /// Copies the source up to `p`.
    #[inline]
    pub(crate) fn flush(&mut self, p: i32) {
        let from = self.fast.run;
        let mut n = p - from;
        let mut o = self.fast.out;
        if o == 0 {
            o = self.text.gen_pos;
        }
        if p > self.fast.limit + 8 {
            // a token of any length can stand at the limit; the room that was reserved is for a line
            self.fast.too_long = true;
            n = 0;
        }
        // sixteen bytes at a time and up to 31 too many, as in the printer
        self.t.put_u128(o, self.t.u128_at(from));
        self.t.put_u128(o + 16, self.t.u128_at(from + 16));
        let mut k: i32 = 32;
        while k < n {
            self.t.put_u128(o + k, self.t.u128_at(from + k));
            k += 16;
        }
        self.fast.out = o + n;
        self.fast.run = p;
    }

    pub(crate) fn put(&mut self, c: i32) {
        self.t.put(self.fast.out, c);
        self.fast.out += 1;
    }

    /// The `{` of the body of a function stands at `brace`, and fast.rs has read the head. Are the parameters more than names? (Yes if that is not seen at a glance.)
    #[cold]
    pub(crate) fn has_odd_parameters(&self, brace: i32) -> bool {
        let mut p = self.blanks_back(brace);
        let is_arrow = self.t.at(p - 1) == 62 && self.t.at(p - 2) == 61;
        if is_arrow {
            p = self.blanks_back(p - 2);
        }
        if self.t.at(p - 1) != 41 {
            // `a => {`; with types, the end of the type of what is returned
            return !is_arrow || self.fast.has_types;
        }
        let mut depth: i32 = 0;
        loop {
            p -= 1;
            match self.t.at(p) {
                41 => {
                    depth += 1;
                }
                40 => {
                    depth -= 1;
                    if depth == 0 {
                        return false;
                    }
                }
                // a default value, a pattern, `...`, a text in which anything can stand; the start of the text
                61 | 123 | 91 | 46 | 34 | 39 | 96 | 0 => {
                    return true;
                }
                _ => {}
            }
        }
    }

    /// Where the blanks in front of p start.
    pub(crate) fn blanks_back(&self, mut p: i32) -> i32 {
        while self.t.at(p - 1) == 32 || self.t.at(p - 1) == 9 {
            p -= 1;
        }
        return p;
    }

    pub(crate) fn blanks(&self, mut p: i32) -> i32 {
        while self.t.at(p) == 32 || self.t.at(p) == 9 {
            p += 1;
        }
        return p;
    }

    /// Nothing is printed between the tokens around `p`. Returns where the next one starts.
    #[inline]
    pub(crate) fn tight(&mut self, p: i32) -> i32 {
        let c = self.t.at(p);
        if c != 32 && c != 9 {
            return p;
        }
        self.drop_blanks(p)
    }

    #[inline(never)]
    fn drop_blanks(&mut self, p: i32) -> i32 {
        let q = self.blanks(p);
        self.flush(p);
        self.fast.run = q;
        return q;
    }

    /// One blank is printed between the tokens around `p`.
    #[inline]
    pub(crate) fn spaced(&mut self, p: i32) -> i32 {
        if self.t.at(p) == 32 {
            let c = self.t.at(p + 1);
            if c != 32 && c != 9 {
                return p + 1;
            }
        }
        self.put_one_blank(p)
    }

    #[inline(never)]
    fn put_one_blank(&mut self, p: i32) -> i32 {
        let q = self.blanks(p);
        self.flush(p);
        self.put(32);
        self.fast.run = q;
        return q;
    }

    pub(crate) fn set_may_break_lines(&mut self, value: bool) {
        self.fast.may_break_lines = value;
    }

    pub(crate) fn white(&self, mut p: i32) -> i32 {
        while self.t.at(p) == 32 || self.t.at(p) == 10 || self.t.at(p) == 9 {
            p += 1;
        }
        return p;
    }

    /// tight() where the source may have line breaks.
    pub(crate) fn tight_over(&mut self, p: i32) -> i32 {
        let q = self.white(p);
        if q != p {
            self.flush(p);
            self.fast.run = q;
        }
        return q;
    }

    /// spaced() where the source may have line breaks.
    pub(crate) fn spaced_over(&mut self, p: i32) -> i32 {
        let q = self.white(p);
        if q != p + 1 || self.t.at(p) != 32 {
            self.flush(p);
            self.put(32);
            self.fast.run = q;
        }
        return q;
    }

    /// A line break and `indentation` blanks are printed between the tokens around p.
    pub(crate) fn line_break(&mut self, p: i32, indentation: i32) -> i32 {
        let q = self.white(p);
        self.fast.line_breaks += 1;
        if self.t.at(p) == 10 && q - p == indentation + 1 {
            // (nothing but blanks behind the line break?)
            let mut r = p + 1;
            r = self.blanks_end(r);
            if r == q {
                return q;
            }
        }
        // (the room for generated texts that was reserved is 2048 bytes, and whoever calls this looks every 1400)
        if indentation > 256 {
            self.fast.too_long = true;
            return q;
        }
        self.flush(p);
        self.put(10);
        let mut i: i32 = 0;
        while i < indentation {
            self.put(32);
            i += 1;
        }
        self.fast.run = q;
        return q;
    }

    /// How wide the text is up to p.
    pub(crate) fn width_up_to(&self, p: i32) -> i32 {
        return if self.fast.out == 0 {
            p - self.fast.run
        } else {
            self.fast.out - self.text.gen_pos + p - self.fast.run
        };
    }

    /// What is printed behind a `{` and in front of a `}`: a blank, or with `bracketSpacing: false` nothing.
    pub(crate) fn in_brace(&mut self, p: i32) -> i32 {
        return if self.options.bracket_spacing {
            self.spaced(p)
        } else {
            self.tight(p)
        };
    }

    pub(crate) fn word_end(&self, mut p: i32) -> i32 {
        p = self.name_end(p);
        return p;
    }

    /// Does one of the letters U+0100 to U+02BF stand at p? All of them can start a name, and none is wider than its two bytes.
    pub(crate) fn is_latin_letter(&self, p: i32) -> bool {
        return self.t.at(p) >= 0xc4 && self.t.at(p) <= 0xca && (self.t.at(p + 1) & 0xc0) == 0x80;
    }

    /// word_end() for a name that may hold such letters (`ɵfac`). The text is measured in bytes, so it is taken for wider than it is, which does no harm.
    pub(crate) fn latin_word_end(&self, mut p: i32) -> i32 {
        loop {
            p = self.word_end(p);
            if !self.is_latin_letter(p) {
                return p;
            }
            p += 2;
        }
    }

    /// Is the word `text` at p, and ends there?
    pub(crate) fn word_is(&self, p: i32, text: &[u8]) -> bool {
        let end = p + text.len() as i32;
        return self.text_is(p, end, text) && (CC.at(self.t.at(end)) & (ID_PART | BEYOND)) == 0;
    }

    // ----------------------------------------------------------------------------------------------------------- literals
    #[inline]
    pub(crate) fn number(&mut self, p: i32) -> i32 {
        let mut q = p;
        if self.t.at(q) == 48 {
            q += 1;
            if (CC.at(self.t.at(q)) & DIGIT) != 0 {
                return self.no(refusal::Number);
            }
        } else {
            while (CC.at(self.t.at(q)) & DIGIT) != 0 {
                q += 1;
            }
        }
        if self.t.at(q) == 46 {
            if (CC.at(self.t.at(q + 1)) & DIGIT) == 0 {
                return self.no(refusal::Number);
            }
            q += 2;
            while (CC.at(self.t.at(q)) & DIGIT) != 0 {
                q += 1;
            }
            if self.t.at(q - 1) == 48 {
                return self.no(refusal::Number);
            }
        }
        // 1n, 1e5, 0x10, 1_000, 1.5.x
        if (CC.at(self.t.at(q)) & (ID_PART | BEYOND)) != 0 || self.t.at(q) == 46 {
            return self.no(refusal::Number);
        }
        return q;
    }

    /// A string without a backslash. It gets the quotes that are preferred unless it holds one of them.
    pub(crate) fn string(&mut self, p: i32) -> i32 {
        let end = self.fast.limit;
        let quote = self.t.at(p);
        let mut q = p + 1;
        let mut other = false;
        loop {
            // up to a quote, a backslash, or what is not printable ASCII
            loop {
                let v = self.t.u128_at(q);
                let stops = where_not_printable(v)
                    | where_byte_is(v, b'"')
                    | where_byte_is(v, b'\'')
                    | where_byte_is(v, b'\\');
                if stops != 0 {
                    q += bytes_before(stops);
                    break;
                }
                q += 16;
            }
            if q > end {
                return self.no(refusal::Long);
            }
            let c = self.t.at(q);
            if c == quote {
                break;
            }
            if c != 34 && c != 39 {
                return self.no(if q >= end {
                    refusal::Long
                } else {
                    refusal::String
                });
            }
            other = true;
            q += 1;
        }
        let preferred = if self.options.single_quote { 39 } else { 34 };
        if quote != preferred && !other {
            self.flush(p);
            self.put(preferred);
            self.fast.run = p + 1;
            self.flush(q);
            self.put(preferred);
            self.fast.run = q + 1;
        }
        return q + 1;
    }
}
// -------------------------------------------------------------------------------------------------------------- types
pub(crate) const TW_PLAIN: i32 = 0;
pub(crate) const TW_OPERATOR: i32 = 1;
pub(crate) const TW_REFUSED: i32 = 2;
impl Quick {
    /// The words that are not the name of a type where a type starts.
    pub(crate) fn type_word(&self, p: i32, length: i32) -> i32 {
        if self.fast.flow {
            return if self.flow_type_word(p, length) {
                TW_REFUSED
            } else {
                TW_PLAIN
            };
        }
        // a e i k r u y
        let c = self.t.at(p);
        if c < 97 || (0x01120511_i32.wrapping_shr((c - 97) as u32) & 1) == 0 {
            return TW_PLAIN;
        }
        match c {
            107 => {
                return if length == 5 && self.text_is(p, p + 5, b"keyof") {
                    TW_OPERATOR
                } else {
                    TW_PLAIN
                };
            }
            114 => {
                return if length == 8 && self.text_is(p, p + 8, b"readonly") {
                    TW_OPERATOR
                } else {
                    TW_PLAIN
                };
            }
            117 => {
                return if length == 6 && self.text_is(p, p + 6, b"unique") {
                    TW_REFUSED
                } else {
                    TW_PLAIN
                };
            }
            105 => {
                return if (length == 5 && self.text_is(p, p + 5, b"infer"))
                    || (length == 9 && self.text_is(p, p + 9, b"intrinsic"))
                {
                    TW_REFUSED
                } else {
                    TW_PLAIN
                };
            }
            101 => {
                return if length == 4 && self.text_is(p, p + 4, b"enum") {
                    TW_REFUSED
                } else {
                    TW_PLAIN
                };
            }
            121 => {
                return if length == 5 && self.text_is(p, p + 5, b"yield") {
                    TW_REFUSED
                } else {
                    TW_PLAIN
                };
            }
            97 => {
                return if (length == 7 && self.text_is(p, p + 7, b"asserts"))
                    || (length == 8 && self.text_is(p, p + 8, b"abstract"))
                    || (length == 5 && self.text_is(p, p + 5, b"await"))
                {
                    TW_REFUSED
                } else {
                    TW_PLAIN
                };
            }
            _ => {}
        }
        return TW_PLAIN;
    }

    /// The same for Flow, with whatever might be one in some version of it.
    pub(crate) fn flow_type_word(&self, p: i32, length: i32) -> bool {
        let e = p + length;
        match length {
            4 => {
                // printed as `boolean`
                return self.text_is(p, e, b"hook") || self.text_is(p, e, b"bool");
            }
            5 => {
                return self.text_is(p, e, b"keyof")
                    || self.text_is(p, e, b"infer")
                    || self.text_is(p, e, b"proto");
            }
            6 => {
                return self.text_is(p, e, b"static")
                    || self.text_is(p, e, b"opaque")
                    || self.text_is(p, e, b"unique");
            }
            7 => {
                return self.text_is(p, e, b"renders")
                    || self.text_is(p, e, b"implies")
                    || self.text_is(p, e, b"asserts")
                    || self.text_is(p, e, b"declare");
            }
            8 => {
                return self.text_is(p, e, b"readonly") || self.text_is(p, e, b"abstract");
            }
            9 => {
                return self.text_is(p, e, b"component")
                    || self.text_is(p, e, b"interface")
                    || self.text_is(p, e, b"writeonly");
            }
            _ => {}
        }
        return false;
    }

    /// `string`, `any` ..: they take no arguments.
    pub(crate) fn is_keyword_type(&self, p: i32, length: i32) -> bool {
        let e = p + length;
        match length {
            3 => {
                return self.text_is(p, e, b"any");
            }
            5 => {
                return self.text_is(p, e, b"never")
                    || (self.fast.flow
                        && (self.text_is(p, e, b"mixed") || self.text_is(p, e, b"empty")));
            }
            6 => {
                return self.text_is(p, e, b"string")
                    || self.text_is(p, e, b"number")
                    || self.text_is(p, e, b"object")
                    || self.text_is(p, e, b"symbol")
                    || self.text_is(p, e, b"bigint");
            }
            7 => {
                return self.text_is(p, e, b"boolean") || self.text_is(p, e, b"unknown");
            }
            9 => {
                return self.text_is(p, e, b"undefined");
            }
            _ => {}
        }
        return false;
    }

    /// `<A, B>`; p is at the `<`.
    pub(crate) fn type_arguments(&mut self, p: i32) -> R<i32> {
        let mut q = self.tight(p + 1);
        loop {
            q = self.type_(q)?;
            if q < 0 {
                return Ok(-1);
            }
            q = self.tight(q);
            let c = self.t.at(q);
            if c == 62 {
                return Ok(q + 1);
            }
            if c != 44 {
                return Ok(self.no(refusal::TypeArguments));
            }
            q = self.spaced(q + 1);
        }
    }

    /// `{ a: A; b?: B }`; p is at the `{`.
    pub(crate) fn object_type(&mut self, p: i32) -> R<i32> {
        if self.fast.flow {
            // commas, `{| |}`, `...`, and parentheses around it in the return type of an arrow function
            return Ok(self.no(refusal::ObjectType));
        }
        let mut q = self.blanks(p + 1);
        if self.t.at(q) == 125 {
            self.tight(p + 1);
            return Ok(q + 1);
        }
        q = self.in_brace(p + 1);
        loop {
            if (CC.at(self.t.at(q)) & ID_START) == 0 {
                return Ok(self.no(refusal::ObjectType));
            }
            let mut e = self.word_end(q);
            if e - q == 8
                && (self.t.at(e) == 32 || self.t.at(e) == 9)
                && self.text_is(q, e, b"readonly")
            {
                let name = self.blanks(e);
                if (CC.at(self.t.at(name)) & ID_START) != 0 {
                    q = self.spaced(e);
                    e = self.word_end(q);
                }
            }
            if (CC.at(self.t.at(e)) & BEYOND) != 0 {
                return Ok(self.no(refusal::NotAscii));
            }
            q = e;
            if self.t.at(q) == 63 {
                q += 1;
            }
            if self.t.at(q) != 58 {
                return Ok(self.no(refusal::ObjectType));
            }
            let v0 = self.spaced(q + 1);
            q = self.type_(v0)?;
            if q < 0 {
                return Ok(-1);
            }
            let s = self.blanks(q);
            let c = self.t.at(s);
            if c == 59 || c == 44 {
                let r = self.blanks(s + 1);
                if self.t.at(r) == 125 {
                    // no separator behind the last member
                    self.flush(q);
                    if self.options.bracket_spacing {
                        self.put(32);
                    }
                    self.fast.run = r;
                    return Ok(r + 1);
                }
                if c != 59 || s != q || r != q + 2 || self.t.at(q + 1) != 32 {
                    self.flush(q);
                    self.put(59);
                    self.put(32);
                    self.fast.run = r;
                }
                q = r;
            } else if c == 125 {
                return Ok(self.in_brace(q) + 1);
            } else {
                return Ok(self.no(refusal::ObjectType));
            }
        }
    }

    /// `(a: A, b?: B) => C`; p is at the `(`.
    pub(crate) fn function_type(&mut self, p: i32) -> R<i32> {
        self.fast.saw_function_type = true;
        let mut q = self.tight(p + 1);
        if self.fast.flow {
            q = self.flow_function_type_parameters(q)?;
        } else if self.t.at(q) != 41 {
            loop {
                if self.t.at(q) == 46 && self.t.at(q + 1) == 46 && self.t.at(q + 2) == 46 {
                    q += 3;
                }
                if (CC.at(self.t.at(q)) & ID_START) == 0 {
                    return Ok(self.no(refusal::FunctionType));
                }
                let e = self.word_end(q);
                if (CC.at(self.t.at(e)) & BEYOND) != 0 {
                    return Ok(self.no(refusal::NotAscii));
                }
                let kw = self.keyword_at(q, e - q);
                if kw != 0 && Self::is_word_of_language(kw) && (kw & 255) != tk::This {
                    return Ok(self.no(refusal::FunctionType));
                }
                // `this` has a type and nothing else; `...a?` is printed in a way of its own
                if ((kw & 255) == tk::This || self.t.at(q - 1) == 46)
                    && (self.t.at(e) == 63 || (kw & 255) == tk::This && self.t.at(q - 1) == 46)
                {
                    return Ok(self.no(refusal::FunctionType));
                }
                q = e;
                if self.t.at(q) == 63 {
                    q += 1;
                }
                if self.t.at(q) == 58 {
                    let v0 = self.spaced(q + 1);
                    q = self.type_(v0)?;
                    if q < 0 {
                        return Ok(-1);
                    }
                }
                q = self.tight(q);
                let c = self.t.at(q);
                if c == 41 {
                    break;
                }
                if c != 44 {
                    return Ok(self.no(refusal::FunctionType));
                }
                q = self.spaced(q + 1);
            }
        }
        if q < 0 {
            return Ok(-1);
        }
        q = self.spaced(q + 1);
        if self.t.at(q) != 61 || self.t.at(q + 1) != 62 {
            return Ok(self.no(refusal::FunctionType));
        }
        let v1 = self.spaced(q + 2);
        return self.type_(v1);
    }

    /// `a: A, b?: B` or `A, B` in Flow; q is behind the `(` and the blanks. Returns the place of the `)`.
    pub(crate) fn flow_function_type_parameters(&mut self, mut q: i32) -> R<i32> {
        if self.t.at(q) == 41 {
            return Ok(q);
        }
        let mut unnamed: i32 = 0;
        let mut count: i32 = 0;
        loop {
            count += 1;
            let mut named = false;
            if (CC.at(self.t.at(q)) & ID_START) != 0 {
                let mut e = self.word_end(q);
                if self.t.at(e) == 63 {
                    e += 1;
                }
                if self.t.at(e) == 58 {
                    if self.keyword_at(q, self.word_end(q) - q) != 0 {
                        return Ok(self.no(refusal::FunctionType));
                    }
                    named = true;
                    q = self.spaced(e + 1);
                }
            }
            if !named {
                // (a function type in this place has parentheses if one of its own parameters is `?A`)
                if self.t.at(q) == 40 {
                    return Ok(self.no(refusal::FunctionType));
                }
                unnamed += 1;
            }
            q = self.type_(q)?;
            if q < 0 {
                return Ok(-1);
            }
            q = self.tight(q);
            let c = self.t.at(q);
            if c == 41 {
                break;
            }
            if c != 44 {
                return Ok(self.no(refusal::FunctionType));
            }
            q = self.spaced(q + 1);
        }
        // `(A) => B` can lose its parentheses
        if count == 1 && unnamed == 1 && !self.options.arrow_parens_always {
            return Ok(self.no(refusal::FunctionType));
        }
        return Ok(q);
    }

    /// What can be a member of a union: a name with its arguments, a literal, `{ .. }`, `[ .. ]`, and `[]` or `[K]` behind any of these.
    pub(crate) fn postfix_type(&mut self, mut p: i32) -> R<i32> {
        self.stack()?;
        if p > self.fast.limit {
            return Ok(self.no(refusal::Long));
        }
        let mut c = self.t.at(p);
        let nullable = c == 63 && self.fast.flow;
        if nullable {
            // ?A
            p += 1;
            c = self.t.at(p);
            if (CC.at(c) & ID_START) == 0 {
                return Ok(self.no(refusal::Type));
            }
        }
        let mut q: i32;
        if (CC.at(c) & ID_START) != 0 {
            q = self.word_end(p);
            if (CC.at(self.t.at(q)) & BEYOND) != 0 {
                return Ok(self.no(refusal::NotAscii));
            }
            let kw = self.keyword_at(p, q - p) & 255;
            if kw > tk::Name {
                if kw == tk::Typeof {
                    // `typeof a.b`; with `[` behind it Prettier adds parentheses
                    if self.t.at(q) != 32 && self.t.at(q) != 9 {
                        return Ok(self.no(refusal::TypeWord));
                    }
                    q = self.spaced(q);
                    loop {
                        if (CC.at(self.t.at(q)) & ID_START) == 0 {
                            return Ok(self.no(refusal::TypeWord));
                        }
                        let e = self.word_end(q);
                        if (CC.at(self.t.at(e)) & BEYOND) != 0 {
                            return Ok(self.no(refusal::NotAscii));
                        }
                        if (self.keyword_at(q, e - q) & 255) > tk::Name && !(self.t.at(q - 1) == 46)
                        {
                            return Ok(self.no(refusal::TypeWord));
                        }
                        q = e;
                        if self.t.at(q) != 46 {
                            break;
                        }
                        q += 1;
                    }
                    if self.t.at(q) == 91 || self.t.at(q) == 60 {
                        return Ok(self.no(refusal::TypeWord));
                    }
                    return Ok(q);
                }
                if kw != tk::Void
                    && kw != tk::Null
                    && kw != tk::This
                    && kw != tk::True
                    && kw != tk::False
                {
                    return Ok(self.no(refusal::TypeWord));
                }
                if self.t.at(q) == 46 || self.t.at(q) == 60 {
                    return Ok(self.no(refusal::TypeWord));
                }
            } else {
                let w = self.type_word(p, q - p);
                if w != TW_PLAIN {
                    // as the name of a type only if nothing that starts a type follows
                    if w == TW_REFUSED || (self.t.at(q) != 32 && self.t.at(q) != 9) {
                        return Ok(self.no(refusal::TypeWord));
                    }
                    q = self.spaced(q);
                    // `keyof keyof A` gets parentheses
                    if self.type_word(q, self.word_end(q) - q) != TW_PLAIN {
                        return Ok(self.no(refusal::TypeWord));
                    }
                    return self.postfix_type(q);
                }
                let first = q;
                if self.fast.flow && self.t.at(q) == 46 && self.is_keyword_type(p, q - p) {
                    return Ok(self.no(refusal::TypeWord));
                }
                while self.t.at(q) == 46 {
                    if (CC.at(self.t.at(q + 1)) & ID_START) == 0 && !self.is_latin_letter(q + 1) {
                        return Ok(self.no(refusal::Type));
                    }
                    q = self.latin_word_end(q + 1);
                    if (CC.at(self.t.at(q)) & BEYOND) != 0 {
                        return Ok(self.no(refusal::NotAscii));
                    }
                }
                if self.t.at(q) == 60 {
                    if q == first && self.is_keyword_type(p, q - p) {
                        return Ok(self.no(refusal::TypeWord));
                    }
                    q = self.type_arguments(q)?;
                    if q < 0 {
                        return Ok(-1);
                    }
                }
            }
        } else if c == 34 || c == 39 {
            q = self.string(p);
            if q < 0 {
                return Ok(-1);
            }
        } else if (CC.at(c) & DIGIT) != 0 {
            q = self.number(p);
            if q < 0 {
                return Ok(-1);
            }
        } else if c == 45 && (CC.at(self.t.at(p + 1)) & DIGIT) != 0 {
            q = self.number(p + 1);
            if q < 0 {
                return Ok(-1);
            }
        } else if c == 123 {
            q = self.object_type(p)?;
            if q < 0 {
                return Ok(-1);
            }
        } else if c == 91 {
            q = self.tight(p + 1);
            if self.t.at(q) != 93 {
                loop {
                    // `-1`, `-a: A`
                    if self.t.at(q) == 45 {
                        return Ok(self.no(refusal::Type));
                    }
                    q = self.type_(q)?;
                    if q < 0 {
                        return Ok(-1);
                    }
                    q = self.tight(q);
                    let d = self.t.at(q);
                    if d == 93 {
                        break;
                    }
                    if d != 44 {
                        // `a: A`, `A?`
                        return Ok(self.no(refusal::Type));
                    }
                    q = self.spaced(q + 1);
                }
            }
            q += 1;
        } else {
            return Ok(self.no(refusal::Type));
        }
        if nullable && self.t.at(q) == 91 {
            // ?(A[])
            return Ok(self.no(refusal::Type));
        }
        while self.t.at(q) == 91 {
            if self.t.at(q + 1) == 93 {
                q += 2;
                continue;
            }
            let v0 = self.tight(q + 1);
            q = self.type_(v0)?;
            if q < 0 {
                return Ok(-1);
            }
            q = self.tight(q);
            if self.t.at(q) != 93 {
                return Ok(self.no(refusal::Type));
            }
            q += 1;
        }
        return Ok(q);
    }

    pub(crate) fn type_(&mut self, p: i32) -> R<i32> {
        self.stack()?;
        if self.t.at(p) == 40 {
            return self.function_type(p);
        }
        let mut q = self.postfix_type(p)?;
        if q < 0 {
            return Ok(-1);
        }
        let mut separator: i32 = 0;
        loop {
            let r = self.blanks(q);
            let c = self.t.at(r);
            if (c != 124 && c != 38) || self.t.at(r + 1) == c || self.t.at(r + 1) == 61 {
                return Ok(q);
            }
            // an intersection in a union gets parentheses
            if separator != 0 && separator != c {
                return Ok(self.no(refusal::Type));
            }
            separator = c;
            self.spaced(q);
            let v0 = self.spaced(r + 1);
            q = self.postfix_type(v0)?;
            if q < 0 {
                return Ok(-1);
            }
        }
    }
}
// -------------------------------------------------------------------------------------------------------- expressions
/// A name that can be read or bound like any other. `kw` is what keyword_at() says.
pub(crate) fn is_plain_name(kw: i32) -> bool {
    if kw == 0 {
        return true;
    }
    if (kw & 255) != tk::Name {
        return false;
    }
    match kw >> 8 {
        kw::Get | kw::Set | kw::From | kw::Defer | kw::Source | kw::Target | kw::Meta => {
            return true;
        }
        _ => {}
    }
    return false;
}

impl Quick {
    /// The `{` at q starts a block that the parser will read. Everybody returns at once, up to read_statement().
    pub(crate) fn open_block(&mut self, q: i32, flags: i32) -> i32 {
        if self.fast.no_block != 0 {
            return self.no(refusal::Block);
        }
        // it(`..`, () => { is a call of a test, too
        if self.fast.templates != 0 {
            return self.no(refusal::Template);
        }
        // With nothing in it, it is printed as `{}`, and nothing forces a line break.
        let mut r = q + 1;
        while self.t.at(r) == 32 || self.t.at(r) == 9 || self.t.at(r) == 10 {
            r += 1;
        }
        // (or with other white space in it, which is not looked through here)
        if self.t.at(r) == 125 || self.t.at(r) == 59 || self.t.at(r) < 32 || self.t.at(r) >= 128 {
            return self.no(refusal::Block);
        }
        self.fast.opened = q;
        self.fast.opened_flags = flags;
        return q;
    }

    /// Does `(`, the end of the line and an element stand at q?
    pub(crate) fn is_jsx_in_parens(&self, q: i32) -> bool {
        if self.t.at(q) != 40 || self.t.at(q + 1) != 10 {
            return false;
        }
        let mut r = q + 2;
        r = self.blank_lines_end(r);
        return self.t.at(r) == 60;
    }

    /// An element in parentheses stands at q, in a place where the element is printed with parentheses of its own if it breaks, and nothing else can break but
    /// what stands before it. The parser will read it like a block. `flags`: BLOCK_FUNCTION, BLOCK_ASYNC if it is the body of a function.
    pub(crate) fn open_jsx(&mut self, q: i32, flags: i32) -> i32 {
        if self.fast.no_block != 0 || self.fast.argument_lists != 0 || !self.fast.jsx_is_on {
            return self.no(refusal::Paren);
        }
        let mut r = q + 2;
        r = self.blank_lines_end(r);
        if self.t.at(r + 1) == 62 {
            let mut s = r + 2;
            s = self.blank_lines_end(s);
            if self.t.at(s) == 40 {
                return self.no(refusal::Less);
            }
        } else {
            // not what may be the type parameters of a function: `<A,>`, `<A extends B>`, `<A = B>`, `<const A>`, `<A>(`, and above `<>(`
            let mut e = self.jsx_word(r + 1);
            while e >= 0 && self.t.at(e) == 46 {
                e = self.jsx_word(e + 1);
            }
            if e < 0 {
                return -1;
            }
            let c = self.t.at(e);
            if c != 62 && c != 32 && c != 10 && c != 47 {
                return self.no(refusal::Less);
            }
            let mut s = if c == 62 { e + 1 } else { e };
            s = self.blank_lines_end(s);
            if if c == 62 {
                self.t.at(s) == 40 || (self.fast.flow && !self.is_plain_behind_type_parameters(s))
            } else {
                self.t.at(s) == 61 || self.word_is(s, b"extends") || self.word_is(r + 1, b"const")
            } {
                return self.no(refusal::Less);
            }
        }
        self.fast.opened = q;
        self.fast.opened_flags = BLOCK_JSX | flags;
        return q;
    }

    /// The body of an arrow function; p is behind the `=>`.
    pub(crate) fn arrow_body(&mut self, p: i32, is_async: bool) -> R<i32> {
        let mut q = self.spaced(p);
        if self.t.at(q) == 40 && self.is_jsx_in_parens(q) {
            return Ok(self.open_jsx(
                q,
                if is_async {
                    BLOCK_FUNCTION | BLOCK_ARROW | BLOCK_ASYNC
                } else {
                    BLOCK_FUNCTION | BLOCK_ARROW
                },
            ));
        }
        if self.t.at(q) == 123 {
            let r = self.blanks(q + 1);
            if self.t.at(r) != 125 {
                return Ok(self.open_block(
                    q,
                    if is_async {
                        BLOCK_FUNCTION | BLOCK_ARROW | BLOCK_ASYNC
                    } else {
                        BLOCK_FUNCTION | BLOCK_ARROW
                    },
                ));
            }
            self.tight(q + 1);
            q = r + 1;
        } else {
            let outer = self.fast.await_is_operator;
            self.fast.await_is_operator = is_async;
            let body = q;
            q = self.expression(q)?;
            if q < 0 {
                q = self.or_jsx(body)?;
            }
            self.fast.await_is_operator = outer;
            if q < 0 {
                return Ok(-1);
            }
            if self.fast.shape == SH_JSX && self.fast.argument_lists != 0 {
                self.fast.arrows_to_jsx += 1;
            }
            // a conditional expression gets parentheses; a chain of arrows is a matter of its own
            if self.fast.shape == SH_CONDITIONAL || self.fast.shape == SH_ARROW {
                return Ok(self.no(refusal::ArrowBody));
            }
        }
        self.fast.shape = SH_ARROW;
        self.fast.level = NEVER;
        self.fast.assignable = false;
        return Ok(q);
    }

    /// The head of a function whose parameters stand on lines of their own ends at p, and `more` columns follow on its line (` {`, ` =>`, `;`). Would it really not fit on one line?
    pub(crate) fn head_is_too_wide(&mut self, p: i32, more: i32) -> bool {
        let need = self.fast.parameters_need;
        self.fast.parameters_need = -1;
        return self.width_up_to(p) - self.fast.parameters_from + more > need;
    }

    /// `(a, b: B, c = 1, { d }, ...e)`; p is at the `(`. Returns the place behind the `)`.
    pub(crate) fn parameters(&mut self, p: i32) -> R<i32> {
        // On a line each? That is how they are printed if the head of the function, up to its `{`, does not fit on one line. Only where the head starts the line or stands behind `=`.
        // (`(`, the end of the line and `<` is an element in parentheses: nothing may have been written when that is found out)
        let is_broken = self.t.at(p + 1) == 10
            && self.fast.breaks_here
            && self.fast.argument_lists == 0
            && self.fast.line_breaks == 0
            && self.fast.parameters_may_break
            && self.t.at(self.white(p + 1)) != 60;
        self.fast.parameters_may_break = false;
        let head = if is_broken {
            self.fast.column + self.width_up_to(p + 1)
        } else {
            0
        };
        if head > self.options.print_width {
            return Ok(self.no(refusal::Wide));
        }
        let inner = self.fast.column + self.options.tab_width;
        let mut flat: i32 = 0;
        let mut count: i32 = 0;
        let mut from: i32 = 0;
        let mut q = if is_broken {
            self.line_break(p + 1, inner)
        } else {
            self.tight(p + 1)
        };
        if self.t.at(q) == 41 {
            return Ok(if is_broken {
                self.no(refusal::Paren)
            } else {
                q + 1
            });
        }
        let first = q;
        loop {
            if is_broken {
                from = self.width_up_to(q);
                self.fast.limit = q + self.options.print_width - inner;
                if q - self.fast.run > 1400
                    || (self.fast.out != 0 && self.fast.out - self.text.gen_pos > 1400)
                {
                    return Ok(self.no(refusal::Long));
                }
            }
            let is_rest = self.t.at(q) == 46;
            if is_rest {
                if self.t.at(q + 1) != 46 || self.t.at(q + 2) != 46 {
                    return Ok(self.no(refusal::Paren));
                }
                q += 3;
            }
            let c = self.t.at(q);
            if (CC.at(c) & ID_START) != 0 {
                let e = self.word_end(q);
                if (CC.at(self.t.at(e)) & BEYOND) != 0 {
                    return Ok(self.no(refusal::NotAscii));
                }
                if !is_plain_name(self.keyword_at(q, e - q)) {
                    return Ok(self.no(refusal::Paren));
                }
                q = e;
            } else if c == 123 {
                q = self.object_literal(q, true)?;
            } else if c == 91 {
                q = self.array_pattern(q);
            } else {
                return Ok(self.no(refusal::Paren));
            }
            if q < 0 {
                return Ok(-1);
            }
            if self.fast.has_types {
                if !is_rest
                    && self.t.at(q) == 63
                    && (self.t.at(q + 1) == 58
                        || (self.fast.ts && (self.t.at(q + 1) == 44 || self.t.at(q + 1) == 41)))
                {
                    q += 1;
                }
                if self.t.at(q) == 58 {
                    let v0 = self.spaced(q + 1);
                    q = self.type_(v0)?;
                    if q < 0 {
                        return Ok(-1);
                    }
                }
            }
            let r = self.blanks(q);
            if !is_rest && self.t.at(r) == 61 && self.assignment_operator(r) == 1 {
                self.spaced(q);
                let v1 = self.spaced(r + 1);
                self.fast.in_parameters += 1;
                let value = self.expression(v1);
                self.fast.in_parameters -= 1;
                q = value?;
                if q < 0 {
                    return Ok(-1);
                }
                // Whether a function can be hugged is measured with the commas that the lists in it would end with if they were broken.
                if self.fast.argument_lists != 0
                    && q - v1 > 2
                    && (self.has_byte_in_range(b'(', v1, q)
                        || self.has_byte_in_range(b'[', v1, q)
                        || self.has_byte_in_range(b'{', v1, q))
                {
                    return Ok(self.no(refusal::Paren));
                }
            }
            if is_broken {
                let width = self.width_up_to(q) - from;
                if inner + width + 1 > self.options.print_width {
                    return Ok(self.no(refusal::Wide));
                }
                flat = flat + width + 2;
                count += 1;
                let has_comma = self.t.at(q) == 44;
                let e = if has_comma { q + 1 } else { q };
                // (an empty line between two of them is kept)
                let mut s = e + 1;
                s = self.blanks_end(s);
                if self.t.at(e) != 10 || self.t.at(s) == 10 {
                    return Ok(self.no(refusal::Paren));
                }
                if self.t.at(s) != 41 {
                    if !has_comma || is_rest {
                        return Ok(self.no(refusal::Paren));
                    }
                    q = self.line_break(e, inner);
                    continue;
                }
                // the last one: with a comma, unless it is `...rest`
                let wants_comma = self.options.trailing_comma == TRAILING_COMMA_ALL && !is_rest;
                if has_comma && !wants_comma {
                    self.flush(q);
                    self.fast.run = e;
                } else if !has_comma && wants_comma {
                    self.flush(q);
                    self.put(44);
                }
                q = self.line_break(e, self.fast.column);
                // A single parameter that is an object, or has the type of one, is hugged: should_hug_the_only_function_parameter().
                if count == 1 {
                    if self.t.at(first) == 91 {
                        return Ok(self.no(refusal::Paren));
                    }
                    let mut i = p;
                    while i < q {
                        if self.t.at(i) == 123 {
                            return Ok(self.no(refusal::Paren));
                        }
                        i += 1;
                    }
                }
                self.fast.line_from = self.width_up_to(q);
                self.fast.limit = q + self.options.print_width - self.fast.column;
                self.fast.parameters_need = self.options.print_width - (head + flat - 2 + 1);
                self.fast.parameters_from = self.width_up_to(q + 1);
                self.fast.parameters_count = count;
                self.fast.ready_flags |= F_DECIDED;
                return Ok(q + 1);
            }
            q = self.tight(q);
            let d = self.t.at(q);
            if d == 41 {
                return Ok(q + 1);
            }
            if d != 44 {
                return Ok(self.no(refusal::Paren));
            }
            let s = self.blanks(q + 1);
            if self.t.at(s) == 41 {
                self.flush(q);
                self.fast.run = s;
                return Ok(s + 1);
            }
            if is_rest {
                return Ok(self.no(refusal::Paren));
            }
            q = self.spaced(q + 1);
        }
    }

    /// `: A` behind parameters, or nothing.
    pub(crate) fn return_type(&mut self, mut q: i32) -> R<i32> {
        if self.t.at(q) != 58 {
            return Ok(q);
        }
        if !self.fast.has_types {
            return Ok(self.no(refusal::Paren));
        }
        q = self.spaced(q + 1);
        // shouldGroupFunctionParameters()
        if self.fast.parameters_need >= 0 && self.fast.parameters_count == 1 && self.t.at(q) == 123
        {
            return Ok(self.no(refusal::Paren));
        }
        // In Flow the type of a function is not read in this place before `=>`.
        if self.fast.flow && self.t.at(q) == 40 {
            return Ok(self.no(refusal::FunctionType));
        }
        return self.type_(q);
    }

    /// `(a, b) => c`; p is at the `(`.
    pub(crate) fn arrow_with_parens(&mut self, p: i32, is_async: bool) -> R<i32> {
        // A function among the arguments of a call that is an argument itself can force the outer call to break.
        if self.fast.argument_lists >= 2 {
            return Ok(self.no(refusal::ArrowInside));
        }
        if !self.options.arrow_parens_always {
            // `(a) =>` loses its parentheses
            let name = self.blanks(p + 1);
            if (CC.at(self.t.at(name)) & ID_START) != 0 {
                let e = self.word_end(name);
                let mut close = self.blanks(e);
                if self.t.at(close) == 44 {
                    close = self.blanks(close + 1);
                }
                if self.t.at(close) == 41 {
                    let arrow = self.blanks(close + 1);
                    if self.t.at(arrow) == 61 && self.t.at(arrow + 1) == 62 {
                        if (CC.at(self.t.at(e)) & BEYOND) != 0
                            || !is_plain_name(self.keyword_at(name, e - name))
                        {
                            return Ok(self.no(refusal::Paren));
                        }
                        self.flush(p);
                        self.fast.run = name;
                        self.flush(e);
                        self.put(32);
                        self.fast.run = arrow;
                        return self.arrow_body(arrow + 2, is_async);
                    }
                }
            }
        }
        // (without `arrowParens: always` a single name has no parentheses to stand in)
        self.fast.parameters_may_break =
            p == self.fast.breakable_at && self.fast.is_value && self.options.arrow_parens_always;
        let mut q = self.parameters(p)?;
        if q < 0 {
            return Ok(self.no(refusal::Paren));
        }
        if self.t.at(q) == 58 {
            // a function type in this place gets parentheses
            if self.t.at(self.blanks(q + 1)) == 40 {
                return Ok(self.no(refusal::Paren));
            }
            q = self.return_type(q)?;
            if q < 0 {
                return Ok(self.no(refusal::Paren));
            }
        }
        let r = self.blanks(q);
        if self.t.at(r) != 61 || self.t.at(r + 1) != 62 {
            return Ok(self.no(refusal::Paren));
        }
        // (behind ` =>` the line can end)
        if self.fast.parameters_need >= 0 && !self.head_is_too_wide(q, 3) {
            return Ok(self.no(refusal::Paren));
        }
        self.spaced(q);
        return self.arrow_body(r + 2, is_async);
    }

    /// `function a(b) {`; p is behind `function`. There is no function without something in its body here.
    pub(crate) fn function_head(&mut self, p: i32, is_async: bool, needs_name: bool) -> R<i32> {
        let mut q = self.spaced(p);
        if (CC.at(self.t.at(q)) & ID_START) != 0 {
            if q == p {
                return Ok(self.no(refusal::Word));
            }
            let e = self.word_end(q);
            if (CC.at(self.t.at(e)) & BEYOND) != 0 {
                return Ok(self.no(refusal::NotAscii));
            }
            if !is_plain_name(self.keyword_at(q, e - q)) {
                return Ok(self.no(refusal::Word));
            }
            q = self.tight(e);
        } else if needs_name {
            return Ok(self.no(refusal::Word));
        }
        if self.t.at(q) != 40 {
            return Ok(self.no(refusal::Word));
        }
        self.fast.parameters_may_break = needs_name;
        q = self.parameters(q)?;
        if q < 0 {
            return Ok(-1);
        }
        q = self.return_type(q)?;
        if q < 0 {
            return Ok(-1);
        }
        if self.fast.parameters_need >= 0 && !self.head_is_too_wide(q, 2) {
            return Ok(self.no(refusal::Paren));
        }
        q = self.spaced(q);
        if self.t.at(q) != 123 {
            return Ok(self.no(refusal::Block));
        }
        return Ok(self.open_block(
            q,
            if is_async {
                BLOCK_FUNCTION | BLOCK_ASYNC
            } else {
                BLOCK_FUNCTION
            },
        ));
    }

    /// `(a, b)`; p is behind the `(`. Returns the place behind the `)`.
    pub(crate) fn call_arguments(&mut self, p: i32) -> R<i32> {
        let mut q = p;
        let mut c = self.t.at(q);
        if c == 32 || c == 9 {
            q = self.tight(q);
            c = self.t.at(q);
        }
        if c == 41 {
            self.fast.arguments_are_simple = true;
            self.fast.arguments_have_function = false;
            self.fast.arguments_count = 0;
            self.fast.arguments_level = 0;
            return Ok(q + 1);
        }
        self.fast.argument_lists += 1;
        let mut simple = true;
        let mut arrows: i32 = 0;
        let mut highest: i32 = 0;
        let mut count: i32 = 0;
        // the shape of the argument before
        let mut previous: i32 = 0;
        loop {
            if c == 46 {
                if self.t.at(q + 1) != 46 || self.t.at(q + 2) != 46 {
                    return Ok(self.no(refusal::Arguments));
                }
                q = self.expression(q + 3)?;
                if q < 0 {
                    return Ok(-1);
                }
                if self.fast.shape > SH_OBJECT {
                    return Ok(self.no(refusal::Spread));
                }
                simple = false;
                highest = NEVER;
            } else {
                let argument = q;
                q = self.open_expression(q)?;
                if q < 0 {
                    q = self.or_jsx(argument)?;
                    if q < 0 {
                        return Ok(-1);
                    }
                }
                if self.fast.opened != 0 {
                    // The last argument, as will be seen behind the block. It is hugged if no other argument is a function.
                    if arrows != 0 {
                        return Ok(self.no(refusal::ArrowInside));
                    }
                    // nor is the second of two objects
                    if previous == SH_OBJECT
                        && self.fast.pending_parens == 0
                        && (self.fast.opened_flags & BLOCK_OBJECT) != 0
                    {
                        return Ok(self.no(refusal::Arguments));
                    }
                    self.fast.pending_parens += 1;
                    return Ok(q);
                }
                previous = self.fast.shape;
                let l = self.fast.level;
                // is_simple_call_argument(argument, 2)
                if l > 2 {
                    simple = false;
                    if self.fast.shape == SH_ARROW {
                        arrows += 1;
                    }
                }
                if l > highest {
                    highest = l;
                }
            }
            count += 1;
            c = self.t.at(q);
            if c == 32 || c == 9 {
                q = self.tight(q);
                c = self.t.at(q);
            }
            if c == 41 {
                break;
            }
            if c != 44 {
                return Ok(self.no(refusal::Arguments));
            }
            c = self.t.at(q + 2);
            if self.t.at(q + 1) == 32 && c > 32 && c != 41 {
                // `, ` and the next argument
                q += 2;
                continue;
            }
            let r = self.blanks(q + 1);
            if self.t.at(r) == 41 {
                self.flush(q);
                self.fast.run = r;
                q = r;
                break;
            }
            q = self.spaced(q + 1);
            c = self.t.at(q);
        }
        // two functions: isFunctionCompositionArgs()
        if arrows > 1 {
            return Ok(self.no(refusal::ArrowInside));
        }
        self.fast.argument_lists -= 1;
        self.fast.arguments_are_simple = simple;
        self.fast.arguments_have_function = arrows != 0;
        self.fast.arguments_level = highest;
        self.fast.arguments_count = count;
        return Ok(q + 1);
    }

    /// `(`, the end of the line, arguments on a line each, `)` on a line of its own; p is behind the `(`. That is how Prettier prints the arguments of a call that do not fit on one line, if neither the
    /// last nor the first of them is hugged: no object, array or function among them, that is. Each argument has to fit on its line (or be a call of the same kind).
    /// Returns the place behind the `)`.
    pub(crate) fn broken_arguments(&mut self, p: i32) -> R<i32> {
        return self.broken_list(p, false);
    }

    /// The same for the elements of an array, with `is_array`: `[`, the end of the line, the elements on a line each, `]`. There nothing is hugged, but numbers are printed as many on a line as fit.
    pub(crate) fn broken_list(&mut self, p: i32, is_array: bool) -> R<i32> {
        let close = if is_array { 93 } else { 41 };
        let has_comma = if is_array {
            self.options.trailing_comma != TRAILING_COMMA_NONE
        } else {
            self.options.trailing_comma == TRAILING_COMMA_ALL
        };
        let outer_follow = self.fast.follow;
        let mut numbers: i32 = 0;
        let outer = self.fast.line_column;
        let inner = outer + self.options.tab_width;
        // the column behind the `(`
        let head = outer + self.width_up_to(p) - self.fast.line_from;
        let is_outermost = self.fast.argument_lists == 0;
        let value = self.fast.is_value;
        if head > self.options.print_width {
            return Ok(self.no(refusal::Wide));
        }
        if !is_array {
            self.fast.argument_lists += 1;
        }
        self.fast.follow = if has_comma { 1 } else { 0 };
        let mut flat: i32 = 0;
        let mut count: i32 = 0;
        let mut last_byte: i32;
        let mut last_from: i32;
        let mut last_end: i32;
        let mut q = p;
        loop {
            // an empty line between two arguments is kept
            let mut r = q + 1;
            r = self.blanks_end(r);
            if self.t.at(q) != 10 || self.t.at(r) == 10 {
                return Ok(self.no(refusal::Arguments));
            }
            // (the room for generated texts that was reserved is 2048 bytes)
            if r - self.fast.run > 1400
                || (self.fast.out != 0 && self.fast.out - self.text.gen_pos > 1400)
            {
                return Ok(self.no(refusal::Long));
            }
            q = self.line_break(q, inner);
            self.fast.line_column = inner;
            self.fast.line_from = self.width_up_to(q);
            self.fast.limit = q + self.options.print_width - inner;
            self.fast.breakable_at = q;
            self.fast.is_value = false;
            let from = self.fast.line_from;
            let lists = self.fast.broken_lists;
            let c = self.t.at(q);
            let e: i32;
            if c == 46 {
                if self.t.at(q + 1) != 46 || self.t.at(q + 2) != 46 {
                    return Ok(self.no(refusal::Arguments));
                }
                self.fast.breakable_at = 0;
                e = self.expression(q + 3)?;
                if e < 0 {
                    return Ok(-1);
                }
                if self.fast.shape > SH_OBJECT {
                    return Ok(self.no(refusal::Spread));
                }
                self.fast.shape = SH_CHAIN;
            } else {
                e = self.expression(q)?;
                if e < 0 {
                    return Ok(-1);
                }
            }
            // what could be hugged, or needs a look at what is around it
            if self.fast.shape >= SH_AS
                || (!is_array && (self.fast.shape == SH_OBJECT || self.fast.shape == SH_ARRAY))
            {
                return Ok(self.no(refusal::Arguments));
            }
            if (CC.at(c) & DIGIT) != 0 || ((c == 43 || c == 45) && self.fast.shape == SH_UNARY) {
                numbers += 1;
            }
            if self.fast.broken_lists != lists {
                if self.fast.shape != SH_CHAIN
                    && self.fast.shape != SH_NEW
                    && self.fast.shape != SH_AWAIT
                    && self.fast.shape != SH_ARRAY
                {
                    return Ok(self.no(refusal::Arguments));
                }
                // The list in it does not fit on this line. On the line of the `(` it does not fit either, unless it starts further to
                // the left there, after what follows it has been counted: a comma here, the `)` and what follows that there.
                if head + flat + 1 + outer_follow < inner + self.fast.follow {
                    return Ok(self.no(refusal::Arguments));
                }
                flat = 4096;
            } else {
                flat = flat + self.width_up_to(e) - from + 2;
            }
            if inner + self.width_up_to(e) - self.fast.line_from + 1 > self.options.print_width {
                return Ok(self.no(refusal::Wide));
            }
            count += 1;
            last_byte = self.t.at(e - 1);
            last_from = q;
            last_end = e;
            if self.t.at(e) == 44 {
                if self.t.at(e + 1) != 10 {
                    return Ok(self.no(refusal::Arguments));
                }
                if self.t.at(self.white(e + 1)) != close {
                    q = e + 1;
                    continue;
                }
                if !has_comma {
                    self.flush(e);
                    self.fast.run = e + 1;
                }
                q = self.line_break(e + 1, outer);
            } else {
                if self.t.at(e) != 10 || self.t.at(self.white(e)) != close {
                    return Ok(self.no(refusal::Arguments));
                }
                if has_comma {
                    self.flush(e);
                    self.put(44);
                }
                q = self.line_break(e, outer);
            }
            break;
        }
        // Behind `=`, a chain whose calls have no argument, or a single short one, moves to the next line as a whole: is_poorly_breakable_member_or_call_chain(), is_lone_short_argument().
        // (`a(b) as C` is no chain: terminate() looks at that)
        if is_array {
            if numbers == count {
                return Ok(self.no(refusal::Array));
            }
        } else if is_outermost && value && count == 1 {
            let width = flat - 2;
            let is_string = last_byte == 34 || last_byte == 39;
            if self.fast.shape == SH_NAME
                || self.fast.shape == SH_THIS
                || (self.fast.shape == SH_LITERAL && is_string)
            {
                if width * 4 <= self.options.print_width {
                    self.fast.has_lone_short_argument = true;
                }
            } else if self.fast.shape == SH_LITERAL {
                self.fast.has_lone_short_argument = true;
            } else if (width - 8) * 4 <= self.options.print_width
                // (`a<B>()`: the type arguments do not count)
                || self.has_byte_in_range(60, last_from, last_end)
            {
                self.fast.has_lone_short_argument = true;
            }
        }
        if !is_array {
            self.fast.argument_lists -= 1;
        }
        self.fast.follow = outer_follow;
        self.fast.line_column = outer;
        self.fast.line_from = self.width_up_to(q);
        self.fast.limit = q + self.options.print_width - outer;
        self.fast.broken_lists += 1;
        // on one line: up to the `)` and with it
        self.fast.rest_needed = self.options.print_width - (head + flat - 2 + 1);
        self.fast.ready_flags |= F_DECIDED;
        self.fast.arguments_are_simple = false;
        self.fast.arguments_have_function = false;
        self.fast.arguments_level = NEVER;
        self.fast.arguments_count = count;
        return Ok(q + 1);
    }

    /// Names whose calls are printed in ways of their own: tests, `require`, `define`.
    #[inline(never)]
    pub(crate) fn is_special_callee(&self, p: i32, e: i32) -> bool {
        match e - p {
            2 => {
                return self.word_is(p, b"it");
            }
            3 => {
                return self.word_is(p, b"xit") || self.word_is(p, b"fit");
            }
            4 => {
                return self.word_is(p, b"test") || self.word_is(p, b"skip");
            }
            5 => {
                return self.word_is(p, b"xtest") || self.word_is(p, b"ftest");
            }
            6 => {
                return self.word_is(p, b"define");
            }
            7 => {
                return self.word_is(p, b"require");
            }
            8 => {
                return self.word_is(p, b"describe") || self.word_is(p, b"afterAll");
            }
            9 => {
                return self.word_is(p, b"xdescribe")
                    || self.word_is(p, b"fdescribe")
                    || self.word_is(p, b"afterEach")
                    || self.word_is(p, b"beforeAll");
            }
            10 => {
                return self.word_is(p, b"beforeEach");
            }
            _ => {}
        }
        return false;
    }

    /// `[a, b]`; p is at the `[`.
    pub(crate) fn array_literal(&mut self, p: i32) -> R<i32> {
        let mut q = self.tight(p + 1);
        if self.t.at(q) == 93 {
            self.fast.level = 1;
            return Ok(q + 1);
        }
        let first = self.t.at(q);
        let mut count: i32 = 0;
        let mut highest: i32 = 0;
        loop {
            if self.t.at(q) == 46 {
                if self.t.at(q + 1) != 46 || self.t.at(q + 2) != 46 {
                    return Ok(self.no(refusal::Array));
                }
                q = self.expression(q + 3)?;
                if q < 0 {
                    return Ok(-1);
                }
                if self.fast.shape > SH_OBJECT {
                    return Ok(self.no(refusal::Spread));
                }
                highest = NEVER;
            } else {
                let item = q;
                q = self.expression(q)?;
                if q < 0 {
                    q = self.or_jsx(item)?;
                    if q < 0 {
                        return Ok(-1);
                    }
                }
                if self.fast.level > highest {
                    highest = self.fast.level;
                }
            }
            count += 1;
            q = self.tight(q);
            let c = self.t.at(q);
            if c == 93 {
                break;
            }
            if c != 44 {
                return Ok(self.no(refusal::Array));
            }
            let r = self.blanks(q + 1);
            if self.t.at(r) == 93 {
                self.flush(q);
                self.fast.run = r;
                q = r;
                break;
            }
            q = self.spaced(q + 1);
        }
        // several objects, or several arrays, with more than one member each: broken whether it fits or not
        if count > 1 && (first == 123 || first == 91) {
            return Ok(self.no(refusal::ArrayBreaks));
        }
        self.fast.level = highest + 1;
        return Ok(q + 1);
    }

    /// `{ a, b: c, ...d }`; p is at the `{`. As a pattern, the values are names.
    pub(crate) fn object_literal(&mut self, p: i32, is_pattern: bool) -> R<i32> {
        let mut q = self.blanks(p + 1);
        if self.t.at(q) == 10 && !is_pattern {
            // The parser reads it. (With a comment first it may hold nothing else.)
            // An argument of an argument is not hugged.
            while self.t.at(q) == 32 || self.t.at(q) == 9 || self.t.at(q) == 10 {
                q += 1;
            }
            if !self.options.object_wrap_preserve
                || self.fast.argument_lists >= 2
                || self.t.at(q) == 47
            {
                return Ok(self.no(refusal::Key));
            }
            return Ok(self.open_block(p, BLOCK_OBJECT));
        }
        if self.t.at(q) == 125 {
            if is_pattern {
                return Ok(self.no(refusal::Pattern));
            }
            self.tight(p + 1);
            self.fast.level = 1;
            return Ok(q + 1);
        }
        q = self.in_brace(p + 1);
        let mut highest: i32 = 0;
        loop {
            if self.t.at(q) == 46 {
                if self.t.at(q + 1) != 46 || self.t.at(q + 2) != 46 {
                    return Ok(self.no(refusal::Object));
                }
                q = self.expression(q + 3)?;
                if q < 0 {
                    return Ok(-1);
                }
                if if is_pattern {
                    // the last thing in the pattern
                    self.fast.shape != SH_NAME || self.t.at(self.blanks(q)) != 125
                } else {
                    self.fast.shape > SH_OBJECT
                } {
                    return Ok(self.no(refusal::Spread));
                }
                highest = NEVER;
            } else {
                if (CC.at(self.t.at(q)) & ID_START) == 0 {
                    return Ok(self.no(refusal::Key));
                }
                let e = self.word_end(q);
                if (CC.at(self.t.at(e)) & BEYOND) != 0 {
                    return Ok(self.no(refusal::NotAscii));
                }
                if e > self.fast.limit {
                    return Ok(self.no(refusal::Long));
                }
                let r = self.blanks(e);
                if self.t.at(r) == 58 {
                    // there can be one `__proto__: a`: the parser counts
                    if e - q == 9 && self.text_is(q, e, b"__proto__") {
                        return Ok(self.no(refusal::Key));
                    }
                    self.tight(e);
                    let value = self.spaced(r + 1);
                    q = self.expression(value)?;
                    if q < 0 {
                        q = self.or_jsx(value)?;
                        if q < 0 {
                            return Ok(-1);
                        }
                    }
                    if is_pattern && self.fast.shape != SH_NAME {
                        return Ok(self.no(refusal::Pattern));
                    }
                    if self.fast.level > highest {
                        highest = self.fast.level;
                    }
                } else {
                    // shorthand; anything else than `,` or `}` behind it is refused below
                    if !is_plain_name(self.keyword_at(q, e - q)) {
                        return Ok(self.no(refusal::Key));
                    }
                    q = e;
                }
            }
            let s = self.blanks(q);
            let c = self.t.at(s);
            self.fast.level = highest + 1;
            if c == 125 {
                return Ok(self.in_brace(q) + 1);
            }
            if c != 44 {
                return Ok(self.no(refusal::Object));
            }
            let r = self.blanks(s + 1);
            if self.t.at(r) == 125 {
                self.flush(q);
                if self.options.bracket_spacing {
                    self.put(32);
                }
                self.fast.run = r;
                return Ok(r + 1);
            }
            self.tight(q);
            q = self.spaced(s + 1);
        }
    }
}
/// A name, a literal, `new X()`, an array, an object or an arrow function, and what hangs on to it: `.a`, `?.a`, `[b]`, `(c)`, `!`.
pub(crate) fn is_hex_digit(c: i32) -> bool {
    return (c >= 48 && c <= 57) || ((c | 32) >= 97 && (c | 32) <= 102);
}

impl Quick {
    /// A template on one line; p is at the "`". The text is printed as it stands, and what is in `${}` flat if the statement is. Sets template_level, which is `level` for
    /// a template without a tag.
    pub(crate) fn template(&mut self, p: i32) -> R<i32> {
        if self.fast.no_templates != 0 {
            return Ok(self.no(refusal::Template));
        }
        self.fast.templates += 1;
        let mut q = p + 1;
        let mut lv: i32 = 1;
        loop {
            let c = self.t.at(q);
            if c == 96 {
                break;
            }
            if c < 32 {
                return Ok(self.no(refusal::Template));
            }
            if c >= 127 {
                return Ok(self.no(refusal::NotAscii));
            }
            if q > self.fast.limit {
                return Ok(self.no(refusal::Long));
            }
            if c == 92 {
                // the escapes that are valid for certain
                let e = self.t.at(q + 1);
                if e == 120 {
                    if !is_hex_digit(self.t.at(q + 2)) || !is_hex_digit(self.t.at(q + 3)) {
                        return Ok(self.no(refusal::Template));
                    }
                } else if e == 117 {
                    if !is_hex_digit(self.t.at(q + 2))
                        || !is_hex_digit(self.t.at(q + 3))
                        || !is_hex_digit(self.t.at(q + 4))
                        || !is_hex_digit(self.t.at(q + 5))
                    {
                        return Ok(self.no(refusal::Template));
                    }
                } else if e != 110
                    && e != 114
                    && e != 116
                    && e != 92
                    && e != 96
                    && e != 36
                    && e != 39
                    && e != 34
                {
                    return Ok(self.no(refusal::Template));
                }
                q += 2;
            } else if c == 36 && self.t.at(q + 1) == 123 {
                let v0 = self.tight(q + 2);
                q = self.expression(v0)?;
                if q < 0 {
                    return Ok(-1);
                }
                if self.fast.level >= lv {
                    lv = if self.fast.level >= NEVER {
                        NEVER
                    } else {
                        self.fast.level + 1
                    };
                }
                q = self.tight(q);
                if self.t.at(q) != 125 {
                    return Ok(self.no(refusal::Template));
                }
                q += 1;
            } else {
                q += 1;
            }
        }
        q += 1;
        // nothing hangs on to it
        let d = self.t.at(q);
        if d == 46
            || d == 40
            || d == 91
            || d == 96
            || (d == 63 && self.t.at(q + 1) == 46)
            || (d == 33 && self.t.at(q + 1) != 61)
        {
            return Ok(self.no(refusal::Template));
        }
        self.fast.template_level = lv;
        return Ok(q);
    }

    /// Can T[p, q), names with dots between them, be the tag of a template that is printed as it stands? Not if it says that this is CSS, GraphQL, HTML, Markdown or a table.
    #[inline(never)]
    pub(crate) fn is_plain_tag(&self, p: i32, q: i32) -> bool {
        let mut e = p;
        while e < q && self.t.at(e) != 46 {
            e += 1;
        }
        match e - p {
            2 => {
                if self.text_is(p, e, b"md") {
                    return false;
                }
            }
            3 => {
                if self.text_is(p, e, b"css") || self.text_is(p, e, b"gql") {
                    return false;
                }
            }
            4 => {
                if self.text_is(p, e, b"html") {
                    return false;
                }
            }
            6 => {
                if self.text_is(p, e, b"styled") {
                    return false;
                }
            }
            7 => {
                if self.text_is(p, e, b"graphql") {
                    return false;
                }
            }
            8 => {
                if self.text_is(p, e, b"markdown") {
                    return false;
                }
            }
            _ => {}
        }
        let mut s = q;
        while s > p && self.t.at(s - 1) != 46 {
            s -= 1;
        }
        return !((q - s == 4 && self.text_is(s, q, b"each"))
            || (q - s == 6 && self.text_is(s, q, b"extend")));
    }

    #[inline(never)]
    fn is_graphql(&self, p: i32) -> bool {
        self.text_is(p, p + 7, b"graphql")
    }

    /// check_super() of the parser. `next`: what follows the `.` or `(`. In the head of a member of a class and among parameters the parser is somewhere else than what is read.
    #[cold]
    fn may_read_super(&self, is_call: bool, next: i32) -> bool {
        if self.fast.ts {
            return true;
        }
        let scope = self.parse.place.scope;
        return self.fast.in_parameters == 0
            && !self.fast.in_class
            && next != 35
            && (scope == SCOPE_TOP
                || (scope != SCOPE_FUNCTION && (!is_call || scope == SCOPE_DERIVED_CONSTRUCTOR)));
    }

    pub(crate) fn chain(&mut self, p: i32) -> R<i32> {
        self.stack()?;
        if p > self.fast.limit {
            return Ok(self.no(refusal::Long));
        }
        let c = self.t.at(p);
        let mut q: i32;
        let mut sh: i32;
        let mut calls: i32 = 0;
        let mut complex = false;
        // a call of the chain takes a function
        let mut functions = false;
        let mut lv: i32 = 1;
        if (CC.at(c) & ID_START) != 0 {
            let kw: i32;
            if p == self.fast.scanned_at {
                q = self.fast.scanned_end;
                kw = self.fast.scanned_keyword;
            } else {
                q = p + 1;
                q = self.name_end(q);
                kw = if (KW_LENGTHS.at(c).wrapping_shr((q - p) as u32) & 1) != 0 {
                    self.keyword_at(p, q - p)
                } else {
                    0
                };
            }
            if kw == 0 && (CC.at(self.t.at(q)) & (HANGS_ON | BEYOND)) == 0 {
                // a name and nothing else: every second operand
                self.fast.shape = SH_NAME;
                self.fast.level = 1;
                self.fast.assignable = true;
                return Ok(q);
            }
            if (CC.at(self.t.at(q)) & BEYOND) != 0 {
                return Ok(self.no(refusal::NotAscii));
            }
            sh = SH_NAME;
            if kw != 0 && !is_plain_name(kw) {
                's1: {
                    match kw & 255 {
                        tk::This => {
                            sh = SH_THIS;
                        }
                        tk::Null | tk::True | tk::False => {
                            sh = SH_LITERAL;
                        }
                        tk::Super => {
                            if (self.t.at(q) != 46 && self.t.at(q) != 40)
                                || !self.may_read_super(self.t.at(q) == 40, self.t.at(q + 1))
                            {
                                return Ok(self.no(refusal::Word));
                            }
                            sh = SH_THIS;
                        }
                        tk::New => {
                            // new a.B<C>(d)
                            if self.t.at(q) != 32 && self.t.at(q) != 9 {
                                return Ok(self.no(refusal::New));
                            }
                            q = self.spaced(q);
                            loop {
                                if (CC.at(self.t.at(q)) & ID_START) == 0 {
                                    return Ok(self.no(refusal::New));
                                }
                                let e = self.word_end(q);
                                if (CC.at(self.t.at(e)) & BEYOND) != 0 {
                                    return Ok(self.no(refusal::NotAscii));
                                }
                                if self.t.at(q - 1) != 46
                                    && !is_plain_name(self.keyword_at(q, e - q))
                                    && (self.keyword_at(q, e - q) & 255) != tk::This
                                {
                                    return Ok(self.no(refusal::New));
                                }
                                q = e;
                                if self.t.at(q) != 46 {
                                    break;
                                }
                                q += 1;
                            }
                            if self.t.at(q) == 60 && self.fast.has_types {
                                q = self.type_arguments(q)?;
                                if q < 0 {
                                    return Ok(-1);
                                }
                            }
                            if self.t.at(q) != 40 {
                                return Ok(self.no(refusal::New));
                            }
                            if self.t.at(q + 1) == 10
                                && p == self.fast.breakable_at
                                && self.fast.breaks_here
                                && self.t.at(q - 1) != 62
                            {
                                q = self.broken_arguments(q + 1)?;
                                if q < 0 {
                                    return Ok(-1);
                                }
                                // nothing may hang on to it, and what follows is one byte at least
                                if (CC.at(self.t.at(q)) & ENDS) == 0
                                    || self.fast.rest_needed >= self.fast.follow
                                {
                                    return Ok(self.no(refusal::New));
                                }
                                self.fast.shape = SH_NEW;
                                self.fast.level = NEVER;
                                self.fast.assignable = false;
                                return Ok(q);
                            }
                            q = self.call_arguments(q + 1)?;
                            if q < 0 || self.fast.opened != 0 {
                                return Ok(q);
                            }
                            calls = 1;
                            complex = !self.fast.arguments_are_simple;
                            functions = self.fast.arguments_have_function;
                            lv = if self.fast.arguments_count > self.fast.arguments_level {
                                self.fast.arguments_count
                            } else {
                                if self.fast.arguments_count == 0 {
                                    1
                                } else {
                                    self.fast.arguments_level + 1
                                }
                            };
                            sh = SH_NEW;
                        }
                        tk::Function => {
                            if self.fast.argument_lists >= 2 {
                                return Ok(self.no(refusal::ArrowInside));
                            }
                            return self.function_head(q, false, false);
                        }
                        tk::Name => {
                            // `module.exports`
                            if (kw >> 8) == kw::Module && self.t.at(q) == 46 {
                                break 's1;
                            }
                            if (kw >> 8) == kw::Async && (self.t.at(q) == 32 || self.t.at(q) == 9) {
                                // async (a) => b, async a => b, async function () {
                                if self.fast.argument_lists >= 2 {
                                    return Ok(self.no(refusal::ArrowInside));
                                }
                                let r = self.spaced(q);
                                if self.t.at(r) == 40 {
                                    return self.arrow_with_parens(r, true);
                                }
                                if (CC.at(self.t.at(r)) & ID_START) == 0 {
                                    return Ok(self.no(refusal::Word));
                                }
                                let e = self.word_end(r);
                                if (CC.at(self.t.at(e)) & BEYOND) != 0 {
                                    return Ok(self.no(refusal::NotAscii));
                                }
                                let word = self.keyword_at(r, e - r);
                                if word == tk::Function {
                                    return self.function_head(e, true, false);
                                }
                                let arrow = self.blanks(e);
                                if !is_plain_name(word)
                                    || self.t.at(arrow) != 61
                                    || self.t.at(arrow + 1) != 62
                                {
                                    return Ok(self.no(refusal::Word));
                                }
                                if self.options.arrow_parens_always {
                                    self.flush(r);
                                    self.put(40);
                                    self.flush(e);
                                    self.put(41);
                                }
                                self.spaced(e);
                                return self.arrow_body(arrow + 2, true);
                            }
                            return Ok(self.no(refusal::Word));
                        }
                        _ => {
                            return Ok(self.no(refusal::Word));
                        }
                    }
                }
            } else {
                // a => b
                let r = if self.t.at(q) == 32 {
                    self.blanks(q)
                } else {
                    q
                };
                if self.t.at(r) == 61 && self.t.at(r + 1) == 62 {
                    if self.fast.argument_lists >= 2 {
                        return Ok(self.no(refusal::ArrowInside));
                    }
                    if self.options.arrow_parens_always {
                        self.flush(p);
                        self.put(40);
                        self.flush(q);
                        self.put(41);
                    }
                    self.spaced(q);
                    return self.arrow_body(r + 2, false);
                }
            }
        } else if (CC.at(c) & DIGIT) != 0 {
            // nothing can hang on to a number without parentheses
            self.fast.shape = SH_LITERAL;
            self.fast.level = 1;
            self.fast.assignable = false;
            return Ok(self.number(p));
        } else if c == 34 || c == 39 {
            q = self.string(p);
            if q < 0 {
                return Ok(-1);
            }
            sh = SH_LITERAL;
        } else if c == 91 {
            if self.t.at(p + 1) == 10 && p == self.fast.breakable_at && self.fast.breaks_here {
                q = self.broken_list(p + 1, true)?;
                if q < 0 {
                    return Ok(-1);
                }
                // nothing may hang on to it
                if ((CC.at(self.t.at(q)) & ENDS) == 0 && self.t.at(q) != 32)
                    || self.fast.rest_needed >= self.fast.follow
                {
                    return Ok(self.no(refusal::Array));
                }
                self.fast.shape = SH_ARRAY;
                self.fast.level = NEVER;
                self.fast.assignable = false;
                return Ok(q);
            }
            q = self.array_literal(p)?;
            if q < 0 {
                return Ok(-1);
            }
            lv = self.fast.level;
            sh = SH_ARRAY;
        } else if c == 123 {
            q = self.object_literal(p, false)?;
            self.fast.shape = SH_OBJECT;
            self.fast.assignable = false;
            return Ok(q);
        } else if c == 40 {
            return self.arrow_with_parens(p, false);
        } else if c == 96 {
            q = self.template(p)?;
            self.fast.shape = SH_CHAIN;
            self.fast.level = self.fast.template_level;
            self.fast.assignable = false;
            return Ok(q);
        } else {
            return Ok(self.no(refusal::Operand));
        }
        let mut optional = false;
        let mut target = sh == SH_NAME;
        // For a chain with arguments on lines of their own. 0: there are none so far. Else what may follow: 1 members, 2 members and then one more call, 3 the same and a member has been seen,
        // 5 more members.
        let mut broken: i32 = 0;
        let mut rest_from: i32 = 0;
        let mut rest: i32 = 0;
        let mut rest_at_dot: i32 = -1;
        let first_end = q;
        loop {
            let d = self.t.at(q);
            if broken != 0 && (CC.at(d) & ENDS) == 0 && d != 32 {
                // Up to its last call the chain has two groups at most, or it would be broken at its dots: `a.b(..)`, `a(..).b.c(..)`. Members behind the last call are not part of that.
                if d == 46 {
                    if rest_at_dot < 0 {
                        rest_at_dot = self.width_up_to(q) - rest_from;
                    }
                    broken = if broken == 1 {
                        5
                    } else {
                        if broken == 2 { 3 } else { broken }
                    };
                } else if d == 40 && broken == 3 {
                    broken = 1;
                    rest_at_dot = -1;
                    // the line can end behind this `(`, if there is an argument
                    if rest >= 0 && self.t.at(q + 1) != 41 {
                        if self.width_up_to(q + 1) - rest_from <= rest {
                            return Ok(self.no(refusal::Chain));
                        }
                        rest = -1;
                    }
                } else if d != 33 {
                    return Ok(self.no(refusal::Chain));
                }
            }
            if d == 46 {
                let mut r = q + 1;
                if (CC.at(self.t.at(r)) & ID_START) == 0 {
                    // (TypeScript has no private name in an optional chain)
                    if self.t.at(r) != 35 || (optional && self.fast.ts) {
                        return Ok(self.no(refusal::Member));
                    }
                    r += 1;
                    if (CC.at(self.t.at(r)) & ID_START) == 0 {
                        return Ok(self.no(refusal::Member));
                    }
                }
                q = r + 1;
                q = self.name_end(q);
                if sh > SH_MEMBER || sh == SH_LITERAL {
                    sh = SH_CHAIN;
                } else {
                    sh = SH_MEMBER;
                }
                target = true;
            } else if d == 40 {
                // graphql(schema, `..`), graphql?.(schema, `..`)
                if ((sh == SH_NAME && q - p == 7) || (optional && q - p == 9)) && self.is_graphql(p)
                {
                    self.fast.no_templates += 1;
                }
                let curried = self.t.at(q - 1) == 41;
                if self.t.at(q + 1) == 10 && p == self.fast.breakable_at && self.fast.breaks_here {
                    // the first call, or the second one if the first is a call of the first name
                    let is_direct = self.t.at(first_end) == 40;
                    if curried
                        || optional
                        || self.t.at(q - 1) == 62
                        || self.t.at(q - 1) == 33
                        || (sh != SH_NAME
                            && sh != SH_THIS
                            && sh != SH_MEMBER
                            && !(sh == SH_CHAIN && calls == 1 && is_direct))
                        || self.is_special_callee(p, first_end)
                    {
                        return Ok(self.no(refusal::Chain));
                    }
                    if broken == 0 && complex {
                        return Ok(self.no(refusal::Chain));
                    }
                    q = self.broken_arguments(q + 1)?;
                    if q < 0 {
                        return Ok(-1);
                    }
                    broken = if calls == 0 && is_direct { 2 } else { 1 };
                    calls += 1;
                    rest = self.fast.rest_needed;
                    rest_from = self.width_up_to(q);
                    sh = SH_CHAIN;
                    target = false;
                    lv = NEVER;
                    continue;
                }
                q = self.call_arguments(q + 1)?;
                if q < 0 {
                    return Ok(-1);
                }
                calls += 1;
                if self.fast.opened != 0 {
                    // The last group of the chain breaks. With a third call, or a function for another call, so does the chain. In `a(b, c)(d)` the arguments of the first call have no
                    // group of their own.
                    if calls > 2 || functions || curried {
                        return Ok(self.no(refusal::Chain));
                    }
                    return Ok(q);
                }
                if !self.fast.arguments_are_simple {
                    complex = true;
                }
                if self.fast.arguments_have_function {
                    functions = true;
                }
                if self.fast.arguments_count > lv {
                    lv = self.fast.arguments_count;
                }
                if self.fast.arguments_level >= lv {
                    lv = self.fast.arguments_level + 1;
                }
                sh = SH_CHAIN;
                target = false;
            } else if d == 91 {
                let v0 = self.tight(q + 1);
                q = self.expression(v0)?;
                if q < 0 {
                    return Ok(-1);
                }
                if self.fast.level > lv {
                    lv = self.fast.level;
                }
                q = self.tight(q);
                if self.t.at(q) != 93 {
                    return Ok(self.no(refusal::Member));
                }
                q += 1;
                sh = SH_CHAIN;
                target = true;
            } else if d == 63 {
                // `?.`, but `a?.5:b` is a conditional expression
                if self.t.at(q + 1) != 46 || (CC.at(self.t.at(q + 2)) & DIGIT) != 0 {
                    break;
                }
                optional = true;
                sh = SH_CHAIN;
                let e = self.t.at(q + 2);
                if e == 40 || e == 91 {
                    q += 2;
                } else {
                    q += 1;
                }
                if e != 40 && e != 91 && (CC.at(e) & ID_START) == 0 && e != 35 {
                    return Ok(self.no(refusal::Member));
                }
            } else if d == 33 {
                if !self.fast.ts || self.t.at(q + 1) == 61 {
                    break;
                }
                // behind an optional chain it can take parentheses
                if optional {
                    return Ok(self.no(refusal::Member));
                }
                q += 1;
                sh = SH_CHAIN;
                target = false;
            } else if d == 60 && self.fast.has_types {
                // a<B>(c): a `<` right behind a name is taken for nothing else
                q = self.type_arguments(q)?;
                if q < 0 || self.t.at(q) != 40 {
                    return Ok(self.no(refusal::Less));
                }
            } else if d == 96 {
                if calls != 0
                    || optional
                    || (sh != SH_NAME && sh != SH_MEMBER)
                    || !self.is_plain_tag(p, q)
                {
                    return Ok(self.no(refusal::Template));
                }
                q = self.template(q)?;
                self.fast.shape = SH_CHAIN;
                self.fast.level = NEVER;
                self.fast.assignable = false;
                return Ok(q);
            } else {
                if (CC.at(d) & BEYOND) != 0 {
                    return Ok(self.no(refusal::NotAscii));
                }
                break;
            }
            if q > self.fast.limit {
                return Ok(self.no(refusal::Long));
            }
        }
        // The line can end in front of the first member behind the last call. Else what follows the chain is one byte at least: `;`, `,`, a blank. (But for the last argument of a list without a comma at its end.)
        if broken != 0
            && rest >= 0
            && (if rest_at_dot >= 0 {
                rest_at_dot
            } else {
                self.width_up_to(q) - rest_from + self.fast.follow
            }) <= rest
        {
            return Ok(self.no(refusal::Chain));
        }
        // more than two calls and an argument that is not simple: the chain is broken whether it fits or not
        if calls > 2 && complex {
            return Ok(self.no(refusal::Chain));
        }
        self.fast.shape = sh;
        self.fast.level = lv;
        self.fast.assignable = target && !optional;
        return Ok(q);
    }

    pub(crate) fn unary(&mut self, p: i32) -> R<i32> {
        self.stack()?;
        let c = self.t.at(p);
        let mut operand: i32 = 0;
        match c {
            33 | 126 => {
                operand = self.tight(p + 1);
            }
            43 | 45 => {
                if self.t.at(p + 1) == c {
                    return Ok(self.no(refusal::Update));
                }
                operand = self.tight(p + 1);
                if self.t.at(operand) == c {
                    return Ok(self.no(refusal::Unary));
                }
            }
            116 => {
                if (self.t.at(p + 6) == 32 || self.t.at(p + 6) == 9)
                    && self.text_is(p, p + 6, b"typeof")
                {
                    operand = self.spaced(p + 6);
                }
            }
            118 => {
                if (self.t.at(p + 4) == 32 || self.t.at(p + 4) == 9)
                    && self.text_is(p, p + 4, b"void")
                {
                    operand = self.spaced(p + 4);
                }
            }
            100 => {
                if (self.t.at(p + 6) == 32 || self.t.at(p + 6) == 9)
                    && self.text_is(p, p + 6, b"delete")
                {
                    operand = self.spaced(p + 6);
                }
            }
            97 => {
                if (self.t.at(p + 5) == 32 || self.t.at(p + 5) == 9)
                    && self.text_is(p, p + 5, b"await")
                {
                    let o = self.spaced(p + 5);
                    let d = self.t.at(o);
                    // Before a word, a number or a string TypeScript takes it for the operator everywhere; JavaScript where it can be one.
                    if (CC.at(d) & (ID_START | DIGIT)) == 0 && d != 34 && d != 39 {
                        return Ok(self.no(refusal::Await));
                    }
                    if (!self.fast.ts
                        && (!self.fast.await_is_operator
                            || self.fast.in_parameters != 0
                            || self.parse.place.in_parameters))
                        || self.dialect.declaration_file
                    {
                        return Ok(self.no(refusal::Await));
                    }
                    if p == self.fast.breakable_at {
                        self.fast.breakable_at = o;
                    }
                    let q = self.unary(o)?;
                    if q < 0 {
                        return Ok(-1);
                    }
                    // (for a parser that will find out that it stands among the parameters of an arrow function)
                    self.parse.suspensions += 1;
                    if self.parse.in_async == 0 {
                        self.need_module()?;
                    }
                    // a function that is awaited itself gets parentheses; one that is an argument does not
                    if self.fast.opened != 0 {
                        return Ok(if self.fast.pending_parens != 0 {
                            q
                        } else {
                            self.no(refusal::Await)
                        });
                    }
                    if self.fast.shape == SH_ARROW || self.fast.shape == SH_UPDATE {
                        return Ok(self.no(refusal::Await));
                    }
                    self.fast.shape = SH_AWAIT;
                    self.fast.level = NEVER;
                    self.fast.assignable = false;
                    return Ok(q);
                }
            }
            _ => {}
        }
        if operand != 0 {
            self.fast.no_block += 1;
            let q = self.unary(operand)?;
            self.fast.no_block -= 1;
            if q < 0 {
                return Ok(-1);
            }
            if self.fast.shape == SH_AWAIT
                || self.fast.shape == SH_ARROW
                || self.fast.shape == SH_UPDATE
            {
                return Ok(self.no(refusal::Unary));
            }
            // `delete a.#b`
            if c == 100 {
                let mut name = q;
                while (CC.at(self.t.at(name - 1)) & ID_PART) != 0 {
                    name -= 1;
                }
                if self.t.at(name - 1) == 35 {
                    return Ok(self.no(refusal::Unary));
                }
            }
            self.fast.shape = SH_UNARY;
            // `!`, `~`, `+`, `-` before something simple are simple
            if c > 96 {
                self.fast.level = NEVER;
            }
            self.fast.assignable = false;
            return Ok(q);
        }
        let q = self.chain(p)?;
        if q < 0 || self.fast.opened != 0 {
            return Ok(q);
        }
        let d = self.t.at(q);
        if (d == 43 || d == 45) && self.t.at(q + 1) == d {
            if !self.fast.assignable {
                return Ok(self.no(refusal::Update));
            }
            self.fast.shape = SH_UPDATE;
            self.fast.assignable = false;
            return Ok(q + 2);
        }
        return Ok(q);
    }
}
pub(crate) const OP_LOGICAL: i32 = 1;
pub(crate) const OP_COMPARISON: i32 = 2;
pub(crate) const OP_ADDITIVE: i32 = 3;
pub(crate) const OP_MULTIPLICATIVE: i32 = 4;
pub(crate) const OP_INSTANCEOF: i32 = 5;
impl Quick {
    /// An expression without a comma and without an assignment. Stops in front of what it does not know: whoever called looks at that.
    pub(crate) fn expression(&mut self, p: i32) -> R<i32> {
        self.fast.no_block += 1;
        let q = self.open_expression(p)?;
        self.fast.no_block -= 1;
        return Ok(q);
    }

    /// The same in a place where the expression can end with a function whose body the parser reads: see open_block().
    pub(crate) fn open_expression(&mut self, p: i32) -> R<i32> {
        self.stack()?;
        let mut q: i32;
        let first = self.t.at(p);
        // await, delete, typeof, void: told from other names by the second letter
        if (CC.at(first) & OPERATOR_START) == 0
            || (first > 96 && self.t.at(p + 1) != SECOND_LETTER.at(first))
        {
            q = self.chain(p)?;
            if q < 0 || self.fast.opened != 0 {
                return Ok(q);
            }
            let e = self.t.at(q);
            // most expressions are no more than that
            if (CC.at(e) & ENDS) != 0 {
                return Ok(q);
            }
            if (e == 43 || e == 45) && self.t.at(q + 1) == e {
                if !self.fast.assignable {
                    return Ok(self.no(refusal::Update));
                }
                self.fast.shape = SH_UPDATE;
                self.fast.assignable = false;
                q += 2;
            }
        } else {
            q = self.unary(p)?;
            if q < 0 || self.fast.opened != 0 {
                return Ok(q);
            }
        }
        if self.fast.shape == SH_ARROW {
            return Ok(q);
        }
        // the operand on the left of the operator that comes next
        let mut left = self.fast.shape;
        let mut operators: i32 = 0;
        // which one: they do not mix without parentheses
        let mut logical: i32 = 0;
        // there was a comparison since the last logical operator
        let mut compared = false;
        // which one, since the last operator of lower precedence
        let mut multiplicative: i32 = 0;
        // the same for `+` and `-`
        let mut added = false;
        let mut modulo = false;
        let mut cast = false;
        loop {
            let mut r = q;
            let mut c = self.t.at(r);
            if c == 32 || c == 9 {
                r = self.blanks(r);
                c = self.t.at(r);
            }
            let d = self.t.at(r + 1);
            let mut kind: i32 = 0;
            let mut length: i32 = 1;
            match c {
                38 | 124 => {
                    if d == c && self.t.at(r + 2) != 61 {
                        kind = OP_LOGICAL;
                        length = 2;
                    }
                }
                63 => {
                    if d == 63 {
                        if self.t.at(r + 2) != 61 {
                            kind = OP_LOGICAL;
                            length = 2;
                        }
                    } else if d != 46 || (CC.at(self.t.at(r + 2)) & DIGIT) != 0 {
                        // a ? b : c
                        if cast
                            || logical == 63
                            || (operators == 0 && left >= SH_UPDATE && left <= SH_AWAIT)
                        {
                            return Ok(self.no(refusal::Conditional));
                        }
                        self.spaced(q);
                        let v0 = self.spaced(r + 1);
                        q = self.expression(v0)?;
                        if q < 0 {
                            return Ok(-1);
                        }
                        if self.fast.shape >= SH_NULLISH {
                            return Ok(self.no(refusal::Conditional));
                        }
                        q = self.spaced(q);
                        if self.t.at(q) != 58 {
                            return Ok(self.no(refusal::Conditional));
                        }
                        let v1 = self.spaced(q + 1);
                        q = self.expression(v1)?;
                        if q < 0 {
                            return Ok(-1);
                        }
                        if self.fast.shape >= SH_NULLISH && self.fast.shape != SH_CONDITIONAL {
                            return Ok(self.no(refusal::Conditional));
                        }
                        self.fast.shape = SH_CONDITIONAL;
                        self.fast.level = NEVER;
                        self.fast.assignable = false;
                        return Ok(q);
                    }
                }
                61 | 33 => {
                    if d == 61 {
                        kind = OP_COMPARISON;
                        length = if self.t.at(r + 2) == 61 { 3 } else { 2 };
                    }
                }
                60 => {
                    if d != 60 {
                        kind = OP_COMPARISON;
                        if d == 61 {
                            length = 2;
                        }
                        self.fast.saw_less = 1;
                    }
                }
                62 => {
                    if d != 62 {
                        // `a < b > (c)` is a call in TypeScript
                        if self.fast.saw_less != 0 {
                            return Ok(self.no(refusal::Less));
                        }
                        kind = OP_COMPARISON;
                        if d == 61 {
                            length = 2;
                        }
                    }
                }
                43 | 45 => {
                    if d != c && d != 61 {
                        kind = OP_ADDITIVE;
                    }
                }
                42 => {
                    if d != 42 && d != 61 {
                        kind = OP_MULTIPLICATIVE;
                    }
                }
                47 => {
                    if d != 47 && d != 42 && d != 61 {
                        kind = OP_MULTIPLICATIVE;
                    }
                }
                37 => {
                    if d != 61 {
                        kind = OP_MULTIPLICATIVE;
                    }
                }
                105 => {
                    if r != q && self.word_is(r, b"instanceof") {
                        kind = OP_INSTANCEOF;
                        length = 10;
                    }
                }
                97 | 115 => {
                    if self.fast.ts
                        && r != q
                        && (if c == 97 {
                            self.word_is(r, b"as")
                        } else {
                            self.word_is(r, b"satisfies")
                        })
                    {
                        // Around a binary expression, an `await` .. it takes parentheses, and so it does inside of one.
                        if operators != 0 || (left >= SH_UPDATE && left != SH_AS) {
                            return Ok(self.no(refusal::As));
                        }
                        self.spaced(q);
                        q = self.spaced(r + (if c == 97 { 2 } else { 9 }));
                        if c == 97 && self.word_is(q, b"const") {
                            q += 5;
                        } else {
                            q = self.type_(q)?;
                            if q < 0 {
                                return Ok(-1);
                            }
                        }
                        left = SH_AS;
                        cast = true;
                        continue;
                    }
                }
                _ => {}
            }
            if kind == 0 {
                break;
            }
            if cast || left == SH_AWAIT || left == SH_UPDATE {
                return Ok(self.no(refusal::Mixed));
            }
            match kind {
                OP_LOGICAL => {
                    if logical != 0 && logical != c {
                        return Ok(self.no(refusal::Mixed));
                    }
                    logical = c;
                    modulo = false;
                    added = false;
                    compared = false;
                    multiplicative = 0;
                }
                OP_INSTANCEOF => {
                    // `!a instanceof B` gets parentheses
                    if left > SH_NEW || added || multiplicative != 0 {
                        return Ok(self.no(refusal::Mixed));
                    }
                    if compared {
                        return Ok(self.no(refusal::Mixed));
                    }
                    compared = true;
                    modulo = false;
                    added = false;
                    multiplicative = 0;
                }
                // falls through
                OP_COMPARISON => {
                    if compared {
                        return Ok(self.no(refusal::Mixed));
                    }
                    compared = true;
                    modulo = false;
                    added = false;
                    multiplicative = 0;
                }
                OP_ADDITIVE => {
                    if modulo {
                        return Ok(self.no(refusal::Mixed));
                    }
                    added = true;
                    multiplicative = 0;
                }
                _ => {
                    // `a * b / c`, `a % b % c`, `a + b % c`
                    if multiplicative != 0 && (multiplicative != c || c == 37) {
                        return Ok(self.no(refusal::Mixed));
                    }
                    if c == 37 {
                        if added {
                            return Ok(self.no(refusal::Mixed));
                        }
                        modulo = true;
                    }
                    multiplicative = c;
                }
            }
            operators += 1;
            self.spaced(q);
            self.fast.no_block += 1;
            let v2 = self.spaced(r + length);
            q = self.unary(v2)?;
            self.fast.no_block -= 1;
            if q < 0 {
                return Ok(-1);
            }
            left = self.fast.shape;
            if left == SH_ARROW || left == SH_AWAIT || left == SH_UPDATE {
                return Ok(self.no(refusal::Mixed));
            }
        }
        if operators != 0 {
            self.fast.shape = if logical == 63 { SH_NULLISH } else { SH_BINARY };
            self.fast.level = NEVER;
            self.fast.assignable = false;
        } else if cast {
            self.fast.shape = SH_AS;
            self.fast.level = NEVER;
            self.fast.assignable = false;
        }
        return Ok(q);
    }

    // --------------------------------------------------------------------------------------------------------- statements
    /// The end of the statement; p is behind its last token. Returns where the text ends in the source (behind the semicolon, if there is
    /// one) and sets ready_end and ready_next, or refuses.
    pub(crate) fn terminate(&mut self, p: i32, end_has_semicolon: bool) -> i32 {
        // arguments on lines of their own: the call has to be all there is
        if self.fast.broken_lists != 0
            && ((self.fast.shape != SH_CHAIN
                && self.fast.shape != SH_NEW
                && self.fast.shape != SH_AWAIT
                && self.fast.shape != SH_AS
                && self.fast.shape != SH_ARRAY)
                || (self.fast.has_lone_short_argument && self.fast.shape != SH_AS))
        {
            return self.no(refusal::Arguments);
        }
        if self.fast.parameters_need >= 0 && !self.head_is_too_wide(p, 1) {
            return self.no(refusal::Paren);
        }
        if self.t.at(p) == 59 && self.t.at(p + 1) == 10 {
            // `;` and the end of the line
            let mut e = p + 2;
            e = self.blanks_end(e);
            let c = self.t.at(e);
            if c < 128 && c != 9 {
                self.fast.ready_flags |= if c == 10 {
                    F_NEXT_LINE_KNOWN | F_NEXT_LINE_EMPTY
                } else {
                    F_NEXT_LINE_KNOWN
                };
            }
            self.fast.ready_end = if end_has_semicolon { p + 1 } else { p };
            self.fast.ready_next = p + 1;
            return p + 1;
        }
        let s = self.blanks(p);
        let c = self.t.at(s);
        if c == 59 {
            // only the end of the line or a line comment may follow: a block comment would count for the width
            let r = self.blanks(s + 1);
            let d = self.t.at(r);
            if d != 10
                && !(d == 47 && self.t.at(r + 1) == 47)
                && !(d == 0 && r >= self.text.src_end)
            {
                return self.no(refusal::End);
            }
            if d == 10 {
                self.look_behind_line(r);
            }
            self.tight(p);
            self.fast.ready_end = if end_has_semicolon { s + 1 } else { p };
            self.fast.ready_next = s + 1;
            return s + 1;
        }
        if c != 10 && !(c == 47 && self.t.at(s + 1) == 47) && !(c == 0 && s >= self.text.src_end) {
            return self.no(refusal::End);
        }
        // No semicolon. The statement ends here if what comes next cannot go on with it.
        if self.fast.saw_less != 0 && self.fast.has_types {
            // `a < keyof`, and `b > (c)` on the next line: type arguments
            return self.no(refusal::NoSemicolon);
        }
        let n = self.next_char_index(s);
        let d = self.t.at(n);
        if (CC.at(d) & ID_START) != 0 {
            // in, instanceof; `is` behind a type; `with` behind an import; in Flow `extends` behind a type
            if (d == 105 && matches!(self.t.at(n + 1), 110 | 115))
                || (d == 119 && self.t.at(n + 1) == 105)
                || (d == 101 && self.fast.flow && self.word_is(n, b"extends"))
            {
                return self.no(refusal::NoSemicolon);
            }
        } else if d != 125
            && d != 64
            && d != 34
            && d != 39
            && (CC.at(d) & DIGIT) == 0
            && !(d == 35 && self.fast.in_class)
            && !(d == 0 && n >= self.text.src_end)
        {
            return self.no(refusal::NoSemicolon);
        }
        if c == 10 {
            self.look_behind_line(s);
        }
        self.flush(p);
        self.put(59);
        self.fast.ready_end = p;
        self.fast.ready_next = p;
        return p;
    }

    /// The line ends at p, right behind the statement. Is the next line empty? The printer will want to know: is_next_line_empty().
    pub(crate) fn look_behind_line(&mut self, p: i32) {
        let c = self.t.at(self.blanks(p + 1));
        if c < 128 {
            self.fast.ready_flags |= if c == 10 {
                F_NEXT_LINE_KNOWN | F_NEXT_LINE_EMPTY
            } else {
                F_NEXT_LINE_KNOWN
            };
        }
    }

    /// `= value` and the end of a declaration or an assignment; p is at the `=`, q behind what is on its left.
    pub(crate) fn initializer(&mut self, q: i32, p: i32, length: i32, may_be_jsx: bool) -> R<i32> {
        self.spaced(q);
        let value = self.spaced(p + length);
        // (an object pattern on the left has no group of its own)
        if self.fast.no_block == 0 {
            self.fast.breakable_at = value;
            self.fast.is_value = true;
        }
        let e = self.open_expression(value)?;
        if e >= 0 || !may_be_jsx {
            return Ok(e);
        }
        return Ok(if self.is_jsx_in_parens(value) {
            self.open_jsx(value, 0)
        } else {
            self.or_jsx(value)?
        });
    }

    /// How long the assignment operator at p is, or 0.
    pub(crate) fn assignment_operator(&self, p: i32) -> i32 {
        let c = self.t.at(p);
        let d = self.t.at(p + 1);
        match c {
            61 => {
                return if d != 61 && d != 62 { 1 } else { 0 };
            }
            43 | 45 | 42 | 47 | 37 => {
                return if d == 61 { 2 } else { 0 };
            }
            124 | 38 | 63 => {
                return if d == c && self.t.at(p + 2) == 61 {
                    3
                } else {
                    0
                };
            }
            _ => {}
        }
        return 0;
    }
}
// 1 for the first letters of the names below
pub(crate) static TEST_START: [u8; 256] = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 1, 1, 0, 1, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];
impl Quick {
    /// is_test_call() of Prettier: `it("..", () => {`, `describe.only("..", function () {`, `it("..", fakeAsync(() => {`, `beforeEach(waitForAsync(() => {`. The arguments of such a call
    /// are printed one behind the other, with nothing that could break but the body of the function: the head stays on its line however long it is. p is at the name, which ends at e.
    /// Returns where the `{` is, or -1: then the statement may still be read as any other, from the start; or -2: the same, and nothing has been touched.
    pub(crate) fn test_call(&mut self, p: i32, e: i32) -> R<i32> {
        let mut is_set_up = false;
        let mut may_have_dot = false;
        match e - p {
            2 => {
                if !self.word_is(p, b"it") {
                    return Ok(-2);
                }
                may_have_dot = true;
            }
            3 => {
                if !self.word_is(p, b"xit") && !self.word_is(p, b"fit") {
                    return Ok(-2);
                }
            }
            4 => {
                if self.word_is(p, b"test") {
                    may_have_dot = true;
                } else if !self.word_is(p, b"skip") {
                    return Ok(-2);
                }
            }
            5 => {
                if !self.word_is(p, b"xtest") && !self.word_is(p, b"ftest") {
                    return Ok(-2);
                }
            }
            8 => {
                if self.word_is(p, b"describe") {
                    may_have_dot = true;
                } else if self.word_is(p, b"afterAll") {
                    is_set_up = true;
                } else {
                    return Ok(-2);
                }
            }
            9 => {
                if self.word_is(p, b"afterEach") || self.word_is(p, b"beforeAll") {
                    is_set_up = true;
                } else if !self.word_is(p, b"xdescribe") && !self.word_is(p, b"fdescribe") {
                    return Ok(-2);
                }
            }
            10 => {
                if !self.word_is(p, b"beforeEach") {
                    return Ok(-2);
                }
                is_set_up = true;
            }
            _ => {
                return Ok(-2);
            }
        }
        let mut q = e;
        if self.t.at(q) == 46 {
            if !may_have_dot || (!self.word_is(q + 1, b"only") && !self.word_is(q + 1, b"skip")) {
                return Ok(-2);
            }
            q += 5;
        }
        if self.t.at(q) != 40 {
            return Ok(-2);
        }
        q += 1;
        if !is_set_up {
            if self.t.at(q) != 34 && self.t.at(q) != 39 {
                return Ok(-2);
            }
            // (the room for generated texts that was reserved is 2048 bytes)
            self.fast.room = 1500;
            self.fast.limit = p + 1500;
            q = self.string(q);
            if q < 0 || self.t.at(q) != 44 {
                return Ok(-1);
            }
            q = self.spaced(q + 1);
        }
        let mut parens: i32 = 1;
        let wrapper = if self.word_is(q, b"fakeAsync") {
            9
        } else {
            if self.word_is(q, b"waitForAsync") {
                12
            } else {
                0
            }
        };
        if wrapper != 0 {
            q += wrapper;
            if self.t.at(q) != 40 {
                return Ok(-1);
            }
            q += 1;
            parens = 2;
            self.fast.room = 1500;
            self.fast.limit = p + 1500;
        } else if is_set_up {
            return Ok(-1);
        }
        let mut is_async = false;
        if self.word_is(q, b"async") && self.t.at(q + 5) == 32 {
            is_async = true;
            q = self.spaced(q + 5);
        }
        let parameters_at = q;
        if self.t.at(q) == 40 {
            q = self.arrow_with_parens(q, is_async)?;
        } else if self.word_is(q, b"function") {
            q = self.function_head(q + 8, is_async, false)?;
        } else {
            return Ok(-1);
        }
        if q < 0 || self.fast.opened == 0 || (self.fast.opened_flags & BLOCK_JSX) != 0 {
            return Ok(-1);
        }
        // (Prettier does not see that a function in a wrapper is in a test call: its parameters break where the line is too long.)
        if wrapper != 0 {
            let mut i = parameters_at;
            while i < q && self.t.at(i) != 40 {
                i += 1;
            }
            if self.t.at(self.blanks(i + 1)) != 41 {
                return Ok(-1);
            }
        }
        // Nothing in the head can be broken if the parameters are names and no more. A pattern, a type, a default value can.
        let mut i = parameters_at;
        while i < q {
            let c = self.t.at(i);
            if c == 123 || c == 91 || c == 58 || c == 60 || (c == 61 && self.t.at(i + 1) != 62) {
                return Ok(-1);
            }
            i += 1;
        }
        self.fast.pending_parens = parens;
        self.fast.ready_flags |= F_ANY_WIDTH;
        return Ok(q);
    }

    pub(crate) fn expression_statement(&mut self, p: i32) -> R<i32> {
        self.fast.ready_kind = k::ExpressionStatement;
        self.fast.tail = TAIL_STATEMENT;
        if TEST_START.at(self.t.at(p)) != 0
            && self.fast.scanned_at == p
            && self.fast.scanned_end - p <= 10
        {
            let head = self.test_call(p, self.fast.scanned_end)?;
            if head >= 0 {
                return Ok(head);
            }
            if head == -1 {
                // from the start
                if !self.prepare_at(p, self.fast.column) {
                    return Ok(-1);
                }
                self.fast.why = 0;
            }
        }
        self.fast.breakable_at = p;
        let mut q = self.open_expression(p)?;
        if q < 0 || self.fast.opened != 0 {
            return Ok(q);
        }
        if self.t.at(q) == 59 && self.fast.shape != SH_ARROW && self.fast.shape != SH_AS {
            return Ok(self.terminate(q, false));
        }
        if self.fast.shape == SH_ARROW || self.fast.shape == SH_AS {
            return Ok(self.no(refusal::Start));
        }
        let r = self.blanks(q);
        let length = self.assignment_operator(r);
        if length != 0 {
            if !self.fast.assignable {
                return Ok(self.no(refusal::Target));
            }
            q = self.initializer(q, r, length, true)?;
            if q < 0 || self.fast.opened != 0 {
                return Ok(q);
            }
        }
        return Ok(self.terminate(q, false));
    }

    /// `[a, b, ...c]` on the left of a declaration; p is at the `[`.
    pub(crate) fn array_pattern(&mut self, p: i32) -> i32 {
        let mut q = self.tight(p + 1);
        loop {
            let is_rest = self.t.at(q) == 46 && self.t.at(q + 1) == 46 && self.t.at(q + 2) == 46;
            if is_rest {
                q += 3;
            }
            if (CC.at(self.t.at(q)) & ID_START) == 0 {
                return self.no(refusal::Pattern);
            }
            let e = self.word_end(q);
            if (CC.at(self.t.at(e)) & BEYOND) != 0 {
                return self.no(refusal::NotAscii);
            }
            if !is_plain_name(self.keyword_at(q, e - q)) {
                return self.no(refusal::Pattern);
            }
            q = self.tight(e);
            let c = self.t.at(q);
            if c == 93 {
                return q + 1;
            }
            if c != 44 || is_rest {
                return self.no(refusal::Pattern);
            }
            let r = self.blanks(q + 1);
            if self.t.at(r) == 93 {
                return self.no(refusal::Pattern);
            }
            q = self.spaced(q + 1);
        }
    }

    /// One declarator and the end; p is behind `const`, `let` or `var`.
    pub(crate) fn declaration(&mut self, p: i32, mut needs_value: bool) -> R<i32> {
        if self.t.at(p) != 32 && self.t.at(p) != 9 {
            return Ok(self.no(refusal::Declaration));
        }
        let mut q = self.spaced(p);
        let c = self.t.at(q);
        if (CC.at(c) & ID_START) != 0 {
            let e = self.word_end(q);
            if (CC.at(self.t.at(e)) & BEYOND) != 0 {
                return Ok(self.no(refusal::NotAscii));
            }
            if !is_plain_name(self.keyword_at(q, e - q)) {
                return Ok(self.no(refusal::Binding));
            }
            q = e;
        } else if c == 123 {
            q = self.object_literal(q, true)?;
            needs_value = true;
        } else if c == 91 {
            q = self.array_pattern(q);
            needs_value = true;
        } else {
            return Ok(self.no(refusal::Binding));
        }
        if q < 0 {
            return Ok(-1);
        }
        let mut r = self.blanks(q);
        if self.t.at(r) == 58 {
            if !self.fast.has_types {
                return Ok(self.no(refusal::Binding));
            }
            self.tight(q);
            let v0 = self.spaced(r + 1);
            q = self.type_(v0)?;
            if q < 0 {
                return Ok(-1);
            }
            r = self.blanks(q);
        }
        if self.t.at(r) == 61 && self.assignment_operator(r) == 1 {
            self.fast.tail = TAIL_STATEMENT;
            // An object pattern in this place has no group of its own: a block on the right would break it.
            if c == 123 {
                self.fast.no_block += 1;
            }
            q = self.initializer(q, r, 1, true)?;
            if q < 0 || self.fast.opened != 0 {
                return Ok(q);
            }
        } else if needs_value && (!self.fast.ts || c == 123 || c == 91) {
            // (`const a: A;` stands in declaration files)
            return Ok(self.no(refusal::Declaration));
        }
        return Ok(self.terminate(q, false));
    }

    /// Is the word T[p, e) one that cannot be bound? `kw` is what keyword_at() says.
    fn is_word_of_language(kw: i32) -> bool {
        (kw & 255) > tk::Name || (kw >> 8) == kw::Enum
    }

    /// T[p, e) is a name that is exported. False if it is `default` and the file exports another one.
    fn may_export(&mut self, p: i32, e: i32) -> bool {
        e - p != 7 || !self.text_is(p, e, b"default") || !self.is_second_default_export(p)
    }

    /// `{ a, b as c }` of an import or export; p is at the `{`.
    pub(crate) fn specifiers(&mut self, p: i32, is_export: bool) -> i32 {
        self.fast.needs_from = false;
        let mut q = self.blanks(p + 1);
        if self.t.at(q) == 125 {
            if !is_export {
                return self.no(refusal::Import);
            }
            self.tight(p + 1);
            return q + 1;
        }
        q = self.in_brace(p + 1);
        loop {
            if (CC.at(self.t.at(q)) & ID_START) == 0 {
                return self.no(refusal::Import);
            }
            let mut e = self.word_end(q);
            if (CC.at(self.t.at(e)) & BEYOND) != 0 {
                return self.no(refusal::NotAscii);
            }
            if e > self.fast.limit {
                return self.no(refusal::Long);
            }
            if e - q == 4 && self.text_is(q, e, b"type") {
                // `type A`, in TypeScript. `type` as a name, and `type as ..`, are left to the parser.
                let name = self.blanks(e);
                if !self.fast.has_types
                    || (self.fast.flow && is_export)
                    || name == e
                    || (CC.at(self.t.at(name)) & ID_START) == 0
                    || self.word_is(name, b"as")
                {
                    return self.no(refusal::Import);
                }
                q = self.spaced(e);
                e = self.word_end(q);
                if (CC.at(self.t.at(e)) & BEYOND) != 0 {
                    return self.no(refusal::NotAscii);
                }
                if (self.keyword_at(q, e - q) & 255) > tk::Name {
                    return self.no(refusal::Import);
                }
            }
            let is_word_of_language = Self::is_word_of_language(self.keyword_at(q, e - q));
            if is_word_of_language {
                self.fast.needs_from = true;
            }
            let mut name = q;
            q = e;
            let a = self.blanks(q);
            if a != q && self.word_is(a, b"as") {
                self.spaced(q);
                q = self.spaced(a + 2);
                if (CC.at(self.t.at(q)) & ID_START) == 0 {
                    return self.no(refusal::Import);
                }
                e = self.word_end(q);
                if (CC.at(self.t.at(e)) & BEYOND) != 0 {
                    return self.no(refusal::NotAscii);
                }
                if !is_export && Self::is_word_of_language(self.keyword_at(q, e - q)) {
                    return self.no(refusal::Import);
                }
                name = q;
                q = e;
            } else if is_word_of_language && !is_export {
                return self.no(refusal::Import);
            }
            if is_export && !self.may_export(name, q) {
                return self.no(refusal::Export);
            }
            let s = self.blanks(q);
            let c = self.t.at(s);
            if c == 125 {
                return self.in_brace(q) + 1;
            }
            if c != 44 {
                return self.no(refusal::Import);
            }
            let r = self.blanks(s + 1);
            if self.t.at(r) == 125 {
                self.flush(q);
                if self.options.bracket_spacing {
                    self.put(32);
                }
                self.fast.run = r;
                return r + 1;
            }
            self.tight(q);
            q = self.spaced(s + 1);
        }
    }

    /// specifiers() for a list that may stand on several lines, and is printed on one or, with `is_broken`, with each name on a line of its own.
    pub(crate) fn specifier_list(&mut self, p: i32, is_export: bool, is_broken: bool) -> i32 {
        let inner = self.fast.column + self.options.tab_width;
        let mut q = if is_broken {
            self.line_break(p + 1, inner)
        } else {
            if self.options.bracket_spacing {
                self.spaced_over(p + 1)
            } else {
                self.tight_over(p + 1)
            }
        };
        let mut count: i32 = 0;
        let mut width = if self.options.bracket_spacing { 2 } else { 0 };
        self.fast.needs_from = false;
        loop {
            if (CC.at(self.t.at(q)) & ID_START) == 0 {
                return self.no(refusal::Import);
            }
            let mut e = self.word_end(q);
            if (CC.at(self.t.at(e)) & BEYOND) != 0 {
                return self.no(refusal::NotAscii);
            }
            if e > self.fast.limit {
                return self.no(refusal::Long);
            }
            let before = self.width_up_to(q);
            count += 1;
            if e - q == 4 && self.text_is(q, e, b"type") {
                let name = self.blanks(e);
                if !self.fast.has_types
                    || (self.fast.flow && is_export)
                    || name == e
                    || (CC.at(self.t.at(name)) & ID_START) == 0
                    || self.word_is(name, b"as")
                {
                    return self.no(refusal::Import);
                }
                q = self.spaced(e);
                e = self.word_end(q);
                if (CC.at(self.t.at(e)) & BEYOND) != 0 {
                    return self.no(refusal::NotAscii);
                }
                if (self.keyword_at(q, e - q) & 255) > tk::Name {
                    return self.no(refusal::Import);
                }
            }
            let is_word_of_language = Self::is_word_of_language(self.keyword_at(q, e - q));
            if is_word_of_language {
                self.fast.needs_from = true;
            }
            let mut name = q;
            q = e;
            let a = self.blanks(q);
            if a != q && self.word_is(a, b"as") {
                self.spaced(q);
                q = self.spaced(a + 2);
                if (CC.at(self.t.at(q)) & ID_START) == 0 {
                    return self.no(refusal::Import);
                }
                e = self.word_end(q);
                if (CC.at(self.t.at(e)) & BEYOND) != 0 {
                    return self.no(refusal::NotAscii);
                }
                if !is_export && Self::is_word_of_language(self.keyword_at(q, e - q)) {
                    return self.no(refusal::Import);
                }
                name = q;
                q = e;
            } else if is_word_of_language && !is_export {
                return self.no(refusal::Import);
            }
            if is_export && !self.may_export(name, q) {
                return self.no(refusal::Export);
            }
            width = width + 2 + self.width_up_to(q) - before;
            let s = self.white(q);
            let c = self.t.at(s);
            let mut close = s;
            if c == 44 {
                close = self.white(s + 1);
                if self.t.at(close) != 125 {
                    self.tight_over(q);
                    q = if is_broken {
                        self.line_break(s + 1, inner)
                    } else {
                        self.spaced_over(s + 1)
                    };
                    continue;
                }
            } else if c != 125 {
                return self.no(refusal::Import);
            }
            // the last one: q is behind it, `close` at the `}`; there may be a comma between
            if !is_broken {
                if close != q + (if self.options.bracket_spacing { 1 } else { 0 })
                    || (self.options.bracket_spacing && self.t.at(q) != 32)
                {
                    self.flush(q);
                    if self.options.bracket_spacing {
                        self.put(32);
                    }
                    self.fast.run = close;
                }
            } else if self.options.trailing_comma == TRAILING_COMMA_NONE {
                if c == 44 {
                    self.flush(q);
                    self.fast.run = s + 1;
                }
                self.line_break(if c == 44 { s + 1 } else { q }, self.fast.column);
            } else if c == 44 {
                self.tight_over(q);
                self.line_break(s + 1, self.fast.column);
            } else {
                self.flush(q);
                self.put(44);
                self.line_break(q, self.fast.column);
            }
            self.fast.list_count = count;
            self.fast.list_width = width;
            self.fast.width_at_list_end = self.width_up_to(close + 1);
            return close + 1;
        }
    }

    /// What follows the list of an import or export, to the end of the statement.
    pub(crate) fn behind_specifiers(&mut self, q: i32, is_export: bool) -> i32 {
        if !is_export {
            return self.from_source(q);
        }
        let c = self.t.at(self.blanks(q));
        if c == 102 {
            return self.from_source(q);
        }
        // without a semicolon, `from` can follow on the next line
        if c != 59 || self.fast.needs_from {
            return self.no(refusal::NoSemicolon);
        }
        return self.terminate(q, false);
    }

    /// The list of an import or export at p, in whatever layout it stands there, and the rest of the statement. `has_others`: a name stands in front of the list (`import a, { b }`).
    /// The list is a group: on one line if the statement fits, else each name on a line of its own.
    pub(crate) fn specifiers_and_rest(&mut self, p: i32, is_export: bool, has_others: bool) -> i32 {
        // (what was too long has not been written, and the attempts below start from what has been)
        if self.fast.too_long {
            return self.no(refusal::Long);
        }
        let run0 = self.fast.run;
        let out0 = self.fast.out;
        let prefix = self.width_up_to(p);
        // 0: as specifiers() reads it, on one line; 1: broken; 2: on one line, whatever the source looks like
        let mut mode = if self.t.at(self.blanks(p + 1)) == 10 {
            1
        } else {
            0
        };
        if mode != 0 {
            if !self.fast.breaks_here {
                return self.no(refusal::Import);
            }
            self.fast.limit = p + 1400;
        }
        loop {
            let mut q = if mode == 0 {
                self.specifiers(p, is_export)
            } else {
                self.specifier_list(p, is_export, mode == 1)
            };
            if q >= 0 {
                q = self.behind_specifiers(q, is_export);
            }
            if mode == 0 {
                if !self.fast.breaks_here
                    || (if q >= 0 {
                        self.width_up_to(q) <= self.fast.room
                    } else {
                        self.fast.why != refusal::Long
                    })
                {
                    return q;
                }
                // (from here on what counts is the width there is, if the column is what it seems: the printer will see to that)
                mode = 1;
            } else if mode == 1 {
                if q < 0 {
                    return -1;
                }
                if prefix + self.fast.list_width + self.width_up_to(q) - self.fast.width_at_list_end
                    > self.options.print_width - self.fast.column
                {
                    // a single name is not put on a line of its own
                    if self.fast.list_count < 2 && !has_others {
                        return self.no(refusal::Wide);
                    }
                    self.fast.ready_flags |= F_DECIDED;
                    return q;
                }
                mode = 2;
            } else {
                return q;
            }
            self.fast.run = run0;
            self.fast.out = out0;
            self.fast.why = 0;
            self.fast.too_long = false;
            self.fast.line_breaks = 0;
            self.fast.ready_flags = 0;
            // (the room for generated texts that was reserved is 2048 bytes)
            self.fast.limit = p + 1400;
        }
    }

    /// ` from "source"` and the end; p is behind what is imported or exported.
    pub(crate) fn from_source(&mut self, p: i32) -> i32 {
        let mut q = self.spaced(p);
        if !self.word_is(q, b"from") {
            return self.no(refusal::Import);
        }
        q = self.spaced(q + 4);
        if self.t.at(q) != 34 && self.t.at(q) != 39 {
            return self.no(refusal::Import);
        }
        q = self.string(q);
        if q < 0 {
            return -1;
        }
        return self.terminate(q, false);
    }

    /// A name that an import binds; returns its end.
    pub(crate) fn imported_name(&mut self, p: i32) -> i32 {
        if (CC.at(self.t.at(p)) & ID_START) == 0 {
            return self.no(refusal::Import);
        }
        let e = self.word_end(p);
        if (CC.at(self.t.at(e)) & BEYOND) != 0 {
            return self.no(refusal::NotAscii);
        }
        // `from`, `defer`, `source`, `module`, `type` can be something else in this place
        if self.keyword_at(p, e - p) != 0 || (e - p == 4 && self.text_is(p, e, b"type")) {
            return self.no(refusal::Import);
        }
        return e;
    }

    /// p is behind `import`.
    pub(crate) fn import_declaration(&mut self, p: i32) -> i32 {
        if self.t.at(p) != 32 && self.t.at(p) != 9 {
            return self.no(refusal::Import);
        }
        self.fast.ready_kind = k::ImportDeclaration;
        let mut q = self.spaced(p);
        let mut c = self.t.at(q);
        if c == 34 || c == 39 {
            q = self.string(q);
            if q < 0 {
                return -1;
            }
            return self.terminate(q, false);
        }
        let mut is_type = false;
        let mut has_others = false;
        if c == 116
            && self.fast.has_types
            && (self.word_is(q, b"type") || (self.fast.flow && self.word_is(q, b"typeof")))
        {
            // import type { A }, import type * as a, import type A from; `import type from` and `import type, ..` are left to the parser
            let word = if self.t.at(q + 4) == 111 { 6 } else { 4 };
            let r = self.blanks(q + word);
            let d = self.t.at(r);
            if d != 123
                && (d != 42 || (self.fast.flow && word == 4))
                && ((CC.at(d) & ID_START) == 0 || self.word_is(r, b"from"))
            {
                return self.no(refusal::Import);
            }
            q = self.spaced(q + word);
            c = d;
            is_type = true;
        }
        if (CC.at(c) & ID_START) != 0 {
            q = self.imported_name(q);
            if q < 0 {
                return -1;
            }
            let r = self.blanks(q);
            if self.t.at(r) != 44 {
                return self.from_source(q);
            }
            if is_type {
                return self.no(refusal::Import);
            }
            self.tight(q);
            q = self.spaced(r + 1);
            c = self.t.at(q);
            has_others = true;
        }
        if c == 42 {
            q = self.spaced(q + 1);
            if !self.word_is(q, b"as") {
                return self.no(refusal::Import);
            }
            let v0 = self.spaced(q + 2);
            q = self.imported_name(v0);
        } else if c == 123 {
            return self.specifiers_and_rest(q, false, has_others);
        } else {
            return self.no(refusal::Import);
        }
        if q < 0 {
            return -1;
        }
        return self.from_source(q);
    }

    /// `type A = B`; p is behind `type`, where a blank stands.
    pub(crate) fn type_alias(&mut self, p: i32, end_has_semicolon: bool) -> R<i32> {
        let mut q = self.spaced(p);
        if (CC.at(self.t.at(q)) & ID_START) == 0 {
            return Ok(self.no(refusal::Declaration));
        }
        let e = self.word_end(q);
        if (CC.at(self.t.at(e)) & BEYOND) != 0 {
            return Ok(self.no(refusal::NotAscii));
        }
        if self.keyword_at(q, e - q) != 0 {
            return Ok(self.no(refusal::Declaration));
        }
        // not the name of a type that is there already
        if self.fast.flow && (self.is_keyword_type(q, e - q) || self.flow_type_word(q, e - q)) {
            return Ok(self.no(refusal::Declaration));
        }
        q = self.spaced(e);
        if self.t.at(q) != 61 || self.t.at(q + 1) == 61 || self.t.at(q + 1) == 62 {
            return Ok(self.no(refusal::Declaration));
        }
        let v0 = self.spaced(q + 1);
        q = self.type_(v0)?;
        if q < 0 {
            return Ok(-1);
        }
        return Ok(self.terminate(q, end_has_semicolon));
    }

    /// p is behind `export`.
    /// `A`, `A.B`, where a plain name is asked for first; p is at its start.
    pub(crate) fn dotted_name(&mut self, p: i32) -> i32 {
        if (CC.at(self.t.at(p)) & ID_START) == 0 {
            return self.no(refusal::Start);
        }
        let mut q = self.word_end(p);
        if !is_plain_name(self.keyword_at(p, q - p)) || self.word_is(p, b"implements") {
            return self.no(refusal::Start);
        }
        while self.t.at(q) == 46 {
            if (CC.at(self.t.at(q + 1)) & ID_START) == 0 {
                return self.no(refusal::Start);
            }
            q = self.word_end(q + 1);
        }
        if (CC.at(self.t.at(q)) & BEYOND) != 0 {
            return self.no(refusal::NotAscii);
        }
        if q > self.fast.limit {
            return self.no(refusal::Long);
        }
        return q;
    }

    /// ` A, B.C`; p is behind the word in front of them.
    pub(crate) fn dotted_names(&mut self, p: i32) -> i32 {
        if self.t.at(p) != 32 && self.t.at(p) != 9 {
            return self.no(refusal::Start);
        }
        let mut q = self.spaced(p);
        loop {
            q = self.dotted_name(q);
            if q < 0 {
                return -1;
            }
            let r = self.blanks(q);
            if self.t.at(r) != 44 {
                return q;
            }
            self.tight(q);
            q = self.spaced(r + 1);
        }
    }

    /// `class A extends B.C implements D, E {` and `interface A extends B, C {` with names and nothing else; p is behind the word `class` or `interface`. With more than `extends B` the
    /// head is a group, which is flat if it fits; the body is there for the parser. A body with nothing in it is `{}`.
    pub(crate) fn class_head(&mut self, p: i32, is_interface: bool) -> i32 {
        if self.fast.flow || (self.t.at(p) != 32 && self.t.at(p) != 9) {
            return self.no(refusal::Start);
        }
        let mut q = self.spaced(p);
        let e = self.word_end(q);
        if (CC.at(self.t.at(q)) & ID_START) == 0
            || (CC.at(self.t.at(e)) & BEYOND) != 0
            || !is_plain_name(self.keyword_at(q, e - q))
        {
            return self.no(refusal::Start);
        }
        if (self.fast.ts && self.is_declaration_word(q, e - q)) || self.word_is(q, b"implements") {
            return self.no(refusal::Start);
        }
        q = e;
        let mut r = self.blanks(q);
        let is_derived = r != q && self.word_is(r, b"extends");
        if is_derived {
            self.spaced(q);
            q = if is_interface {
                self.dotted_names(r + 7)
            } else {
                if self.t.at(r + 7) == 32 || self.t.at(r + 7) == 9 {
                    {
                        let v0 = self.spaced(r + 7);
                        self.dotted_name(v0)
                    }
                } else {
                    self.no(refusal::Start)
                }
            };
            if q < 0 {
                return -1;
            }
            r = self.blanks(q);
        }
        if r != q && self.fast.ts && !is_interface && self.word_is(r, b"implements") {
            self.spaced(q);
            q = self.dotted_names(r + 10);
            if q < 0 {
                return -1;
            }
            r = self.blanks(q);
        }
        if self.t.at(r) != 123 {
            return self.no(refusal::Start);
        }
        self.spaced(q);
        self.fast.tail = TAIL_NONE;
        return self.open_block(
            r,
            if is_interface {
                BLOCK_INTERFACE
            } else if is_derived {
                BLOCK_CLASS | BLOCK_DERIVED
            } else {
                BLOCK_CLASS
            },
        );
    }

    /// `class`, `abstract class` or `interface` at p, and the head behind it; or -1.
    pub(crate) fn class_or_interface(&mut self, p: i32) -> i32 {
        if self.word_is(p, b"class") {
            return self.class_head(p + 5, false);
        }
        if !self.fast.ts {
            return self.no(refusal::Start);
        }
        if self.word_is(p, b"interface") {
            return self.class_head(p + 9, true);
        }
        if self.word_is(p, b"abstract") && (self.t.at(p + 8) == 32 || self.t.at(p + 8) == 9) {
            let q = self.spaced(p + 8);
            if self.word_is(q, b"class") {
                return self.class_head(q + 5, false);
            }
        }
        return self.no(refusal::Start);
    }

    pub(crate) fn export_declaration(&mut self, p: i32) -> R<i32> {
        if self.t.at(p) != 32 && self.t.at(p) != 9 {
            return Ok(self.no(refusal::Export));
        }
        self.fast.ready_kind = k::ExportNamedDeclaration;
        let mut q = self.spaced(p);
        let mut c = self.t.at(q);
        if c == 116 && self.fast.has_types && self.word_is(q, b"type") {
            let r = self.blanks(q + 4);
            let d = self.t.at(r);
            if r == q + 4 {
                return Ok(self.no(refusal::Export));
            }
            if d != 123 && d != 42 {
                return self.type_alias(q + 4, false);
            }
            q = self.spaced(q + 4);
            c = d;
        }
        if c == 42 {
            let r = self.blanks(q + 1);
            if self.word_is(r, b"as") {
                self.spaced(q + 1);
                q = self.spaced(r + 2);
                if (CC.at(self.t.at(q)) & ID_START) == 0 {
                    return Ok(self.no(refusal::Export));
                }
                let name = q;
                q = self.word_end(q);
                if (CC.at(self.t.at(q)) & BEYOND) != 0 {
                    return Ok(self.no(refusal::NotAscii));
                }
                if !self.may_export(name, q) {
                    return Ok(self.no(refusal::Export));
                }
                return Ok(self.from_source(q));
            }
            self.fast.ready_kind = k::ExportAllDeclaration;
            return Ok(self.from_source(q + 1));
        }
        if c == 123 {
            return Ok(self.specifiers_and_rest(q, true, false));
        }
        if (CC.at(c) & ID_START) == 0 {
            return Ok(self.no(refusal::Export));
        }
        let e = self.word_end(q);
        if c == 99 || c == 105 || c == 97 {
            let head = self.class_or_interface(q);
            if head >= 0 {
                return Ok(head);
            }
            // another word with that letter, if nothing has been written yet
            if self.fast.out != 0 {
                return Ok(-1);
            }
            self.fast.why = 0;
        }
        match self.keyword_at(q, e - q) {
tk::Const => {
return self.declaration(e, true);
}
tk::Var | /* Tk.Name | (Kw.Let << 8) */ 769 => {
return self.declaration(e, false);
}
tk::Function => {
self.fast.tail = TAIL_NONE;
return self.function_head(e, false, true);
}
/* Tk.Name | (Kw.Async << 8) */ 257 => {
{
let r = self.blanks(e);
if r == e || !self.word_is(r, b"function") {
return Ok(self.no(refusal::Export));
}
self.spaced(e);
self.fast.tail = TAIL_NONE;
return self.function_head(r + 8, true, true);
}
}
tk::Default => {
{
if (self.t.at(e) != 32 && self.t.at(e) != 9) || !self.may_export(q, e) {
return Ok(self.no(refusal::Export));
}
q = self.spaced(e);
if self.t.at(q) == 99 && self.word_is(q, b"class") {
self.fast.ready_kind = k::ExportDefaultDeclaration;
return Ok(self.class_head(q + 5, false));
}
if self.t.at(q) == 123 {
self.fast.ready_kind = k::ExportDefaultDeclaration;
self.fast.tail = TAIL_STATEMENT;
q = self.object_literal(q, false)?;
return Ok(if self.fast.opened != 0 { q } else { self.no(refusal::Export) });
}
// a name that starts no declaration, or `new`
if (CC.at(self.t.at(q)) & ID_START) == 0 {
return Ok(self.no(refusal::Export));
}
let w = self.word_end(q);
let kw = self.keyword_at(q, w - q);
if (kw != 0 && kw != tk::New && kw != tk::This) || self.is_declaration_word(q, w - q) || (self.fast.flow && self.is_flow_declaration_word(q, w - q)) {
return Ok(self.no(refusal::Export));
}
q = self.expression(q)?;
if q < 0 {
return Ok(-1);
}
if self.fast.shape > SH_NEW {
return Ok(self.no(refusal::Export));
}
self.fast.ready_kind = k::ExportDefaultDeclaration;
return Ok(self.terminate(q, false));
}
}
_ => {}
}
        return Ok(self.no(refusal::Export));
    }

    /// What stands behind `if (a)` on its line, at p, if it is no block but a simple statement and no `else` follows: `return b;`, `throw c;`, `break;`, `continue;`, a call, an
    /// assignment. The condition, a line and the statement are one group, so all of it is printed flat if it fits. Returns what terminate() returns.
    fn plain_clause(&mut self, p: i32) -> R<i32> {
        let first = self.t.at(p);
        if (CC.at(first) & ID_START) == 0 {
            return Ok(self.no(refusal::Block));
        }
        let end = self.name_end(p + 1);
        if (CC.at(self.t.at(end)) & BEYOND) != 0 {
            return Ok(self.no(refusal::NotAscii));
        }
        let word = if (KW_LENGTHS.at(first).wrapping_shr((end - p) as u32) & 1) != 0 {
            self.keyword_at(p, end - p)
        } else {
            0
        };
        // nothing in here opens a block, and no list in here stands on lines of its own
        self.fast.no_block += 1;
        let mut q: i32;
        match if word == 0 { tk::Name } else { word & 255 } {
            tk::Return | tk::Throw => {
                let r = self.blanks(end);
                let c = self.t.at(r);
                if c == 59 || c == 10 || c == 0 || (c == 47 && self.t.at(r + 1) == 47) {
                    q = if (word & 255) == tk::Throw {
                        self.no(refusal::Block)
                    } else {
                        end
                    };
                } else if r == end {
                    q = self.no(refusal::Block);
                } else {
                    let argument = self.spaced(end);
                    q = self.open_expression(argument)?;
                }
            }
            tk::Break | tk::Continue => {
                // (a label is for the parser)
                q = if (CC.at(self.t.at(self.blanks(end))) & ID_START) != 0
                    || !self.can_jump((word & 255) == tk::Continue, 0)
                {
                    self.no(refusal::Block)
                } else {
                    // see should_ignored_node_print_semicolon()
                    self.fast.ready_flags |= F_EXTRA;
                    end
                };
            }
            tk::Name | tk::This | tk::Super | tk::New => {
                if ((word & 255) == tk::Name && (word >> 8) != kw::Await)
                    || (self.fast.ts && self.is_declaration_word(p, end - p))
                    || (self.fast.flow && self.is_flow_declaration_word(p, end - p))
                {
                    q = self.no(refusal::Block);
                } else {
                    q = self.open_expression(p)?;
                    if q >= 0 && self.fast.shape == SH_ARROW {
                        q = self.no(refusal::Block);
                    }
                    if q >= 0 && self.t.at(q) != 59 {
                        let r = self.blanks(q);
                        let length = self.assignment_operator(r);
                        if length != 0 {
                            q = if self.fast.assignable {
                                self.initializer(q, r, length, false)?
                            } else {
                                self.no(refusal::Target)
                            };
                        }
                    }
                }
            }
            _ => {
                q = self.no(refusal::Block);
            }
        }
        self.fast.no_block -= 1;
        if q < 0 {
            return Ok(-1);
        }
        q = self.terminate(q, false);
        if q >= 0 && self.word_is(self.next_char_index(self.fast.ready_next), b"else") {
            return Ok(self.no(refusal::Block));
        }
        return Ok(q);
    }

    /// `(a) {` of `if` and `while`; p is behind the keyword. With `may_be_plain`, a simple statement can stand in the place of the block.
    pub(crate) fn condition_and_block(&mut self, p: i32, may_be_plain: bool) -> R<i32> {
        let mut q = self.spaced(p);
        if self.t.at(q) != 40 {
            return Ok(self.no(refusal::Start));
        }
        let v0 = self.tight(q + 1);
        q = self.expression(v0)?;
        if q < 0 {
            return Ok(-1);
        }
        q = self.tight(q);
        if self.t.at(q) != 41 {
            return Ok(self.no(refusal::Paren));
        }
        q = self.spaced(q + 1);
        if self.t.at(q) != 123 {
            if may_be_plain {
                return self.plain_clause(q);
            }
            return Ok(self.no(refusal::Block));
        }
        return Ok(self.open_block(q, 0));
    }

    /// `const a`, `let [a, b]` ..: what a loop declares. p is at the keyword. Returns the end, or refuses.
    pub(crate) fn loop_binding(&mut self, p: i32) -> R<i32> {
        let e = self.word_end(p);
        let kw = self.keyword_at(p, e - p);
        if (kw != tk::Const && kw != tk::Var && kw != (tk::Name | (kw::Let << 8)))
            || (self.t.at(e) != 32 && self.t.at(e) != 9)
        {
            return Ok(self.no(refusal::Start));
        }
        let q = self.spaced(e);
        let c = self.t.at(q);
        if c == 123 {
            return self.object_literal(q, true);
        }
        if c == 91 {
            return Ok(self.array_pattern(q));
        }
        if (CC.at(c) & ID_START) == 0 {
            return Ok(self.no(refusal::Binding));
        }
        let n = self.word_end(q);
        if (CC.at(self.t.at(n)) & BEYOND) != 0 {
            return Ok(self.no(refusal::NotAscii));
        }
        if !is_plain_name(self.keyword_at(q, n - q)) {
            return Ok(self.no(refusal::Binding));
        }
        return Ok(n);
    }

    /// `(const a of b) {`, `(let i = 0; i < n; i++) {`; p is behind `for`.
    pub(crate) fn for_head(&mut self, p: i32) -> R<i32> {
        let mut q = self.spaced(p);
        if self.t.at(q) != 40 {
            return Ok(self.no(refusal::Start));
        }
        let v0 = self.tight(q + 1);
        q = self.loop_binding(v0)?;
        if q < 0 {
            return Ok(-1);
        }
        let r = self.blanks(q);
        if r != q && (self.word_is(r, b"of") || self.word_is(r, b"in")) {
            self.fast.ready_kind = if self.t.at(r) == 111 {
                k::ForOfStatement
            } else {
                k::ForInStatement
            };
            self.spaced(q);
            let v1 = self.spaced(r + 2);
            q = self.expression(v1)?;
            if q < 0 {
                return Ok(-1);
            }
        } else {
            if self.t.at(r) != 61 || self.assignment_operator(r) != 1 {
                return Ok(self.no(refusal::Start));
            }
            self.fast.ready_kind = k::ForStatement;
            self.spaced(q);
            let v2 = self.spaced(r + 1);
            q = self.expression(v2)?;
            if q < 0 {
                return Ok(-1);
            }
            q = self.tight(q);
            if self.t.at(q) != 59 {
                return Ok(self.no(refusal::Start));
            }
            let v3 = self.spaced(q + 1);
            q = self.expression(v3)?;
            if q < 0 {
                return Ok(-1);
            }
            q = self.tight(q);
            if self.t.at(q) != 59 {
                return Ok(self.no(refusal::Start));
            }
            let v4 = self.spaced(q + 1);
            q = self.expression(v4)?;
            if q < 0 {
                return Ok(-1);
            }
            let a = self.blanks(q);
            let length = self.assignment_operator(a);
            if length != 0 {
                if !self.fast.assignable {
                    return Ok(self.no(refusal::Target));
                }
                self.spaced(q);
                let v5 = self.spaced(a + length);
                q = self.expression(v5)?;
                if q < 0 {
                    return Ok(-1);
                }
            }
        }
        q = self.tight(q);
        if self.t.at(q) != 41 {
            return Ok(self.no(refusal::Paren));
        }
        q = self.spaced(q + 1);
        if self.t.at(q) != 123 {
            return Ok(self.no(refusal::Block));
        }
        return Ok(self.open_block(q, 0));
    }

    /// The words that start a declaration of TypeScript, or are no start of a statement, depending on what follows.
    pub(crate) fn is_declaration_word(&self, p: i32, length: i32) -> bool {
        let e = p + length;
        match length {
            4 => {
                return self.text_is(p, e, b"type") || self.text_is(p, e, b"enum");
            }
            6 => {
                return self.text_is(p, e, b"module")
                    || self.text_is(p, e, b"global")
                    || self.text_is(p, e, b"public");
            }
            7 => {
                return self.text_is(p, e, b"declare") || self.text_is(p, e, b"private");
            }
            8 => {
                return self.text_is(p, e, b"abstract")
                    || self.text_is(p, e, b"readonly")
                    || self.text_is(p, e, b"accessor");
            }
            9 => {
                return self.text_is(p, e, b"interface")
                    || self.text_is(p, e, b"namespace")
                    || self.text_is(p, e, b"protected");
            }
            _ => {}
        }
        return false;
    }

    /// The same for Flow.
    pub(crate) fn is_flow_declaration_word(&self, p: i32, length: i32) -> bool {
        let e = p + length;
        match length {
            4 => {
                return self.text_is(p, e, b"type")
                    || self.text_is(p, e, b"enum")
                    || self.text_is(p, e, b"hook");
            }
            5 => {
                return self.text_is(p, e, b"match");
            }
            6 => {
                return self.text_is(p, e, b"opaque") || self.text_is(p, e, b"record");
            }
            7 => {
                return self.text_is(p, e, b"declare");
            }
            9 => {
                return self.text_is(p, e, b"interface") || self.text_is(p, e, b"component");
            }
            _ => {}
        }
        return false;
    }

    /// Is nothing but the end of the line, or a line comment, behind p?
    pub(crate) fn ends_line(&self, p: i32) -> bool {
        let r = self.blanks(p);
        let c = self.t.at(r);
        return c == 10
            || (c == 47 && self.t.at(r + 1) == 47)
            || (c == 0 && r >= self.text.src_end);
    }
}
// The modifiers of a member, in the order in which they are printed.
pub(crate) const MODIFIER_NONE: i32 = 0;
pub(crate) const MODIFIER_DECLARE: i32 = 1;
pub(crate) const MODIFIER_ACCESSIBILITY: i32 = 2;
pub(crate) const MODIFIER_STATIC: i32 = 3;
pub(crate) const MODIFIER_ABSTRACT: i32 = 4;
pub(crate) const MODIFIER_OVERRIDE: i32 = 5;
pub(crate) const MODIFIER_READONLY: i32 = 6;
pub(crate) const MODIFIER_ASYNC: i32 = 7;
/// get, set
pub(crate) const MODIFIER_ACCESSOR: i32 = 8;
pub(crate) const MODIFIER_REFUSED: i32 = 9;
impl Quick {
    pub(crate) fn modifier_at(&self, p: i32, length: i32) -> i32 {
        let e = p + length;
        match length {
            2 => {
                return if self.text_is(p, e, b"in") {
                    MODIFIER_REFUSED
                } else {
                    MODIFIER_NONE
                };
            }
            3 => {
                return if self.text_is(p, e, b"get") || self.text_is(p, e, b"set") {
                    MODIFIER_ACCESSOR
                } else {
                    // (`new ()` in an interface)
                    if self.text_is(p, e, b"out") || self.text_is(p, e, b"new") {
                        MODIFIER_REFUSED
                    } else {
                        MODIFIER_NONE
                    }
                };
            }
            5 => {
                return if self.text_is(p, e, b"async") {
                    MODIFIER_ASYNC
                } else {
                    if self.text_is(p, e, b"const") {
                        MODIFIER_REFUSED
                    } else {
                        MODIFIER_NONE
                    }
                };
            }
            6 => {
                return if self.text_is(p, e, b"public") {
                    MODIFIER_ACCESSIBILITY
                } else {
                    if self.text_is(p, e, b"static") {
                        MODIFIER_STATIC
                    } else {
                        if self.text_is(p, e, b"export") {
                            MODIFIER_REFUSED
                        } else {
                            MODIFIER_NONE
                        }
                    }
                };
            }
            7 => {
                return if self.text_is(p, e, b"private") {
                    MODIFIER_ACCESSIBILITY
                } else {
                    if self.text_is(p, e, b"declare") {
                        MODIFIER_DECLARE
                    } else {
                        if self.text_is(p, e, b"default") {
                            MODIFIER_REFUSED
                        } else {
                            MODIFIER_NONE
                        }
                    }
                };
            }
            8 => {
                return if self.text_is(p, e, b"readonly") {
                    MODIFIER_READONLY
                } else {
                    if self.text_is(p, e, b"override") {
                        MODIFIER_OVERRIDE
                    } else {
                        if self.text_is(p, e, b"abstract") {
                            MODIFIER_ABSTRACT
                        } else {
                            if self.text_is(p, e, b"accessor") {
                                MODIFIER_REFUSED
                            } else {
                                MODIFIER_NONE
                            }
                        }
                    }
                };
            }
            9 => {
                return if self.text_is(p, e, b"protected") {
                    MODIFIER_ACCESSIBILITY
                } else {
                    MODIFIER_NONE
                };
            }
            _ => {}
        }
        return MODIFIER_NONE;
    }

    /// `@a.b(c) ` before a member, on the same line; p is at the `@`. Returns where the member goes on.
    pub(crate) fn decorators(&mut self, p: i32) -> R<i32> {
        let mut q = p;
        while self.t.at(q) == 64 {
            q += 1;
            loop {
                if (CC.at(self.t.at(q)) & ID_START) == 0 {
                    return Ok(self.no(refusal::Start));
                }
                let e = self.word_end(q);
                if (CC.at(self.t.at(e)) & BEYOND) != 0 {
                    return Ok(self.no(refusal::NotAscii));
                }
                if self.t.at(q - 1) == 64 && !is_plain_name(self.keyword_at(q, e - q)) {
                    return Ok(self.no(refusal::Start));
                }
                q = e;
                if self.t.at(q) != 46 {
                    break;
                }
                q += 1;
            }
            if self.t.at(q) == 40 {
                self.fast.no_block += 1;
                self.fast.no_templates += 1;
                q = self.call_arguments(q + 1)?;
                self.fast.no_templates -= 1;
                self.fast.no_block -= 1;
                if q < 0 {
                    return Ok(-1);
                }
            }
            // a line break here stays
            if self.t.at(q) != 32 && self.t.at(q) != 9 {
                return Ok(self.no(refusal::Start));
            }
            q = self.spaced(q);
        }
        return Ok(q);
    }
}
pub(crate) const MEMBER_OF_CLASS: i32 = 0;
pub(crate) const MEMBER_OF_INTERFACE: i32 = 1;
impl Quick {
    /// A member of a class or an interface; p is at its start.
    pub(crate) fn member(&mut self, p: i32, where_: i32) -> R<i32> {
        let mut q = p;
        let has_decorators = self.t.at(q) == 64;
        if has_decorators {
            if where_ != MEMBER_OF_CLASS {
                return Ok(self.no(refusal::Start));
            }
            q = self.decorators(q)?;
            if q < 0 {
                return Ok(-1);
            }
        }
        let mut rank: i32 = 0;
        let mut is_async = false;
        let mut is_abstract = false;
        let mut is_accessor = false;
        let mut is_property_only = false;
        let mut is_static = false;
        let mut e: i32;
        loop {
            let mut name_start = q;
            if self.t.at(q) == 35 {
                name_start = q + 1;
            }
            if (CC.at(self.t.at(name_start)) & ID_START) == 0 && !self.is_latin_letter(name_start) {
                return Ok(self.no(refusal::Start));
            }
            e = self.latin_word_end(name_start);
            if (CC.at(self.t.at(e)) & BEYOND) != 0 {
                return Ok(self.no(refusal::NotAscii));
            }
            if e > self.fast.limit {
                return Ok(self.no(refusal::Long));
            }
            if name_start != q {
                break;
            }
            let modifier = self.modifier_at(q, e - q);
            if modifier == MODIFIER_NONE {
                break;
            }
            // One of these words as a name, out of order or twice is left to the parser.
            if modifier <= rank
                || modifier == MODIFIER_REFUSED
                || (self.t.at(e) != 32 && self.t.at(e) != 9)
                || (is_async && modifier == MODIFIER_ACCESSOR)
            {
                return Ok(self.no(refusal::Start));
            }
            let r = self.blanks(e);
            if (CC.at(self.t.at(r)) & ID_START) == 0
                && self.t.at(r) != 35
                && !self.is_latin_letter(r)
            {
                return Ok(self.no(refusal::Start));
            }
            if !self.fast.ts && modifier != MODIFIER_STATIC && modifier < MODIFIER_ASYNC {
                return Ok(self.no(refusal::Start));
            }
            if where_ != MEMBER_OF_CLASS && modifier != MODIFIER_READONLY {
                return Ok(self.no(refusal::Start));
            }
            rank = modifier;
            if modifier == MODIFIER_DECLARE || modifier == MODIFIER_READONLY {
                is_property_only = true;
            }
            if modifier == MODIFIER_ASYNC {
                is_async = true;
            } else if modifier == MODIFIER_STATIC {
                is_static = true;
            } else if modifier == MODIFIER_ABSTRACT {
                is_abstract = true;
            } else if modifier == MODIFIER_ACCESSOR {
                is_accessor = true;
            }
            q = self.spaced(e);
        }
        // `new ()` is printed with a blank
        if e - q == 3 && where_ != MEMBER_OF_CLASS && self.text_is(q, e, b"new") {
            return Ok(self.no(refusal::Start));
        }
        // A constructor has parameters, and nothing but its accessibility before it.
        if e - q == 11
            && self.text_is(q, e, b"constructor")
            && where_ == MEMBER_OF_CLASS
            && (self.t.at(e) != 40 || rank > MODIFIER_ACCESSIBILITY || has_decorators)
        {
            return Ok(self.no(refusal::Start));
        }
        // `constructor`, `prototype`, a private name: there are rules about those
        let mut is_constructor = false;
        if where_ == MEMBER_OF_CLASS
            && (e - q == 11 || e - q == 9 || e - q == 6 || self.t.at(q) == 35)
        {
            if self.t.at(q) == 35 {
                if !self.fast.ts {
                    return Ok(self.no(refusal::Start));
                }
            } else if self.text_is(q, e, b"export") {
                // a modifier for some
                return Ok(self.no(refusal::Start));
            } else if self.text_is(q, e, b"prototype") {
                if is_static && !self.fast.ts {
                    return Ok(self.no(refusal::Start));
                }
            } else if self.text_is(q, e, b"constructor") {
                if self.t.at(e) != 40
                    || ((is_async || is_accessor || self.t.at(p) == 64) && !is_static)
                {
                    return Ok(self.no(refusal::Start));
                }
                is_constructor = !is_static;
            }
        }
        // a getter has no parameter, and a setter has one
        if is_accessor && !self.fast.ts {
            let first = self.blanks(e + 1);
            let last = self.blanks(self.word_end(first));
            if self.t.at(e) != 40
                || self.t.at(last) != 41
                || (first == last) != (self.t.at(self.blanks_back(q) - 3) == 103)
            {
                return Ok(self.no(refusal::Start));
            }
        }
        let name = q;
        q = e;
        if self.t.at(q) == 63 && self.fast.ts {
            if is_accessor {
                return Ok(self.no(refusal::Start));
            }
            q += 1;
        }
        if self.t.at(q) == 40 {
            // a method; `declare` and `readonly` are not printed before one
            if is_property_only {
                return Ok(self.no(refusal::Start));
            }
            self.fast.parameters_may_break =
                where_ == MEMBER_OF_CLASS && self.fast.line_breaks == 0;
            q = self.parameters(q)?;
            if q < 0 {
                return Ok(-1);
            }
            q = self.return_type(q)?;
            if q < 0 {
                return Ok(-1);
            }
            let r = self.blanks(q);
            if self.t.at(r) == 123 && where_ == MEMBER_OF_CLASS {
                if is_abstract {
                    return Ok(self.no(refusal::Start));
                }
                if self.fast.parameters_need >= 0 && !self.head_is_too_wide(q, 2) {
                    return Ok(self.no(refusal::Paren));
                }
                self.fast.ready_kind = k::ClassMethod;
                self.fast.tail = TAIL_NONE;
                if is_constructor && !self.fast.ts && self.is_second_constructor(name) {
                    return Ok(self.no(refusal::Start));
                }
                self.spaced(q);
                let s = self.blanks(r + 1);
                if self.t.at(s) != 125 {
                    return Ok(self.open_block(
                        r,
                        if is_async {
                            BLOCK_FUNCTION | BLOCK_ASYNC
                        } else if is_constructor {
                            BLOCK_FUNCTION | BLOCK_CONSTRUCTOR
                        } else {
                            BLOCK_FUNCTION
                        },
                    ));
                }
                // `{}`
                self.tight(r + 1);
                if !self.ends_line(s + 1) {
                    return Ok(self.no(refusal::End));
                }
                self.fast.ready_end = s + 1;
                self.fast.ready_next = s + 1;
                return Ok(s + 1);
            }
            // a signature: an overload, an abstract method, a method of an interface
            if !self.fast.ts || is_async || has_decorators {
                return Ok(self.no(refusal::Start));
            }
            self.fast.ready_kind = if where_ == MEMBER_OF_CLASS {
                k::ClassMethod
            } else {
                k::MethodSignature
            };
            return Ok(if where_ == MEMBER_OF_CLASS {
                self.terminate(q, true)
            } else {
                self.terminate_type_member(q)
            });
        }
        if is_async || is_accessor {
            return Ok(self.no(refusal::Start));
        }
        let is_definite = self.t.at(q) == 33
            && self.t.at(q + 1) == 58
            && self.fast.ts
            && where_ == MEMBER_OF_CLASS
            && self.t.at(q - 1) != 63;
        if is_definite {
            q += 1;
        }
        // (whether an abstract property can have decorators depends on the class)
        if is_abstract && (is_definite || has_decorators) {
            return Ok(self.no(refusal::Start));
        }
        if self.t.at(q) == 58 {
            if !self.fast.has_types {
                return Ok(self.no(refusal::Start));
            }
            let v0 = self.spaced(q + 1);
            q = self.type_(v0)?;
            if q < 0 {
                return Ok(-1);
            }
        }
        if where_ != MEMBER_OF_CLASS {
            self.fast.ready_kind = k::PropertySignature;
            return Ok(self.terminate_type_member(q));
        }
        self.fast.ready_kind = k::ClassProperty;
        let r = self.blanks(q);
        if self.t.at(r) == 61 && self.assignment_operator(r) == 1 {
            // there is none behind `abstract` or `!`
            if is_abstract || is_definite {
                return Ok(self.no(refusal::Start));
            }
            self.fast.tail = TAIL_MEMBER;
            self.fast.await_is_operator = false;
            q = self.initializer(q, r, 1, false)?;
            if q < 0 || self.fast.opened != 0 {
                return Ok(q);
            }
            // there are no `arguments` here
            if !self.fast.ts && bun_core::strings::contains(self.t.sub(r, q), b"arguments") {
                return Ok(self.no(refusal::Start));
            }
        }
        return Ok(self.terminate(q, true));
    }

    /// The end of a member of an interface: `;`, `,` or nothing, printed as `;`.
    pub(crate) fn terminate_type_member(&mut self, p: i32) -> i32 {
        let s = self.blanks(p);
        let c = self.t.at(s);
        if c == 59 || c == 44 {
            if !self.ends_line(s + 1) {
                return self.no(refusal::End);
            }
            if c == 44 || s != p {
                self.flush(p);
                self.put(59);
                self.fast.run = s + 1;
            }
            self.fast.ready_end = s + 1;
            self.fast.ready_next = s + 1;
            return s + 1;
        }
        if !self.ends_line(p) {
            return self.no(refusal::End);
        }
        // Whatever comes on the next line starts a member, unless it goes on with the type.
        let n = self.next_char_index(s);
        let d = self.t.at(n);
        if (CC.at(d) & ID_START) == 0 && d != 125 && d != 34 && d != 39 {
            return self.no(refusal::NoSemicolon);
        }
        if d == 105 && self.t.at(n + 1) == 115 {
            // is
            return self.no(refusal::NoSemicolon);
        }
        if d == 101 && self.t.at(n + 1) == 120 {
            // extends
            return self.no(refusal::NoSemicolon);
        }
        self.flush(p);
        self.put(59);
        self.fast.ready_end = p;
        self.fast.ready_next = p;
        return p;
    }

    /// `a: b` or `a` in an object, alone on its line; p is at its start. The comma is not part of it.
    pub(crate) fn property(&mut self, p: i32, pattern_only: bool, may_open: bool) -> R<i32> {
        let c = self.t.at(p);
        let mut q: i32;
        let mut is_name = true;
        if (CC.at(c) & ID_START) != 0 {
            q = self.word_end(p);
            if (CC.at(self.t.at(q)) & BEYOND) != 0 {
                return Ok(self.no(refusal::NotAscii));
            }
        } else if (c == 34 || c == 39) && !pattern_only {
            // A string stays one if it is no name and does not look like a number. A name loses its quotes, unless they are to be preserved.
            is_name = false;
            let first = self.t.at(p + 1);
            let e = self.word_end(p + 1);
            if (CC.at(first) & DIGIT) != 0 || first == 45 || first == 46 || first == 43 {
                return Ok(self.no(refusal::Key));
            }
            if self.t.at(e) == c && e != p + 1 {
                if self.options.quote_props != QUOTE_PROPS_AS_NEEDED {
                    return Ok(self.no(refusal::Key));
                }
                self.flush(p);
                self.fast.run = p + 1;
                self.flush(e);
                self.fast.run = e + 1;
                q = e + 1;
            } else {
                q = self.string(p);
                if q < 0 {
                    return Ok(-1);
                }
            }
        } else {
            return Ok(self.no(refusal::Key));
        }
        if q > self.fast.limit {
            return Ok(self.no(refusal::Long));
        }
        let r = self.blanks(q);
        if self.t.at(r) == 58 {
            // there can be one `__proto__: a`: the parser counts
            if self.t.at(p + 1) == 95 && bun_core::strings::contains(self.t.sub(p, q), b"__proto__")
            {
                return Ok(self.no(refusal::Key));
            }
            // in @Component({ .. }) these are HTML and CSS
            if (q - p == 8 && self.text_is(p, q, b"template"))
                || (q - p == 6 && self.text_is(p, q, b"styles"))
            {
                self.fast.no_templates = 1;
            }
            self.tight(q);
            let value = self.spaced(r + 1);
            if may_open {
                // for stands.rs, which reads the block and what is behind it
                self.fast.tail = TAIL_STATEMENT;
                q = self.open_expression(value)?;
                if self.fast.opened != 0 {
                    return Ok(q);
                }
            } else {
                q = self.expression(value)?;
            }
            if q < 0 {
                q = self.or_jsx(value)?;
                if q < 0 {
                    return Ok(-1);
                }
            }
            if pattern_only && self.fast.shape != SH_NAME {
                return Ok(self.no(refusal::Pattern));
            }
            self.fast.ready_flags = if self.fast.shape == SH_NAME && is_name {
                F_EXTRA
            } else {
                0
            };
            self.fast.ready_level = self.fast.level;
        } else {
            if !is_name || !is_plain_name(self.keyword_at(p, q - p)) {
                return Ok(self.no(refusal::Key));
            }
            self.fast.ready_flags = F_SHORTHAND | F_EXTRA;
            self.fast.ready_level = 1;
        }
        // `,` and the end of the line, or the end of the line and `}`
        let s = self.blanks(q);
        if self.t.at(s) == 44 {
            if !self.ends_line(s + 1) {
                return Ok(self.no(refusal::End));
            }
            if self.t.at(s + 1) == 10 {
                self.look_behind_line(s + 1);
            }
            self.fast.ready_next = s;
        } else {
            if !self.ends_line(q) || self.t.at(self.next_char_index(s)) != 125 {
                return Ok(self.no(refusal::End));
            }
            self.fast.ready_next = q;
        }
        self.fast.ready_kind = k::ObjectProperty;
        self.fast.ready_end = q;
        return Ok(q);
    }

    /// `a: A`, `a?: A`, `+a: A` in an object type of Flow, alone on its line; p is at its start. The `,` or `;` is not part of it.
    pub(crate) fn type_property(&mut self, p: i32) -> R<i32> {
        let mut q = p;
        if self.t.at(q) == 43 || self.t.at(q) == 45 {
            q += 1;
        }
        if (CC.at(self.t.at(q)) & ID_START) == 0 {
            return Ok(self.no(refusal::Key));
        }
        q = self.word_end(q);
        if (CC.at(self.t.at(q)) & BEYOND) != 0 {
            return Ok(self.no(refusal::NotAscii));
        }
        if q > self.fast.limit {
            return Ok(self.no(refusal::Long));
        }
        if self.t.at(q) == 63 {
            q += 1;
        }
        if self.t.at(q) != 58 {
            return Ok(self.no(refusal::Key));
        }
        self.fast.saw_function_type = false;
        let v0 = self.spaced(q + 1);
        q = self.type_(v0)?;
        if q < 0 {
            return Ok(-1);
        }
        if self.fast.saw_function_type {
            self.fast.ready_flags |= F_EXTRA;
        }
        let s = self.blanks(q);
        if self.t.at(s) == 44 || self.t.at(s) == 59 {
            if !self.ends_line(s + 1) {
                return Ok(self.no(refusal::End));
            }
            if self.t.at(s + 1) == 10 {
                self.look_behind_line(s + 1);
            }
            self.fast.ready_next = s;
        } else {
            if !self.ends_line(q) {
                return Ok(self.no(refusal::End));
            }
            let n = self.next_char_index(s);
            if self.t.at(n) != 125 && (self.t.at(n) != 124 || self.t.at(n + 1) != 125) {
                return Ok(self.no(refusal::End));
            }
            self.fast.ready_next = q;
        }
        self.fast.ready_kind = k::ObjectTypeProperty;
        self.fast.ready_end = q;
        return Ok(q);
    }

    /// read_statement() for a member of an object type of Flow.
    pub(crate) fn read_type_property(&mut self, start: i32, least: i32) -> R<bool> {
        self.fast.least_column = least;
        if !self.begin(start, 2, false) {
            return Ok(false);
        }
        self.fast.await_in_list = false;
        // the comma
        self.fast.room -= 1;
        let v0 = self.type_property(start)?;
        return Ok(self.fast_finish(start, v0));
    }

    /// The next one; p is behind the separator.
    pub(crate) fn read_next_type_property(&mut self, p: i32) -> R<bool> {
        let q = self.next_item(p, ID_START);
        if q == 0 {
            return Ok(false);
        }
        self.fast.room -= 1;
        let v0 = self.type_property(q)?;
        return Ok(self.fast_finish(q, v0));
    }

    /// read_statement() for the property of an object that starts at `start`. With `pattern_only`, the object is a pattern.
    pub(crate) fn read_property(
        &mut self,
        start: i32,
        typed: i32,
        await_operator: bool,
        pattern_only: bool,
        least: i32,
        may_open: bool,
    ) -> R<bool> {
        self.fast.least_column = least;
        if !self.begin(start, typed, await_operator) {
            return Ok(false);
        }
        self.fast.await_in_list = await_operator;
        // the comma
        self.fast.room -= 1;
        let v0 = self.property(start, pattern_only, may_open)?;
        return Ok(self.fast_finish(start, v0));
    }
}
/// Which tokens can start a member that is read here.
pub(crate) static STARTS_READY_MEMBER: [u8; 105] = [
    0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
];
impl Quick {
    /// read_statement() for the member of a class or an interface that starts at `start`.
    pub(crate) fn read_member(
        &mut self,
        start: i32,
        where_: i32,
        typed: i32,
        least: i32,
    ) -> R<bool> {
        self.fast.least_column = least;
        if !self.begin(start, typed, false) {
            return Ok(false);
        }
        self.fast.await_in_list = false;
        self.fast.in_class = where_ == MEMBER_OF_CLASS;
        let p = self.member(start, where_)?;
        self.fast.in_class = false;
        return Ok(self.fast_finish(start, p));
    }
}
/// Which tokens can start a statement that is read here.
pub(crate) static STARTS_READY: [u8; 105] = [
    0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1, 1, 0, 1,
    1, 0, 1, 1, 0, 1, 1, 1, 0,
];
impl Quick {
    /// Reads the statement whose first token (`token`, `kw`) is T[start, end), if it is one of the simple ones. Then the variables at the top
    /// say what it is. It may replace T.
    pub(crate) fn read_statement(
        &mut self,
        start: i32,
        typed: i32,
        await_operator: bool,
        least: i32,
    ) -> R<bool> {
        self.fast.least_column = least;
        if !self.begin(start, typed, await_operator) {
            return Ok(false);
        }
        self.fast.await_in_list = await_operator;
        return self.statement(start);
    }

    /// A new text is about to be read.
    pub(crate) fn forget_source_unit(&mut self) {
        self.fast.source_unit = 0;
    }

    /// Behind a statement that has been read, at p: reads the next one, if nothing but blanks and ends of lines stands between the two. So a run
    /// of simple statements needs no lexer. If this returns false and ready_start is not 0, a statement starts there that cannot be read.
    pub(crate) fn read_next_statement(&mut self, p: i32) -> R<bool> {
        let q = self.next_item(p, ID_START);
        return Ok(q != 0 && self.statement(q)?);
    }

    /// read_next_statement() for the first statement of a list, behind the `{`, and for the one behind a statement with blocks, in which other lists have been read.
    pub(crate) fn read_next_statement_of(
        &mut self,
        p: i32,
        typed: i32,
        await_operator: bool,
        least: i32,
    ) -> R<bool> {
        self.fast.least_column = least;
        self.set_typed(typed);
        self.fast.await_in_list = await_operator;
        let q = self.next_item(p, ID_START);
        return Ok(q != 0 && self.statement(q)?);
    }

    /// The same for a member.
    pub(crate) fn read_next_member_of(
        &mut self,
        p: i32,
        where_: i32,
        typed: i32,
        least: i32,
    ) -> R<bool> {
        self.fast.least_column = least;
        self.set_typed(typed);
        self.fast.await_in_list = false;
        return self.read_next_member(p, where_);
    }

    /// What follows the `}` of a block that ends at p, as far as read_after_block() wants to know: Tk.Else, Tk.Catch, Tk.Finally, 0 for anything else, -1 if that takes
    /// a lexer (a comment is in the way).
    pub(crate) fn word_behind_block(&self, p: i32) -> i32 {
        let mut q = p;
        q = self.blank_lines_end(q);
        let c = self.t.at(q);
        if c == 101 {
            return if self.word_is(q, b"else") {
                tk::Else
            } else {
                0
            };
        }
        if c == 99 {
            return if self.word_is(q, b"catch") {
                tk::Catch
            } else {
                0
            };
        }
        if c == 102 {
            return if self.word_is(q, b"finally") {
                tk::Finally
            } else {
                0
            };
        }
        return if c == 47 || c == 9 || c == 13 || c >= 128 {
            -1
        } else {
            0
        };
    }
}
impl Quick {
    /// Does the line of a comment that ends at `q` end in something that is trimmed? Control characters count as such.
    #[inline(always)]
    pub(crate) fn ends_in_space(&self, q: i32) -> bool {
        let c = self.t.at(q - 1);
        c <= 32 || (c >= 127 && self.ends_in_space_beyond_ascii(q))
    }

    #[cold]
    fn ends_in_space_beyond_ascii(&self, q: i32) -> bool {
        self.t.at(q - 1) == 127
            || self.unicode_space(q - 2) == 2
            || (self.unicode_space(q - 3) & 15) == 3
    }

    /// Behind p, the end of a line, in a list of statements (or of members) that is indented by `column`: the comments up to the next item, if each of them stands alone on its lines, as it
    /// is printed. Prettier gives such comments to the item that follows, and prints them in front of it with the empty lines of the source: see claim_comments() of the parser, which
    /// does the same with what the lexer has found. Returns where the last one ends, which is the end of a line, and sets comments_start, comments_last_length, ready_end and ready_flags; or 0.
    pub(crate) fn read_comments(&mut self, p: i32, column: i32, members: bool) -> i32 {
        let limit = self.text.src_end;
        // (in front of the first line there is no end of a line)
        if (self.t.at(p) != 10 && p != self.text.src_start - 1) || column >= 4096 {
            return 0;
        }
        let mut first: i32 = 0;
        let mut end = p;
        let mut last_line: i32 = 0;
        let mut q = p;
        let mut lines: i32;
        loop {
            lines = 0;
            let mut line: i32;
            loop {
                q += 1;
                line = q;
                lines += 1;
                q = self.blanks_end(q);
                if !(self.t.at(q) == 10) {
                    break;
                }
            }
            if self.t.at(q) != 47 {
                break;
            }
            // the indentation; between two comments no more than one empty line, with nothing in it
            if q - line != column || (first != 0 && (lines > 2 || q - end != lines + column)) {
                return 0;
            }
            let start = q;
            let mut v = q + 2;
            if self.t.at(q + 1) == 47 {
                q = v;
                loop {
                    // up to the end of a line, a 0, or the first byte of U+2028
                    loop {
                        let v = self.t.u128_at(q);
                        let stops = where_byte_is(v, 10)
                            | where_byte_is(v, 13)
                            | where_byte_is(v, 0)
                            | where_byte_is(v, 0xe2);
                        if stops != 0 {
                            q += bytes_before(stops);
                            break;
                        }
                        q += 16;
                    }
                    if self.t.at(q) == 10 {
                        break;
                    }
                    // U+2028 and U+2029 end the comment
                    if self.t.at(q) != 0xe2
                        || (self.t.at(q + 1) == 0x80
                            && (self.t.at(q + 2) == 0xa8 || self.t.at(q + 2) == 0xa9))
                    {
                        return 0;
                    }
                    q += 1;
                }
                if self.ends_in_space(q) {
                    return 0;
                }
                last_line = start;
            } else if self.t.at(q + 1) == 42 {
                // `/*:: ..` and `/*: ..` can be code
                if self.t.at(v) == 58 {
                    return 0;
                }
                if self.t.at(v) == 42 {
                    v += 1;
                }
                q += 2;
                last_line = start;
                loop {
                    // up to a `*`, the end of a line, or a 0
                    loop {
                        let v = self.t.u128_at(q);
                        let stops = where_byte_is(v, b'*')
                            | where_byte_is(v, 10)
                            | where_byte_is(v, 13)
                            | where_byte_is(v, 0);
                        if stops != 0 {
                            q += bytes_before(stops);
                            break;
                        }
                        q += 16;
                    }
                    let c = self.t.at(q);
                    if c == 42 && self.t.at(q + 1) == 47 {
                        break;
                    }
                    if c == 10 {
                        // Each line starts with a `*`, under the one of the first line. (Other comments are printed as they are, wherever they come to stand.)
                        if self.ends_in_space(q) {
                            return 0;
                        }
                        last_line = q + 1 + column;
                        q += 1;
                        q = self.blanks_end(q);
                        if q - last_line != 1 || self.t.at(q) != 42 {
                            return 0;
                        }
                        continue;
                    }
                    if c == 13 || (c == 0 && q >= limit) {
                        return 0;
                    }
                    q += 1;
                }
                q += 2;
                if self.t.at(q) != 10 {
                    return 0;
                }
            } else {
                return 0;
            }
            while self.t.at(v) == 32 || self.t.at(v) == 9 || self.t.at(v) == 10 {
                v += 1;
            }
            if self.t.at(v) == 112 && self.text_is(v, v + 15, b"prettier-ignore") {
                return 0;
            }
            // (white space of any kind may stand before those words)
            if self.t.at(v) >= 128 && self.unicode_space(v) != 0 {
                return 0;
            }
            if first == 0 {
                first = start;
            }
            end = q;
        }
        if first == 0
            || (CC.at(self.t.at(q))
                & (if members {
                    ID_START | MEMBER_START
                } else {
                    ID_START
                }))
                == 0
        {
            return 0;
        }
        self.fast.comments_start = first;
        self.fast.comments_last_length = end - last_line;
        self.fast.ready_end = end;
        self.fast.ready_flags = if lines > 1 {
            F_NEXT_LINE_KNOWN | F_NEXT_LINE_EMPTY
        } else {
            F_NEXT_LINE_KNOWN
        };
        return end;
    }

    /// The same for the members of a class or an interface.
    pub(crate) fn read_next_member(&mut self, p: i32, where_: i32) -> R<bool> {
        let q = self.next_item(p, ID_START | MEMBER_START);
        if q == 0 {
            return Ok(false);
        }
        self.fast.in_class = where_ == MEMBER_OF_CLASS;
        let e = self.member(q, where_)?;
        self.fast.in_class = false;
        return Ok(self.fast_finish(q, e));
    }

    /// The same for the properties of an object; p is behind the comma.
    pub(crate) fn read_next_property(&mut self, p: i32, pattern_only: bool) -> R<bool> {
        let q = self.next_item(p, ID_START | QUOTE);
        if q == 0 {
            return Ok(false);
        }
        self.fast.room -= 1;
        let v0 = self.property(q, pattern_only, false)?;
        return Ok(self.fast_finish(q, v0));
    }

    /// Where the next item of a list starts, if the line ends at p, nothing but blanks and ends of lines comes before the item, and it starts with
    /// a character of one of the classes `starts`; and gets ready to read it. Else 0: a comment, a `}`, a tab .. are for the lexer.
    pub(crate) fn next_item(&mut self, p: i32, starts: i32) -> i32 {
        self.fast.ready_start = 0;
        if self.t.at(p) != 10 {
            return 0;
        }
        let mut q = p;
        let mut line: i32;
        loop {
            q += 1;
            line = q;
            q = self.blanks_end(q);
            if !(self.t.at(q) == 10) {
                break;
            }
        }
        if (CC.at(self.t.at(q)) & starts) == 0 {
            return 0;
        }
        self.fast.ready_start = q;
        self.reserve_gen(2048);
        self.fast.why = 0;
        self.fast.source_indent = q - line;
        if !self.prepare(q, q - line) {
            return 0;
        }
        self.fast.await_is_operator = self.fast.await_in_list;
        return q;
    }

    /// The statement that starts at `start`, with a letter.
    pub(crate) fn statement(&mut self, start: i32) -> R<bool> {
        let first = self.t.at(start);
        let mut end = start + 1;
        end = self.name_end(end);
        let word = if (KW_LENGTHS.at(first).wrapping_shr((end - start) as u32) & 1) != 0 {
            self.keyword_at(start, end - start)
        } else {
            0
        };
        self.fast.scanned_at = start;
        self.fast.scanned_end = end;
        self.fast.scanned_keyword = word;
        if word == 0 && self.t.at(end) != 32 && !self.fast.flow {
            let v0 = self.expression_statement(start)?;
            return Ok(self.fast_finish(start, v0));
        }
        let typescript = self.fast.ts;
        let token = if word == 0 { tk::Name } else { word & 255 };
        let kw = word >> 8;
        let mut p: i32 = -1;
        match token {
            tk::If => {
                self.fast.ready_kind = k::IfStatement;
                self.fast.tail = TAIL_IF;
                p = self.condition_and_block(end, true)?;
            }
            tk::While => {
                self.fast.ready_kind = k::WhileStatement;
                self.fast.tail = TAIL_NONE;
                p = self.condition_and_block(end, false)?;
            }
            tk::For => {
                self.fast.tail = TAIL_NONE;
                p = self.for_head(end)?;
            }
            tk::Try => {
                self.fast.ready_kind = k::TryStatement;
                self.fast.tail = TAIL_TRY;
                p = self.spaced(end);
                p = if self.t.at(p) == 123 {
                    self.open_block(p, 0)
                } else {
                    self.no(refusal::Start)
                };
            }
            tk::Function => {
                self.fast.ready_kind = k::FunctionDeclaration;
                self.fast.tail = TAIL_NONE;
                p = self.function_head(end, false, true)?;
            }
            tk::Class => {
                self.fast.ready_kind = k::ClassDeclaration;
                p = self.class_head(end, false);
            }
            tk::Name => {
                if kw == kw::Async {
                    let r = self.blanks(end);
                    if r == end || !self.word_is(r, b"function") {
                        return Ok(fast_refuse(refusal::Start, start));
                    }
                    self.spaced(end);
                    self.fast.ready_kind = k::FunctionDeclaration;
                    self.fast.tail = TAIL_NONE;
                    p = self.function_head(r + 8, true, true)?;
                } else if kw == kw::Let {
                    let c = self.t.at(self.blanks(end));
                    if (CC.at(c) & ID_START) == 0 && c != 123 && c != 91 {
                        return Ok(fast_refuse(refusal::Start, start));
                    }
                    self.fast.ready_kind = k::VariableDeclaration;
                    p = self.declaration(end, false)?;
                } else if kw != kw::None
                    && kw != kw::Await
                    && !is_plain_name(tk::Name | (kw << 8))
                    && kw != kw::Module
                {
                    return Ok(fast_refuse(refusal::Start, start));
                } else if typescript
                    && (self.t.at(end) == 32 || self.t.at(end) == 9)
                    && self.is_declaration_word(start, end - start)
                {
                    if end - start >= 8 {
                        self.fast.ready_kind = if self.t.at(start) == 105 {
                            k::InterfaceDeclaration
                        } else {
                            k::ClassDeclaration
                        };
                        let v1 = self.class_or_interface(start);
                        return Ok(self.fast_finish(start, v1));
                    }
                    if end - start != 4 || self.t.at(start) != 116 {
                        return Ok(fast_refuse(refusal::Start, start));
                    }
                    if (CC.at(self.t.at(self.blanks(end))) & ID_START) == 0 {
                        return Ok(fast_refuse(refusal::Start, start));
                    }
                    self.fast.ready_kind = k::TypeAlias;
                    p = self.type_alias(end, true)?;
                } else if self.fast.flow && self.is_flow_declaration_word(start, end - start) {
                    if end - start != 4
                        || self.t.at(start) != 116
                        || self.t.at(end) != 32
                        || (CC.at(self.t.at(self.blanks(end))) & ID_START) == 0
                    {
                        return Ok(fast_refuse(refusal::Start, start));
                    }
                    self.fast.ready_kind = k::TypeAlias;
                    p = self.type_alias(end, true)?;
                } else {
                    p = self.expression_statement(start)?;
                }
            }
            tk::This | tk::Super | tk::New => {
                p = self.expression_statement(start)?;
            }
            tk::Const => {
                self.fast.ready_kind = k::VariableDeclaration;
                p = self.declaration(end, true)?;
            }
            tk::Var => {
                self.fast.ready_kind = k::VariableDeclaration;
                p = self.declaration(end, false)?;
            }
            tk::Return | tk::Throw => {
                self.fast.ready_kind = if token == tk::Return {
                    k::ReturnStatement
                } else {
                    k::ThrowStatement
                };
                let r = self.blanks(end);
                let c = self.t.at(r);
                if c == 59 || c == 10 || c == 0 || (c == 47 && self.t.at(r + 1) == 47) {
                    if token == tk::Throw {
                        return Ok(fast_refuse(refusal::Start, start));
                    }
                    p = self.terminate(end, false);
                } else if r == end {
                    return Ok(fast_refuse(refusal::Start, start));
                } else {
                    self.fast.tail = TAIL_STATEMENT;
                    let argument = self.spaced(end);
                    self.fast.breakable_at = argument;
                    p = self.open_expression(argument)?;
                    if p < 0 {
                        p = if self.is_jsx_in_parens(argument) {
                            self.open_jsx(argument, 0)
                        } else {
                            self.or_jsx(argument)?
                        };
                    }
                    if p >= 0 && self.fast.opened == 0 {
                        p = self.terminate(p, false);
                    }
                }
            }
            tk::Break | tk::Continue => {
                self.fast.ready_kind = if token == tk::Break {
                    k::BreakStatement
                } else {
                    k::ContinueStatement
                };
                let mut q = end;
                let r = self.blanks(end);
                if (CC.at(self.t.at(r)) & ID_START) != 0 {
                    let v2 = self.spaced(end);
                    q = self.word_end(v2);
                    // (the parser knows the labels)
                    if (CC.at(self.t.at(q)) & BEYOND) != 0
                        || self.keyword_at(r, q - r) != 0
                        || !self.fast.ts
                    {
                        return Ok(fast_refuse(refusal::Start, start));
                    }
                } else if !self.can_jump(token == tk::Continue, 0) {
                    return Ok(fast_refuse(refusal::Start, start));
                }
                p = self.terminate(q, false);
            }
            tk::Import => {
                self.parse.needs_module |= self.fast.ts;
                p = self.import_declaration(end);
            }
            tk::Export => {
                self.parse.needs_module |= self.fast.ts;
                p = self.export_declaration(end)?;
            }
            _ => {}
        }
        return Ok(self.fast_finish(start, p));
    }

    /// `typed` as in the parser: 0, 1 for TypeScript, 2 for Flow.
    pub(crate) fn set_typed(&mut self, typed: i32) {
        self.fast.ts = typed == 1;
        self.fast.flow = typed == 2;
        self.fast.has_types = typed != 0;
    }

    /// Looks where the statement or member that starts at `start` stands, and gets ready to read it.
    pub(crate) fn begin(&mut self, start: i32, typed: i32, await_operator: bool) -> bool {
        self.reserve_gen(2048);
        self.set_typed(typed);
        self.fast.await_is_operator = await_operator;
        // It has to be the first thing on its line. Its indentation is the guess at where it will stand.
        let mut b = start;
        b = self.blanks_start(b);
        let mut indentation = start - b;
        self.fast.source_indent = if self.t.at(b - 1) == 9 {
            -1
        } else {
            indentation
        };
        if self.t.at(b - 1) == 9 {
            while self.t.at(b - 1) == 9 || self.t.at(b - 1) == 32 {
                indentation += if self.t.at(b - 1) == 9 {
                    self.options.tab_width
                } else {
                    1
                };
                b -= 1;
            }
        }
        self.fast.why = 0;
        if self.t.at(b - 1) != 10 && self.t.at(b - 1) != 0 {
            return fast_refuse(refusal::NotAtLineStart, start);
        }
        return self.prepare(start, indentation);
    }

    /// An item that the lists around it put at least_column is indented by so much in the source: by less per level than was known, if anything was.
    pub(crate) fn learn_source_unit(&mut self, indentation: i32) {
        if self.fast.is_one_level_down {
            if self.fast.source_unit == 0 {
                self.fast.source_unit = indentation;
            }
            return;
        }
        let levels = div(self.fast.least_column, self.options.tab_width);
        if levels == 0 {
            return;
        }
        let unit = div(indentation, levels);
        if unit != 0 && unit.wrapping_mul(levels) == indentation {
            self.fast.source_unit = unit;
        }
    }

    /// Gets ready to read what starts at `start`, behind so many columns of indentation.
    #[inline(always)]
    pub(crate) fn prepare(&mut self, start: i32, mut indentation: i32) -> bool {
        // The source may be indented by less than the output will be. By how much it is indented per level shows at the items whose level the lists say (the least
        // that is seen counts: an item can stand further in than its lists say). If that is less than the options ask for, the levels of the source count, whatever
        // made them (an element of JSX, a chain that is broken, `if` without braces).
        // (with a tab width of 2 there is little to learn after the first look)
        if (self.fast.source_unit == 0 || self.options.tab_width > 2)
            && indentation > 0
            && (self.fast.source_unit == 0
                || indentation.wrapping_mul(self.options.tab_width)
                    < self.fast.source_unit.wrapping_mul(self.fast.least_column))
        {
            self.learn_source_unit(indentation);
        }
        if self.fast.source_unit < self.options.tab_width && self.fast.source_unit != 0 {
            indentation = div(
                indentation + self.fast.source_unit - 1,
                self.fast.source_unit,
            )
            .wrapping_mul(self.options.tab_width);
        }
        if indentation < self.fast.least_column {
            indentation = self.fast.least_column;
        }
        return self.prepare_at(start, indentation);
    }

    /// The same where the column is the guess as it stands.
    pub(crate) fn prepare_at(&mut self, start: i32, indentation: i32) -> bool {
        let mut columns = self.options.print_width - indentation - self.options.guess_margin;
        // (the document has twelve bits for the column of lines that stand: see standing())
        if columns < 2 || indentation > 4095 {
            return fast_refuse(refusal::Narrow, start);
        }
        if columns > 400 {
            columns = 400;
        }
        self.fast.ready_flags = 0;
        self.fast.column = indentation;
        self.fast.room = columns;
        self.fast.limit = start + columns;
        self.fast.run = start;
        self.fast.out = 0;
        self.fast.too_long = false;
        self.fast.line_breaks = 0;
        self.fast.breaks_here = self.fast.may_break_lines
            && self.fast.source_indent == indentation
            && indentation == self.fast.least_column
            && indentation < 2048;
        self.fast.line_column = indentation;
        self.fast.line_from = 0;
        self.fast.breakable_at = 0;
        self.fast.is_value = false;
        self.fast.broken_lists = 0;
        self.fast.follow = 1;
        self.fast.has_lone_short_argument = false;
        self.fast.parameters_need = -1;
        self.fast.no_templates = 0;
        self.fast.templates = 0;
        self.fast.argument_lists = 0;
        self.fast.saw_less = 0;
        self.fast.no_block = 0;
        self.fast.opened = 0;
        self.fast.pending_parens = 0;
        self.fast.scanned_at = 0;
        return true;
    }

    /// p is where the reading ended, or -1.
    pub(crate) fn fast_finish(&mut self, start: i32, p: i32) -> bool {
        if p < 0 {
            return fast_refuse(self.fast.why, start);
        }
        self.finish_text(start, p);
        if self.fast.line_breaks == 0 {
            // the `{` counts
            if self.fast.ready_length + (if self.fast.opened != 0 { 1 } else { 0 }) > self.fast.room
                || self.fast.too_long
            {
                return fast_refuse(refusal::Wide, start);
            }
            self.fast.ready_last_length = self.fast.ready_length;
        } else {
            if self.fast.too_long || self.fast.parameters_need >= 0 {
                return fast_refuse(refusal::Wide, start);
            }
            let end = self.fast.ready_text + self.fast.ready_length;
            let mut b = end;
            while self.t.at(b - 1) != 10 {
                b -= 1;
            }
            self.fast.ready_last_length = end - b - self.fast.column;
            if self.fast.ready_last_length + (if self.fast.opened != 0 { 1 } else { 0 })
                > self.fast.room
            {
                return fast_refuse(refusal::Wide, start);
            }
        }
        #[cfg(feature = "tally")]
        crate::tally::read(start, p, self.fast.out == 0);
        self.fast.ready_stands = self.fast.out == 0
            && self.fast.source_indent == self.fast.least_column
            && self.fast.column == self.fast.least_column
            && self.fast.column < 4096;
        if self.fast.out != 0 {
            self.set_gen_pos(self.fast.out);
        }
        self.fast.ready_block = self.fast.opened;
        self.fast.ready_block_flags = self.fast.opened_flags;
        self.fast.ready_pending = self.fast.tail | (self.fast.pending_parens << 4);
        self.fast.ready_column = self.fast.column;
        return true;
    }

    /// The text is what was read from `start` to p.
    #[inline]
    pub(crate) fn finish_text(&mut self, start: i32, p: i32) {
        if self.fast.out == 0 {
            self.fast.ready_text = start;
            self.fast.ready_length = p - start;
        } else {
            self.flush(p);
            self.fast.ready_text = self.text.gen_pos;
            self.fast.ready_length = self.fast.out - self.text.gen_pos;
        }
    }
}
pub(crate) const AFTER_REFUSED: i32 = 0;
pub(crate) const AFTER_DONE: i32 = 1;
pub(crate) const AFTER_BLOCK: i32 = 2;
impl Quick {
    /// Goes on behind a block: p is behind its `}`. `pending` and `column` are what ready_pending and ready_column were when the statement
    /// was started, `next` is the token that the parser sees behind the block. Returns AFTER_DONE, with the text up to the end of the
    /// statement; or AFTER_BLOCK, with the text up to the next block; or AFTER_REFUSED. It may replace T.
    pub(crate) fn read_after_block(
        &mut self,
        p: i32,
        pending: i32,
        column: i32,
        next: i32,
        typed: i32,
        await_operator: bool,
    ) -> R<i32> {
        self.reserve_gen(2048);
        let mut columns = self.options.print_width - column - 1 - self.options.guess_margin;
        if columns > 400 {
            columns = 400;
        }
        self.fast.room = columns;
        self.fast.limit = p + columns;
        self.fast.run = p;
        self.fast.out = 0;
        self.fast.too_long = false;
        self.fast.argument_lists = 0;
        self.fast.saw_less = 0;
        self.fast.no_block = 0;
        self.fast.opened = 0;
        self.fast.pending_parens = 0;
        self.fast.no_templates = 0;
        self.fast.templates = 0;
        self.fast.breakable_at = 0;
        self.fast.broken_lists = 0;
        self.fast.line_breaks = 0;
        self.fast.has_lone_short_argument = false;
        self.fast.is_value = false;
        self.fast.parameters_need = -1;
        self.fast.why = 0;
        self.fast.ready_flags = 0;
        self.set_typed(typed);
        self.fast.await_is_operator = await_operator;
        self.fast.tail = pending & 15;
        let mut q = p;
        self.fast.ready_stands = true;
        match self.fast.tail {
            TAIL_NONE => {
                self.fast.ready_end = p;
                self.fast.ready_length = 0;
                if self.t.at(p) == 10 {
                    self.look_behind_line(p);
                }
                return Ok(AFTER_DONE);
            }
            TAIL_STATEMENT | TAIL_MEMBER => {
                let mut k = pending >> 4;
                while k > 0 {
                    q = self.tight(q);
                    if self.t.at(q) != 41 {
                        return Ok(AFTER_REFUSED);
                    }
                    q += 1;
                    k -= 1;
                }
                self.fast.in_class = self.fast.tail == TAIL_MEMBER;
                q = self.terminate(q, self.fast.in_class);
                self.fast.in_class = false;
                if q < 0 {
                    return Ok(AFTER_REFUSED);
                }
            }
            TAIL_IF => {
                if next != tk::Else {
                    self.fast.ready_end = p;
                    self.fast.ready_length = 0;
                    if self.t.at(p) == 10 {
                        self.look_behind_line(p);
                    }
                    return Ok(AFTER_DONE);
                }
                q = self.spaced(p);
                if !self.word_is(q, b"else") {
                    return Ok(AFTER_REFUSED);
                }
                q = self.spaced(q + 4);
                if self.t.at(q) == 123 {
                    self.fast.tail = TAIL_NONE;
                    q = self.open_block(q, 0);
                } else if self.word_is(q, b"if") {
                    q = self.condition_and_block(q + 2, false)?;
                } else {
                    return Ok(AFTER_REFUSED);
                }
                if q < 0 {
                    return Ok(AFTER_REFUSED);
                }
            }
            TAIL_TRY | TAIL_CATCH => {
                if next == tk::Catch && self.fast.tail == TAIL_TRY {
                    q = self.spaced(p);
                    if !self.word_is(q, b"catch") {
                        return Ok(AFTER_REFUSED);
                    }
                    q = self.spaced(q + 5);
                    if self.t.at(q) == 40 {
                        q = self.tight(q + 1);
                        if (CC.at(self.t.at(q)) & ID_START) == 0 {
                            return Ok(AFTER_REFUSED);
                        }
                        let e = self.word_end(q);
                        if (CC.at(self.t.at(e)) & BEYOND) != 0
                            || !is_plain_name(self.keyword_at(q, e - q))
                        {
                            return Ok(AFTER_REFUSED);
                        }
                        q = self.tight(e);
                        if self.t.at(q) != 41 {
                            return Ok(AFTER_REFUSED);
                        }
                        q = self.spaced(q + 1);
                    }
                    self.fast.tail = TAIL_CATCH;
                } else if next == tk::Finally {
                    q = self.spaced(p);
                    if !self.word_is(q, b"finally") {
                        return Ok(AFTER_REFUSED);
                    }
                    q = self.spaced(q + 7);
                    self.fast.tail = TAIL_NONE;
                } else if self.fast.tail == TAIL_CATCH {
                    self.fast.ready_end = p;
                    self.fast.ready_length = 0;
                    if self.t.at(p) == 10 {
                        self.look_behind_line(p);
                    }
                    return Ok(AFTER_DONE);
                } else {
                    return Ok(AFTER_REFUSED);
                }
                if self.t.at(q) != 123 || self.open_block(q, 0) < 0 {
                    return Ok(AFTER_REFUSED);
                }
            }
            _ => {}
        }
        self.finish_text(p, q);
        if self.fast.ready_length + (if self.fast.opened != 0 { 1 } else { 0 }) > self.fast.room
            || self.fast.too_long
        {
            return Ok(AFTER_REFUSED);
        }
        self.fast.ready_stands = self.fast.out == 0;
        if self.fast.out != 0 {
            self.set_gen_pos(self.fast.out);
        }
        if self.fast.opened == 0 {
            return Ok(AFTER_DONE);
        }
        self.fast.ready_block = self.fast.opened;
        self.fast.ready_block_flags = self.fast.opened_flags;
        self.fast.ready_pending = self.fast.tail;
        return Ok(AFTER_BLOCK);
    }
}
// ---------------------------------------------------------------------------------------------------------------- JSX
//
// An element that has an element among its children is broken whatever its width, and a child that no text follows is followed by a hard line.
// So in the trees of elements that real JSX is made of, most lines are laid out by themselves, like statements: an element without elements
// in it, an opening tag, an attribute of a tag that is broken, `{expression}`. Each is a group without a forced break: flat if it fits.
pub(crate) const JSX_REFUSED: i32 = 0;
/// a whole element; F_EXTRA: it has no closing tag
pub(crate) const JSX_ELEMENT: i32 = 1;
/// an opening tag whose element goes on; F_EXTRA: it has more than one attribute
pub(crate) const JSX_OPENING: i32 = 2;
impl Quick {
    /// A name as the lexer reads it in a tag: letters, digits, `-`.
    pub(crate) fn jsx_word(&mut self, p: i32) -> i32 {
        if (CC.at(self.t.at(p)) & ID_START) == 0 {
            return self.no(refusal::Jsx);
        }
        let mut q = p + 1;
        while (CC.at(self.t.at(q)) & ID_PART) != 0 || self.t.at(q) == 45 {
            q += 1;
        }
        if (CC.at(self.t.at(q)) & BEYOND) != 0 {
            return self.no(refusal::NotAscii);
        }
        return q;
    }

    /// The value of an attribute in quotes; p is at the first one. There are no escapes in it but `&quot;` and `&apos;`, which are left to the printer.
    pub(crate) fn jsx_string(&mut self, p: i32) -> i32 {
        let quote = self.t.at(p);
        let mut q = p + 1;
        let mut other = false;
        loop {
            while STRING_STOP.at(self.t.at(q)) == 0 && self.t.at(q) != 38 {
                q += 1;
            }
            if q > self.fast.limit {
                return self.no(refusal::Long);
            }
            let c = self.t.at(q);
            if c == quote {
                break;
            }
            if c == 38 {
                if self.t.at(q + 1) == 97 || self.t.at(q + 1) == 113 {
                    return self.no(refusal::String);
                }
            } else if c == 34 || c == 39 {
                other = true;
            } else {
                return self.no(refusal::String);
            }
            q += 1;
        }
        let preferred = if self.options.jsx_single_quote {
            39
        } else {
            34
        };
        if quote != preferred && !other {
            self.flush(p);
            self.put(preferred);
            self.fast.run = p + 1;
            self.flush(q);
            self.put(preferred);
            self.fast.run = q + 1;
        }
        return q + 1;
    }

    /// `{expression}`; p is at the `{`.
    pub(crate) fn jsx_container(&mut self, p: i32) -> R<i32> {
        self.stack()?;
        let inside = self.tight(p + 1);
        let arrows = self.fast.arrows_to_jsx;
        // css={`..`}, <style jsx>{`..`}</style>
        if self.t.at(inside) == 96 {
            return Ok(self.no(refusal::Template));
        }
        let mut q = self.expression(inside)?;
        if q < 0 {
            q = self.or_jsx(inside)?;
            if q < 0 {
                return Ok(-1);
            }
        }
        // `{a.map((b) => <c />)}`: the element is broken, and gets parentheses
        if self.fast.arrows_to_jsx != arrows {
            return Ok(self.no(refusal::JsxBreaks));
        }
        q = self.tight(q);
        if self.t.at(q) != 125 {
            return Ok(self.no(refusal::Jsx));
        }
        return Ok(q + 1);
    }

    /// Is `<a>` an element in the text that is about to be read?
    /// Flow: `<a>` may be the type parameters of a function, so the long way reads what stands behind it, at p, as a token, and does not
    /// get over one that is broken: `<a>'</a>`, `<a>1st</a>`. A word, a tag and a `{` are whole.
    fn is_plain_behind_type_parameters(&self, p: i32) -> bool {
        let c = self.t.at(p);
        c == 60 || c == 123 || (c < 128 && (CC.at(c) & ID_START) != 0)
    }

    pub(crate) fn set_jsx_is_on(&mut self, on: bool) {
        self.fast.jsx_is_on = on;
    }

    /// No expression could be read at p. If an element without elements in it stands there, that is read. For those who read an expression in a place where an
    /// element gets no parentheses: so nobody else pays for it.
    pub(crate) fn or_jsx(&mut self, p: i32) -> R<i32> {
        if self.t.at(p) != 60 || !self.fast.jsx_is_on {
            return Ok(-1);
        }
        self.fast.why = 0;
        let outer_count = self.fast.attribute_count;
        let outer_length = self.fast.ready_name_length;
        let mut q = self.jsx_opening(p)?;
        if q < 0 {
            return Ok(-1);
        }
        if self.fast.attribute_count > 1 && self.options.single_attribute_per_line {
            return Ok(self.no(refusal::JsxBreaks));
        }
        if self.t.at(q) == 47 {
            q += 2;
        } else {
            q += 1;
            if self.fast.attribute_count > 1 && (self.t.at(q) != 60 || self.t.at(q + 1) != 47) {
                return Ok(self.no(refusal::JsxBreaks));
            }
            // `<A>(b) => c` is a function
            if self.t.at(q) == 40
                || (self.fast.flow && {
                    let s = self.blank_lines_end(q);
                    !self.is_plain_behind_type_parameters(s)
                })
            {
                return Ok(self.no(refusal::Less));
            }
            q = self.jsx_leaf(q, p)?;
            if q < 0 {
                return Ok(-1);
            }
        }
        self.fast.attribute_count = outer_count;
        self.fast.ready_name_length = outer_length;
        self.fast.shape = SH_JSX;
        self.fast.level = NEVER;
        self.fast.assignable = false;
        return Ok(q);
    }

    /// `a`, `a="b"`, `a={b}`, `{...a}`.
    pub(crate) fn jsx_attribute(&mut self, p: i32) -> R<i32> {
        if self.t.at(p) == 123 {
            if self.t.at(p + 1) != 46 || self.t.at(p + 2) != 46 || self.t.at(p + 3) != 46 {
                return Ok(self.no(refusal::Jsx));
            }
            let q = self.expression(p + 4)?;
            if q < 0 {
                return Ok(-1);
            }
            if self.fast.shape > SH_OBJECT {
                return Ok(self.no(refusal::Spread));
            }
            if self.t.at(q) != 125 {
                return Ok(self.no(refusal::Jsx));
            }
            self.fast.attribute_flags = F_EXTRA;
            return Ok(q + 1);
        }
        let q = self.jsx_word(p);
        self.fast.attribute_flags = 0;
        if q < 0 {
            return Ok(-1);
        }
        if self.t.at(q) != 61 {
            // a name alone, unless `=` or `:` comes later, maybe behind a comment
            let mut r = q;
            while self.t.at(r) == 32 || self.t.at(r) == 9 || self.t.at(r) == 10 {
                r += 1;
            }
            return Ok(
                if self.t.at(r) == 61
                    || self.t.at(r) == 58
                    || (self.t.at(r) == 47 && self.t.at(r + 1) != 62)
                {
                    self.no(refusal::Jsx)
                } else {
                    q
                },
            );
        }
        let c = self.t.at(q + 1);
        if c == 34 || c == 39 {
            self.fast.attribute_flags = F_SHORTHAND;
            return Ok(self.jsx_string(q + 1));
        }
        if c != 123 {
            return Ok(self.no(refusal::Jsx));
        }
        let e = self.jsx_container(q + 1)?;
        // (there can be attributes in the expression)
        self.fast.attribute_flags = F_EXTRA;
        return Ok(e);
    }

    /// `<a.b c="d" e={f}>` or `<a />`; p is at the `<`. Returns where the `>` or the `/` stands.
    pub(crate) fn jsx_opening(&mut self, p: i32) -> R<i32> {
        let mut q = self.jsx_word(p + 1);
        if q < 0 {
            return Ok(-1);
        }
        if self.t.at(q) == 46 {
            while self.t.at(q) == 46 {
                q = self.jsx_word(q + 1);
                if q < 0 {
                    return Ok(-1);
                }
            }
            // `a-b.c`
            if bun_core::strings::contains_char(self.t.sub(p, q), b'-') {
                return Ok(self.no(refusal::Jsx));
            }
        }
        let length = q - p - 1;
        self.fast.ready_name_length = length;
        // <fbt> has rules of its own; what is in <style jsx> can be CSS; `<const a = ` starts type parameters
        if (length == 3 && self.text_is(p + 1, q, b"fbt"))
            || (length == 5
                && (self.text_is(p + 1, q, b"style") || self.text_is(p + 1, q, b"const")))
        {
            return Ok(self.no(refusal::Jsx));
        }
        let mut count: i32 = 0;
        loop {
            if q > self.fast.limit {
                return Ok(self.no(refusal::Long));
            }
            let r = self.blanks(q);
            let c = self.t.at(r);
            if c == 62 {
                self.tight(q);
                self.fast.attribute_count = count;
                return Ok(r);
            }
            if c == 47 {
                if self.t.at(r + 1) != 62 {
                    return Ok(self.no(refusal::Jsx));
                }
                self.spaced(q);
                self.fast.attribute_count = count;
                return Ok(r);
            }
            // `:`, `<` behind the name; the end of the line
            if r == q {
                return Ok(self.no(refusal::Jsx));
            }
            // `<A extends B>` may be the type parameters of a function
            if c == 101 && count == 0 && self.word_is(r, b"extends") {
                return Ok(self.no(refusal::Jsx));
            }
            let v0 = self.spaced(q);
            q = self.jsx_attribute(v0)?;
            if q < 0 {
                return Ok(-1);
            }
            count += 1;
        }
    }

    /// Does the line end behind the child that ends at p, in the source and in the output? A tag or `{expression}` has to come next: a word can be
    /// put on the same line, and so is `{" "}`.
    pub(crate) fn jsx_line_ends(&self, p: i32) -> bool {
        let mut r = self.blanks(p);
        if self.t.at(r) != 10 {
            return false;
        }
        while self.t.at(r) == 32 || self.t.at(r) == 9 || self.t.at(r) == 10 {
            r += 1;
        }
        if self.t.at(r) == 60 {
            return true;
        }
        if self.t.at(r) != 123 {
            return false;
        }
        r += 1;
        while self.t.at(r) == 32 || self.t.at(r) == 9 || self.t.at(r) == 10 {
            r += 1;
        }
        return self.t.at(r) != 34 && self.t.at(r) != 39;
    }

    /// What stands between the tags of an element without elements in it, and its closing tag: words and at most one `{expression}`. p is behind the `>`
    /// of the opening tag, which starts at `start`. Returns the place behind the closing tag.
    pub(crate) fn jsx_leaf(&mut self, p: i32, start: i32) -> R<i32> {
        let mut q = p;
        let mut containers: i32 = 0;
        // white space next to a tag is `{" "}` if the element breaks; with the end of a line in it, it is nothing
        if self.t.at(q) == 32 || self.t.at(q) == 9 {
            return Ok(self.no(refusal::JsxText));
        }
        loop {
            let c = self.t.at(q);
            if c == 60 {
                break;
            }
            if c == 123 {
                // two of them break the element
                if containers != 0 {
                    return Ok(self.no(refusal::JsxBreaks));
                }
                containers = 1;
                // `{" "}` is white space, and a template alone is hugged
                let d = self.t.at(q + 1);
                if d == 34 || d == 39 {
                    return Ok(self.no(refusal::JsxText));
                }
                q = self.jsx_container(q)?;
                if q < 0 {
                    return Ok(-1);
                }
                continue;
            }
            if c == 32 || c == 9 {
                let d = self.t.at(self.blanks(q));
                if d == 60 || d == 10 {
                    return Ok(self.no(refusal::JsxText));
                }
                q = self.spaced(q);
                continue;
            }
            // (a backslash: see parse_jsx_element())
            if c < 32 || c >= 127 || c == 62 || c == 125 || c == 92 {
                return Ok(self.no(refusal::JsxText));
            }
            q += 1;
            if q > self.fast.limit {
                return Ok(self.no(refusal::Long));
            }
        }
        if self.t.at(q + 1) != 47 {
            return Ok(self.no(refusal::JsxBreaks));
        }
        let length = self.fast.ready_name_length;
        q += 2;
        let mut i: i32 = 0;
        while i < length {
            if self.t.at(q + i) != self.t.at(start + 1 + i) {
                return Ok(self.no(refusal::Jsx));
            }
            i += 1;
        }
        q += length;
        if self.t.at(q) != 62 {
            return Ok(self.no(refusal::Jsx));
        }
        return Ok(q + 1);
    }

    /// Reads the tag that starts a line at `start`, with `<`. As a child of an element (`is_child`), a whole element that ends the line is taken; otherwise, and
    /// if that cannot be read, its opening tag alone. ready_end is where the lexer goes on.
    pub(crate) fn read_jsx_tag(
        &mut self,
        start: i32,
        typed: i32,
        await_operator: bool,
        least: i32,
        is_child: bool,
        least_is_exact: bool,
    ) -> R<i32> {
        // At which depth of the lists an element stands says nothing about how far one level is indented, unless the parser has counted the parentheses around
        // it (`least_is_exact`). But the outermost one in a statement that is not indented stands in parentheses.
        self.fast.least_column = if self.fast.source_unit == 0 && !least_is_exact {
            0
        } else {
            least
        };
        self.fast.ready_tag_column = -1;
        self.fast.is_one_level_down = least == 0 && !is_child;
        let is_at_line_start = self.begin(start, typed, await_operator);
        self.fast.is_one_level_down = false;
        if !is_at_line_start {
            return Ok(JSX_REFUSED);
        }
        // (with the `>` on the line of the last attribute, what follows the tag counts for the width of that one)
        if !self.options.bracket_same_line {
            self.fast.ready_tag_column = self.fast.column;
        }
        let mut p = self.jsx_opening(start)?;
        if p >= 0 && self.fast.attribute_count > 1 && self.options.single_attribute_per_line {
            p = self.no(refusal::JsxBreaks);
        }
        if p < 0 {
            fast_refuse(self.fast.why, start);
            return Ok(JSX_REFUSED);
        }
        self.fast.ready_kind = k::JSXElement;
        if self.t.at(p) == 47 {
            p += 2;
            if !is_child || !self.jsx_line_ends(p) {
                fast_refuse(refusal::End, start);
                return Ok(JSX_REFUSED);
            }
            self.fast.ready_end = p;
            self.fast.ready_flags = if self.fast.attribute_count == 0 {
                F_EXTRA | F_ANY_WIDTH
            } else {
                F_EXTRA
            };
            return Ok(if self.fast_finish(start, p) {
                JSX_ELEMENT
            } else {
                JSX_REFUSED
            });
        }
        p += 1;
        let is_empty = self.t.at(p) == 60 && self.t.at(p + 1) == 47;
        // more than one attribute breaks an element with something in it
        if is_child && (self.fast.attribute_count <= 1 || is_empty) {
            let out_here = self.fast.out;
            let run_here = self.fast.run;
            let too_long_here = self.fast.too_long;
            let e = self.jsx_leaf(p, start)?;
            if e >= 0 && !self.fast.too_long && self.jsx_line_ends(e) {
                self.fast.ready_end = e;
                if self.fast_finish(start, e) {
                    return Ok(JSX_ELEMENT);
                }
                // it may break, and its opening tag fit
            }
            self.fast.out = out_here;
            self.fast.run = run_here;
            self.fast.why = 0;
            self.fast.too_long = too_long_here;
        }
        // With nothing in the element the closing tag follows on the line, and so does a template that is all there is in it.
        let mut r = p;
        while self.t.at(r) == 32 || self.t.at(r) == 9 || self.t.at(r) == 10 {
            r += 1;
        }
        if (self.t.at(r) == 60 && self.t.at(r + 1) == 47) || self.t.at(p) == 123 {
            fast_refuse(refusal::End, start);
            return Ok(JSX_REFUSED);
        }
        self.fast.ready_kind = k::JSXOpeningElement;
        self.fast.ready_end = p;
        self.fast.ready_flags = if self.fast.attribute_count > 1 {
            F_EXTRA
        } else {
            0
        };
        return Ok(if self.fast_finish(start, p) {
            JSX_OPENING
        } else {
            JSX_REFUSED
        });
    }

    /// An attribute of a tag that stands at `tag_column`. If the tag is broken, each attribute has a line to itself, one level further in; if it is not, they all fit.
    /// The flags say what it is: see attribute_flags.
    pub(crate) fn read_jsx_attribute(
        &mut self,
        start: i32,
        typed: i32,
        await_operator: bool,
        tag_column: i32,
    ) -> R<bool> {
        self.reserve_gen(2048);
        self.set_typed(typed);
        self.fast.await_in_list = await_operator;
        self.fast.await_is_operator = await_operator;
        self.fast.why = 0;
        return Ok(
            self.prepare_at(start, tag_column + self.options.tab_width) && self.attribute(start)?
        );
    }

    /// The next one, if nothing but white space stands between p and it.
    pub(crate) fn read_next_jsx_attribute(&mut self, p: i32, tag_column: i32) -> R<bool> {
        let mut q = p;
        q = self.blank_lines_end(q);
        self.fast.ready_start = 0;
        if q == p || ((CC.at(self.t.at(q)) & ID_START) == 0 && self.t.at(q) != 123) {
            return Ok(false);
        }
        self.fast.ready_start = q;
        self.reserve_gen(2048);
        self.fast.why = 0;
        self.fast.await_is_operator = self.fast.await_in_list;
        return Ok(self.prepare_at(q, tag_column + self.options.tab_width) && self.attribute(q)?);
    }

    pub(crate) fn attribute(&mut self, start: i32) -> R<bool> {
        let mut p = self.jsx_attribute(start)?;
        if p >= 0 {
            // not `a:b`, nor what the lexer would take for more of a name; a comment on the same line counts for the width
            let c = self.t.at(p);
            let r = self.blanks(p);
            if (c != 32 && c != 10 && c != 47 && c != 62)
                || (self.t.at(r) == 47 && self.t.at(r + 1) != 62)
            {
                p = self.no(refusal::Jsx);
            }
        }
        self.fast.ready_kind = if self.t.at(start) == 123 {
            k::JSXSpreadAttribute
        } else {
            k::JSXAttribute
        };
        self.fast.ready_flags = self.fast.attribute_flags;
        self.fast.ready_end = p;
        return Ok(self.fast_finish(start, p));
    }

    /// Where the closing tag at p ends, if it is `</`, the `length` bytes at `name`, which are a plain name, and `>`; else 0.
    pub(crate) fn closing_tag_end(&self, p: i32, name: i32, length: i32) -> i32 {
        if self.t.at(p + 1) != 47 {
            return 0;
        }
        let q = p + 2;
        let mut i: i32 = 0;
        while i < length {
            let c = self.t.at(name + i);
            if self.t.at(q + i) != c || ((CC.at(c) & ID_PART) == 0 && c != 46 && c != 45) {
                return 0;
            }
            i += 1;
        }
        return if self.t.at(q + length) == 62 {
            q + length + 1
        } else {
            0
        };
    }

    /// `{expression}` alone on its line, as a child of an element.
    pub(crate) fn read_jsx_container(
        &mut self,
        start: i32,
        typed: i32,
        await_operator: bool,
        least: i32,
    ) -> R<bool> {
        self.fast.least_column = if self.fast.source_unit == 0 { 0 } else { least };
        if !self.begin(start, typed, await_operator) {
            return Ok(false);
        }
        let mut inside = start + 1;
        while self.t.at(inside) == 32 {
            inside += 1;
        }
        let d = self.t.at(inside);
        let mut p = if d == 34 || d == 39 {
            self.no(refusal::JsxText)
        } else {
            self.jsx_container(start)?
        };
        if p >= 0 && !self.jsx_line_ends(p) {
            p = self.no(refusal::End);
        }
        self.fast.ready_kind = k::JSXExpressionContainer;
        self.fast.ready_end = p;
        return Ok(self.fast_finish(start, p));
    }
}
pub(crate) fn fast_refuse(_reason: i32, _start: i32) -> bool {
    #[cfg(feature = "tally")]
    crate::tally::refused(_reason, _start);
    return false;
}
