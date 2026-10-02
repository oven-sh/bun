// printer/printer.go: the emit printer, as far as the type printer of the checker runs it. Source maps are not part of the port: `sourceMapsDisabled` is always true and the source map state has no fields.
use crate::ast::{
    Ast, Kind, ModifierListId, NodeFactory, NodeId, NodeListId, OperatorPrecedence, SymbolId,
    TokenFlags, TypePrecedence, get_expression_precedence, get_source_file_of_node,
    get_type_node_precedence, is_arrow_function, is_binding_pattern, is_decorator, is_expression,
    is_in_json_file, is_jsdoc_kind, is_keyword_kind, is_member_name, is_modifier,
    is_numeric_literal, is_optional_chain, is_parse_tree_node, is_punctuation_kind, is_source_file,
    is_statement, is_string_literal, is_type_node, is_type_parameter_declaration,
    node_is_synthesized, position_is_synthesized, skip_partially_emitted_expressions,
};
use crate::core::{ScriptTarget, TextRange, new_text_range};
use crate::nodebuilder::types::define_flags;
use crate::printer::emitcontext::EmitContext;
use crate::printer::emitflags::EmitFlags;
use crate::printer::emittextwriter::EmitTextWriter;
use crate::printer::namegenerator::NameGenerator;
use crate::printer::semicolon_writer::get_trailing_semicolon_deferring_writer;
use crate::printer::singlelinestringwriter::SingleLineStringWriter;
use crate::printer::utilities::{
    EndOf, GetLiteralTextFlags, QuoteChar, escape_jsx_attribute_string, escape_non_ascii_string,
    escape_string, get_literal_text, greatest_end, original_nodes_have_same_parent,
    positions_are_on_same_line, range_end_is_on_same_line_as_range_start,
    range_end_positions_are_on_same_line, range_is_on_single_line,
    range_start_positions_are_on_same_line, skip_synthesized_parentheses,
};
use crate::scanner::{
    get_source_text_of_node_from_source_file, get_trailing_comment_ranges, skip_trivia,
    token_to_string,
};

#[derive(Clone, Copy, Default)]
pub struct PrinterOptions {
    pub remove_comments: bool,
    pub omit_trailing_semicolon: bool,
    pub no_emit_helpers: bool,
    pub target: ScriptTarget,
    pub source_map: bool,
    pub inline_source_map: bool,
    pub inline_sources: bool,
    pub omit_brace_source_map_positions: bool,
    pub only_print_jsdoc_style: bool,
    pub never_ascii_escape: bool,
    pub preserve_source_newlines: bool,
    pub terminate_unterminated_literals: bool,
}

// The hooks of a caller: every one is nil for the checker.
#[derive(Default)]
pub struct PrintHandlers {
    // A hook used by the Printer when generating unique names to avoid collisions with globally defined names that exist outside of the current source file.
    pub has_global_name: Option<Box<dyn Fn(&[u8]) -> bool>>,
    pub on_before_emit_node: Option<Box<dyn FnMut(NodeId)>>,
    pub on_after_emit_node: Option<Box<dyn FnMut(NodeId)>>,
    pub on_before_emit_node_list: Option<Box<dyn FnMut(NodeListId)>>,
    pub on_after_emit_node_list: Option<Box<dyn FnMut(NodeListId)>>,
    pub on_before_emit_token: Option<Box<dyn FnMut(NodeId)>>,
    pub on_after_emit_token: Option<Box<dyn FnMut(NodeId)>>,
}

pub struct Printer<'p> {
    a: Ast<'p>,
    handlers: PrintHandlers,
    pub options: PrinterOptions,
    emit_context: &'p mut EmitContext,
    current_source_file: NodeId,
    external_helpers_module_name: NodeId,
    next_list_element_pos: i32,
    writer: Option<Box<dyn EmitTextWriter + 'p>>,
    // What a write without a writer lands in: upstream dereferences nil there.
    sink: SingleLineStringWriter,
    write_kind: WriteKind,
    source_maps_disabled: bool,
    container_pos: i32,
    container_end: i32,
    declaration_list_container_end: i32,
    comments_disabled: bool,
    // whether we are emitting the `extends` clause of a ConditionalTypeNode or InferTypeNode
    in_extends: bool,
    name_generator: NameGenerator,
}

// holds the state that entering a node captures for its comments
#[derive(Clone, Copy, Default)]
pub(crate) struct CommentState {
    emit_flags: EmitFlags,
    comment_range: TextRange,
    container_pos: i32,
    container_end: i32,
    declaration_list_container_end: i32,
}

// `sourceMapState` has no port: a node never has source map state.
#[derive(Clone, Copy, Default)]
pub(crate) struct PrinterState {
    comment_state: Option<CommentState>,
}

pub fn new_printer<'p>(
    a: Ast<'p>,
    options: PrinterOptions,
    handlers: PrintHandlers,
    emit_context: &'p mut EmitContext,
) -> Printer<'p> {
    // Upstream wires the name generator to the printer with callbacks: here the printer passes itself to the name generator.
    Printer {
        a,
        handlers,
        options,
        emit_context,
        current_source_file: NodeId::NIL,
        external_helpers_module_name: NodeId::NIL,
        next_list_element_pos: 0,
        writer: None,
        sink: SingleLineStringWriter::default(),
        write_kind: WriteKind::None,
        source_maps_disabled: true,
        container_pos: -1,
        container_end: -1,
        declaration_list_container_end: -1,
        comments_disabled: options.remove_comments,
        in_extends: false,
        name_generator: NameGenerator::default(),
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub enum WriteKind {
    #[default]
    None,
    Keyword,
    Operator,
    Punctuation,
    StringLiteral,
    Parameter,
    Property,
    Comment,
    Literal,
}

define_flags!(ListFormat: u32 {
    NONE = 0,
    // Prints the list on a single line (default).
    SINGLE_LINE = 0,
    // Prints the list on multiple lines.
    MULTI_LINE = 1 << 0,
    // Prints the list using line preservation if possible.
    PRESERVE_LINES = 1 << 1,
    LINES_MASK = (1 << 0) | (1 << 1),
    // There is no delimiter between list items (default).
    NOT_DELIMITED = 0,
    // Each list item is space-and-bar (" |") delimited.
    BAR_DELIMITED = 1 << 2,
    // Each list item is space-and-ampersand (" &") delimited.
    AMPERSAND_DELIMITED = 1 << 3,
    // Each list item is comma (",") delimited.
    COMMA_DELIMITED = 1 << 4,
    // Each list item is asterisk ("\n *") delimited, used with JSDoc.
    ASTERISK_DELIMITED = 1 << 5,
    DELIMITERS_MASK = (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5),
    // Write a trailing comma (",") if present.
    ALLOW_TRAILING_COMMA = 1 << 6,
    // The list should be indented.
    INDENTED = 1 << 7,
    // Inserts a space after the opening brace and before the closing brace.
    SPACE_BETWEEN_BRACES = 1 << 8,
    // Inserts a space between each sibling node.
    SPACE_BETWEEN_SIBLINGS = 1 << 9,
    // The list is surrounded by "{" and "}".
    BRACES = 1 << 10,
    // The list is surrounded by "(" and ")".
    PARENTHESIS = 1 << 11,
    // The list is surrounded by "<" and ">".
    ANGLE_BRACKETS = 1 << 12,
    // The list is surrounded by "[" and "]".
    SQUARE_BRACKETS = 1 << 13,
    BRACKETS_MASK = (1 << 10) | (1 << 11) | (1 << 12) | (1 << 13),
    // Do not emit brackets if the list is nil.
    OPTIONAL_IF_NIL = 1 << 14,
    // Do not emit brackets if the list is empty.
    OPTIONAL_IF_EMPTY = 1 << 15,
    OPTIONAL = (1 << 14) | (1 << 15),
    // Prefer adding a LineTerminator between synthesized nodes.
    PREFER_NEW_LINE = 1 << 16,
    // Do not emit a trailing NewLine for a MultiLine list.
    NO_TRAILING_NEW_LINE = 1 << 17,
    // Do not emit comments between each node
    NO_INTERVENING_COMMENTS = 1 << 18,
    // If the literal is empty, do not add spaces between braces.
    NO_SPACE_IF_EMPTY = 1 << 19,
    SINGLE_ELEMENT = 1 << 20,
    // Add space after list
    SPACE_AFTER_LIST = 1 << 21,
    MODIFIERS = (1 << 9) | (1 << 18) | (1 << 21),
    SINGLE_LINE_TYPE_LITERAL_MEMBERS = (1 << 8) | (1 << 9),
    MULTI_LINE_TYPE_LITERAL_MEMBERS = (1 << 0) | (1 << 7) | (1 << 15),
    SINGLE_LINE_TUPLE_TYPE_ELEMENTS = (1 << 4) | (1 << 9),
    MULTI_LINE_TUPLE_TYPE_ELEMENTS = (1 << 4) | (1 << 7) | (1 << 9) | (1 << 0),
    UNION_TYPE_CONSTITUENTS = (1 << 2) | (1 << 9),
    INTERSECTION_TYPE_CONSTITUENTS = (1 << 3) | (1 << 9),
    OBJECT_BINDING_PATTERN_ELEMENTS = (1 << 6) | (1 << 8) | (1 << 4) | (1 << 9) | (1 << 19),
    ARRAY_BINDING_PATTERN_ELEMENTS = (1 << 6) | (1 << 4) | (1 << 9) | (1 << 19),
    IMPORT_ATTRIBUTES = (1 << 1) | (1 << 4) | (1 << 9) | (1 << 8) | (1 << 7) | (1 << 10) | (1 << 19),
    TEMPLATE_EXPRESSION_SPANS = 1 << 18,
    TYPE_ARGUMENTS = (1 << 4) | (1 << 9) | (1 << 12) | (1 << 14) | (1 << 15),
    TYPE_PARAMETERS = (1 << 4) | (1 << 9) | (1 << 12) | (1 << 14) | (1 << 15),
    PARAMETERS = (1 << 4) | (1 << 9) | (1 << 11),
    SINGLE_ARROW_PARAMETER = (1 << 4) | (1 << 9),
    INDEX_SIGNATURE_PARAMETERS = (1 << 4) | (1 << 9) | (1 << 7) | (1 << 13),
});

define_flags!(TokenEmitFlags: u32 {
    NONE = 0,
    NO_COMMENTS = 1 << 0,
    INDENT_LEADING_COMMENTS = 1 << 1,
    NO_SOURCE_MAPS = 1 << 2,
});

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum CommentSeparator {
    None,
    Before,
    After,
}

impl<'p> Printer<'p> {
    // `p.writer`
    fn w(&mut self) -> &mut (dyn EmitTextWriter + 'p) {
        let Self { writer, sink, .. } = self;
        match writer.as_deref_mut() {
            Some(writer) => writer,
            None => sink,
        }
    }

    fn get_literal_text_of_node(
        &mut self,
        node: NodeId,
        source_file: NodeId,
        flags: GetLiteralTextFlags,
    ) -> Vec<u8> {
        let a = self.a;
        let mut flags = flags;
        if is_string_literal(a, node) {
            let text_source_node = self
                .emit_context
                .text_source
                .get(&node)
                .copied()
                .unwrap_or(NodeId::NIL);
            if !text_source_node.is_nil() {
                let text: Vec<u8> = match a.kind(text_source_node) {
                    Kind::NumericLiteral => a.text(text_source_node).to_vec(),
                    Kind::Identifier | Kind::PrivateIdentifier | Kind::JsxNamespacedName => {
                        self.get_text_of_node(text_source_node, false)
                    }
                    _ => {
                        return self.get_literal_text_of_node(
                            text_source_node,
                            get_source_file_of_node(a, text_source_node),
                            flags,
                        );
                    }
                };
                let escaped = if flags.intersects(GetLiteralTextFlags::JSX_ATTRIBUTE_ESCAPE) {
                    escape_jsx_attribute_string(&text, QuoteChar::DOUBLE_QUOTE)
                } else if flags.intersects(GetLiteralTextFlags::NEVER_ASCII_ESCAPE)
                    || self
                        .emit_context
                        .emit_flags(node)
                        .intersects(EmitFlags::NO_ASCII_ESCAPING)
                {
                    escape_string(&text, QuoteChar::DOUBLE_QUOTE)
                } else {
                    escape_non_ascii_string(&text, QuoteChar::DOUBLE_QUOTE)
                };
                return [b"\"".as_slice(), &escaped, b"\""].concat();
            }
        }

        if self
            .emit_context
            .emit_flags(node)
            .intersects(EmitFlags::NO_ASCII_ESCAPING)
        {
            flags |= GetLiteralTextFlags::NEVER_ASCII_ESCAPE;
        }
        if self.options.target >= ScriptTarget::ES2021 {
            flags |= GetLiteralTextFlags::ALLOW_NUMERIC_SEPARATOR;
        }
        let source_file = if source_file.is_nil() {
            self.current_source_file
        } else {
            source_file
        };
        get_literal_text(a, node, source_file, flags)
    }

    // `nameGenerator.GetTextOfNode` and the name generator itself call this.
    pub(crate) fn get_text_of_node(&mut self, node: NodeId, include_trivia: bool) -> Vec<u8> {
        let a = self.a;
        if is_member_name(a, node) && self.emit_context.auto_generate.contains_key(&node) {
            return self.generate_name(node);
        }

        if is_string_literal(a, node) {
            let text_source_node = self
                .emit_context
                .text_source
                .get(&node)
                .copied()
                .unwrap_or(NodeId::NIL);
            if !text_source_node.is_nil() {
                return self.get_text_of_node(text_source_node, include_trivia);
            }
        }

        let can_use_source_file = !self.current_source_file.is_nil()
            && !a.parent(node).is_nil()
            && !node_is_synthesized(a, node);

        match a.kind(node) {
            Kind::Identifier | Kind::PrivateIdentifier | Kind::JsxNamespacedName => {
                if !can_use_source_file
                    || get_source_file_of_node(a, node)
                        != self.emit_context.most_original(self.current_source_file)
                {
                    return a.text(node).to_vec();
                }
            }
            Kind::StringLiteral
            | Kind::NumericLiteral
            | Kind::BigIntLiteral
            | Kind::NoSubstitutionTemplateLiteral
            | Kind::TemplateHead
            | Kind::TemplateMiddle
            | Kind::TemplateTail => {
                return self.get_literal_text_of_node(node, NodeId::NIL, GetLiteralTextFlags::NONE);
            }
            _ => return a.unhandled("unexpected node in getTextOfNode", node),
        }
        get_source_text_of_node_from_source_file(a, self.current_source_file, node, include_trivia)
    }

    fn write_as(&mut self, text: &[u8], write_kind: WriteKind) {
        match write_kind {
            WriteKind::None => self.w().write(text),
            WriteKind::Parameter => self.write_parameter(text),
            WriteKind::Keyword => self.write_keyword(text),
            WriteKind::Operator => self.write_operator(text),
            WriteKind::Property => self.write_property(text),
            WriteKind::Punctuation => self.write_punctuation(text),
            WriteKind::StringLiteral => self.w().write_string_literal(text),
            WriteKind::Comment => self.write_comment(text),
            WriteKind::Literal => self.write_literal(text),
        }
    }

    fn write(&mut self, text: &[u8]) {
        self.write_as(text, self.write_kind);
    }

    fn write_symbol(&mut self, text: &[u8], opt_symbol: SymbolId) {
        if opt_symbol.is_nil() {
            self.write(text);
        } else {
            self.w().write_symbol(text, opt_symbol);
        }
    }

    fn write_literal(&mut self, text: &[u8]) {
        self.w().write_literal(text);
    }

    fn write_punctuation(&mut self, text: &[u8]) {
        self.w().write_punctuation(text);
    }

    fn write_operator(&mut self, text: &[u8]) {
        self.w().write_operator(text);
    }

    fn write_keyword(&mut self, text: &[u8]) {
        self.w().write_keyword(text);
    }

    fn write_property(&mut self, text: &[u8]) {
        self.w().write_property(text);
    }

    fn write_parameter(&mut self, text: &[u8]) {
        self.w().write_parameter(text);
    }

    fn write_comment(&mut self, text: &[u8]) {
        self.w().write_comment(text);
    }

    fn write_space(&mut self) {
        self.w().write_space(b" ");
    }

    fn write_line(&mut self) {
        self.w().write_line();
    }

    fn write_line_repeat(&mut self, count: isize) {
        for _ in 0..count {
            self.write_line();
        }
    }

    fn write_trailing_semicolon(&mut self) {
        self.w().write_trailing_semicolon(b";");
    }

    fn increase_indent(&mut self) {
        self.w().increase_indent();
    }

    fn decrease_indent(&mut self) {
        self.w().decrease_indent();
    }

    fn increase_indent_if(&mut self, indent_requested: bool) {
        if indent_requested {
            self.increase_indent();
        }
    }

    fn decrease_indent_if(&mut self, indent_requested: bool) {
        if indent_requested {
            self.decrease_indent();
        }
    }

    fn get_lines_between_nodes(&mut self, parent: NodeId, node1: NodeId, node2: NodeId) -> isize {
        let a = self.a;
        if self.should_elide_indentation(parent) {
            return 0;
        }

        let parent = skip_synthesized_parentheses(a, parent);
        let node1 = skip_synthesized_parentheses(a, node1);
        let node2 = skip_synthesized_parentheses(a, node2);

        // Always use a newline for synthesized code if the synthesizer desires it.
        if self.should_emit_on_new_line(node2, ListFormat::NONE) {
            return 1;
        }

        if !self.current_source_file.is_nil()
            && !node_is_synthesized(a, parent)
            && !node_is_synthesized(a, node1)
            && !node_is_synthesized(a, node2)
        {
            if self.options.preserve_source_newlines {
                return self.get_effective_lines(parent);
            }
            return if range_end_is_on_same_line_as_range_start(
                a,
                a.loc(node1),
                a.loc(node2),
                self.current_source_file,
            ) {
                0
            } else {
                1
            };
        }

        0
    }

    // Upstream takes the function that measures the lines: the measures are not ported, `node` is where the stand-in was reached.
    fn get_effective_lines(&mut self, node: NodeId) -> isize {
        self.a.unhandled("Printer.getEffectiveLines", node)
    }

    fn get_leading_line_terminator_count(
        &mut self,
        parent_node: NodeId,
        first_child: NodeId,
        format: ListFormat,
    ) -> isize {
        let a = self.a;
        if format.intersects(ListFormat::PRESERVE_LINES) || self.options.preserve_source_newlines {
            if format.intersects(ListFormat::PREFER_NEW_LINE) {
                return 1;
            }

            if first_child.is_nil() {
                return if parent_node.is_nil()
                    || !self.current_source_file.is_nil()
                        && range_is_on_single_line(a, a.loc(parent_node), self.current_source_file)
                {
                    0
                } else {
                    1
                };
            }
            if self.next_list_element_pos > 0 && a.pos(first_child) == self.next_list_element_pos {
                // If this child starts at the beginning of a list item in a parent list, its leading line terminators have already been written as the separating line terminators of the parent list.
                return 0;
            }
            if a.kind(first_child) == Kind::JsxText {
                // JsxText will be written with its leading whitespace, so don't add more manually.
                return 0;
            }
            if !self.current_source_file.is_nil()
                && !parent_node.is_nil()
                && !position_is_synthesized(a.pos(parent_node))
                && !node_is_synthesized(a, first_child)
                && a.parent(first_child).is_nil()
            {
                if self.options.preserve_source_newlines {
                    return self.get_effective_lines(first_child);
                }
                return if range_start_positions_are_on_same_line(
                    a,
                    a.loc(parent_node),
                    a.loc(first_child),
                    self.current_source_file,
                ) {
                    0
                } else {
                    1
                };
            }
            if self.should_emit_on_new_line(first_child, format) {
                return 1;
            }
        }
        if format.intersects(ListFormat::MULTI_LINE) {
            1
        } else {
            0
        }
    }

    fn get_separating_line_terminator_count(
        &mut self,
        previous_node: NodeId,
        next_node: NodeId,
        format: ListFormat,
    ) -> isize {
        let a = self.a;
        if format.intersects(ListFormat::PRESERVE_LINES) || self.options.preserve_source_newlines {
            if previous_node.is_nil() || next_node.is_nil() {
                return 0;
            }
            if a.kind(next_node) == Kind::JsxText {
                // JsxText will be written with its leading whitespace, so don't add more manually.
                return 0;
            } else if !self.current_source_file.is_nil()
                && !node_is_synthesized(a, previous_node)
                && !node_is_synthesized(a, next_node)
            {
                if self.options.preserve_source_newlines {
                    // siblingNodePositionsAreComparable and the line measure of upstream are not ported.
                    return self.get_effective_lines(next_node);
                } else if original_nodes_have_same_parent(
                    a,
                    self.emit_context,
                    previous_node,
                    next_node,
                ) {
                    // If `preserveSourceNewlines` is false we do not intend to preserve the effective lines between the previous and next node: instead we naively check whether nodes are on separate lines within the same parent.
                    return if range_end_is_on_same_line_as_range_start(
                        a,
                        a.loc(previous_node),
                        a.loc(next_node),
                        self.current_source_file,
                    ) {
                        0
                    } else {
                        1
                    };
                }
                // If the two nodes are not comparable, add a line terminator based on the format that can indicate whether new lines are preferred or not.
                return if format.intersects(ListFormat::PREFER_NEW_LINE) {
                    1
                } else {
                    0
                };
            } else if self.should_emit_on_new_line(previous_node, format)
                || self.should_emit_on_new_line(next_node, format)
            {
                return 1;
            }
        } else if self.should_emit_on_new_line(next_node, ListFormat::NONE) {
            return 1;
        }
        if format.intersects(ListFormat::MULTI_LINE) {
            1
        } else {
            0
        }
    }

    fn get_closing_line_terminator_count(
        &mut self,
        parent_node: NodeId,
        last_child: NodeId,
        format: ListFormat,
        children_text_range: TextRange,
    ) -> isize {
        let a = self.a;
        if format.intersects(ListFormat::PRESERVE_LINES) || self.options.preserve_source_newlines {
            if format.intersects(ListFormat::PREFER_NEW_LINE) {
                return 1;
            }
            if last_child.is_nil() {
                return if parent_node.is_nil()
                    || !self.current_source_file.is_nil()
                        && range_is_on_single_line(a, a.loc(parent_node), self.current_source_file)
                {
                    0
                } else {
                    1
                };
            }
            if !self.current_source_file.is_nil()
                && !parent_node.is_nil()
                && !position_is_synthesized(a.pos(parent_node))
                && !node_is_synthesized(a, last_child)
                && (a.parent(last_child).is_nil() || a.parent(last_child) == parent_node)
            {
                if self.options.preserve_source_newlines {
                    let _end =
                        greatest_end(a, a.end(last_child), &[EndOf::Range(children_text_range)]);
                    return self.get_effective_lines(last_child);
                }
                return if range_end_positions_are_on_same_line(
                    a,
                    a.loc(parent_node),
                    a.loc(last_child),
                    self.current_source_file,
                ) {
                    0
                } else {
                    1
                };
            }
            if self.should_emit_on_new_line(last_child, format) {
                return 1;
            }
        }
        if format.intersects(ListFormat::MULTI_LINE)
            && !format.intersects(ListFormat::NO_TRAILING_NEW_LINE)
        {
            return 1;
        }
        0
    }

    fn should_emit_comments(&self, node: NodeId) -> bool {
        !self.comments_disabled
            && !self.current_source_file.is_nil()
            && !is_source_file(self.a, node)
    }

    fn should_emit_indented(&self, node: NodeId) -> bool {
        self.emit_context
            .emit_flags(node)
            .intersects(EmitFlags::INDENTED)
    }

    fn should_elide_indentation(&self, node: NodeId) -> bool {
        self.emit_context
            .emit_flags(node)
            .intersects(EmitFlags::NO_INDENTATION)
    }

    fn should_emit_on_single_line(&self, node: NodeId) -> bool {
        self.emit_context
            .emit_flags(node)
            .intersects(EmitFlags::SINGLE_LINE)
    }

    fn should_emit_on_multiple_lines(&self, node: NodeId) -> bool {
        self.emit_context
            .emit_flags(node)
            .intersects(EmitFlags::MULTI_LINE)
    }

    fn should_emit_on_new_line(&self, node: NodeId, format: ListFormat) -> bool {
        if self
            .emit_context
            .emit_flags(node)
            .intersects(EmitFlags::START_ON_NEW_LINE)
        {
            return true;
        }
        format.intersects(ListFormat::PREFER_NEW_LINE)
    }

    // `p.sourceMapSource != nil` is never true here: no source map source is ever set.
    fn should_emit_source_maps(&self, node: NodeId) -> bool {
        !self.source_maps_disabled
            && !is_source_file(self.a, node)
            && !is_in_json_file(self.a, node)
    }

    fn should_emit_token_source_maps(
        &self,
        token: Kind,
        context_node: NodeId,
        flags: TokenEmitFlags,
    ) -> bool {
        // We don't emit source positions for most tokens as it tends to be quite noisy, however we need to emit source positions for open and close braces so that tools like istanbul can map branches for code coverage. However, we still omit brace source positions when the output is a declaration file.
        !flags.intersects(TokenEmitFlags::NO_SOURCE_MAPS)
            && self.should_emit_source_maps(context_node)
            && !self.options.omit_brace_source_map_positions
            && (token == Kind::OpenBraceToken || token == Kind::CloseBraceToken)
    }

    fn should_emit_leading_comments(&self, node: NodeId) -> bool {
        !self
            .emit_context
            .emit_flags(node)
            .intersects(EmitFlags::NO_LEADING_COMMENTS)
    }

    fn should_emit_trailing_comments(&self, node: NodeId) -> bool {
        !self
            .emit_context
            .emit_flags(node)
            .intersects(EmitFlags::NO_TRAILING_COMMENTS)
    }
}

// Tokens, literals, identifiers and names
impl Printer<'_> {
    fn write_token_text(&mut self, token: Kind, write_kind: WriteKind, pos: i32) -> i32 {
        let token_string = token_to_string(token);
        self.write_as(token_string, write_kind);
        if position_is_synthesized(pos) {
            pos
        } else {
            pos + token_string.len() as i32
        }
    }

    fn emit_token(
        &mut self,
        token: Kind,
        pos: i32,
        write_kind: WriteKind,
        context_node: NodeId,
    ) -> i32 {
        self.emit_token_ex(token, pos, write_kind, context_node, TokenEmitFlags::NONE)
    }

    fn emit_token_ex(
        &mut self,
        token: Kind,
        pos: i32,
        write_kind: WriteKind,
        context_node: NodeId,
        flags: TokenEmitFlags,
    ) -> i32 {
        let (state, pos) = self.enter_token(token, pos, context_node, flags);
        let pos = self.write_token_text(token, write_kind, pos);
        self.exit_token(token, pos, context_node, state);
        pos
    }

    fn emit_keyword_node(&mut self, node: NodeId) {
        self.emit_keyword_node_ex(node, TokenEmitFlags::NONE);
    }

    fn emit_keyword_node_ex(&mut self, node: NodeId, flags: TokenEmitFlags) {
        if node.is_nil() {
            return;
        }
        let state = self.enter_token_node(node, flags);
        self.write_token_text(self.a.kind(node), WriteKind::Keyword, self.a.pos(node));
        self.exit_token_node(node, state);
    }

    fn emit_punctuation_node(&mut self, node: NodeId) {
        self.emit_punctuation_node_ex(node, TokenEmitFlags::NONE);
    }

    fn emit_punctuation_node_ex(&mut self, node: NodeId, flags: TokenEmitFlags) {
        if node.is_nil() {
            return;
        }
        let state = self.enter_token_node(node, flags);
        self.write_token_text(self.a.kind(node), WriteKind::Punctuation, self.a.pos(node));
        self.exit_token_node(node, state);
    }

    fn emit_token_node(&mut self, node: NodeId) {
        self.emit_token_node_ex(node, TokenEmitFlags::NONE);
    }

    fn emit_token_node_ex(&mut self, node: NodeId, flags: TokenEmitFlags) {
        if node.is_nil() {
            return;
        }
        let kind = self.a.kind(node);
        if is_keyword_kind(kind) {
            self.emit_keyword_node_ex(node, flags);
        } else if is_punctuation_kind(kind) {
            self.emit_punctuation_node_ex(node, flags);
        } else {
            self.a.unhandled::<()>("unexpected TokenNode", node);
        }
    }

    fn emit_literal(&mut self, node: NodeId, flags: GetLiteralTextFlags) {
        let mut flags = flags;
        if self.options.never_ascii_escape {
            flags |= GetLiteralTextFlags::NEVER_ASCII_ESCAPE;
        }
        if self.options.terminate_unterminated_literals {
            flags |= GetLiteralTextFlags::TERMINATE_UNTERMINATED_LITERALS;
        }
        let text = self.get_literal_text_of_node(node, NodeId::NIL, flags);
        self.w().write_string_literal(&text);
    }

    fn emit_numeric_literal(&mut self, node: NodeId) {
        let state = self.enter_node(node);
        self.emit_literal(node, GetLiteralTextFlags::NONE);
        self.exit_node(node, state);
    }

    fn emit_big_int_literal(&mut self, node: NodeId) {
        let state = self.enter_node(node);
        self.emit_literal(node, GetLiteralTextFlags::NONE);
        self.exit_node(node, state);
    }

    fn emit_string_literal(&mut self, node: NodeId) {
        let state = self.enter_node(node);
        self.emit_literal(node, GetLiteralTextFlags::NONE);
        self.exit_node(node, state);
    }

    fn emit_no_substitution_template_literal(&mut self, node: NodeId) {
        let state = self.enter_node(node);
        self.emit_literal(node, GetLiteralTextFlags::NONE);
        self.exit_node(node, state);
    }

    fn emit_template_head(&mut self, node: NodeId) {
        let state = self.enter_node(node);
        self.emit_literal(node, GetLiteralTextFlags::NONE);
        self.exit_node(node, state);
    }

    fn emit_template_middle(&mut self, node: NodeId) {
        let state = self.enter_node(node);
        self.emit_literal(node, GetLiteralTextFlags::NONE);
        self.exit_node(node, state);
    }

    fn emit_template_tail(&mut self, node: NodeId) {
        let state = self.enter_node(node);
        self.emit_literal(node, GetLiteralTextFlags::NONE);
        self.exit_node(node, state);
    }

    fn emit_template_middle_tail(&mut self, node: NodeId) {
        match self.a.kind(node) {
            Kind::TemplateMiddle => self.emit_template_middle(node),
            Kind::TemplateTail => self.emit_template_tail(node),
            _ => {}
        }
    }

    // `p.IdToSymbol` is nil for the checker: a symbol is never written with an identifier here.
    fn emit_identifier_text(&mut self, node: NodeId) {
        let text = self.get_text_of_node(node, false);
        self.write_symbol(&text, SymbolId::NIL);
    }

    fn emit_identifier_name(&mut self, node: NodeId) {
        let state = self.enter_node(node);
        self.emit_identifier_text(node);
        self.exit_node(node, state);
    }

    // `uniqueHelperNames` is never made here: getUniqueHelperName and the helper name of an identifier belong to transformed output.
    fn emit_identifier_reference(&mut self, node: NodeId) {
        if !self.external_helpers_module_name.is_nil()
            && self
                .emit_context
                .emit_flags(node)
                .intersects(EmitFlags::HELPER_NAME)
        {
            return self.a.unhandled("Printer.getUniqueHelperName", node);
        }
        let state = self.enter_node(node);
        self.emit_identifier_text(node);
        self.exit_node(node, state);
    }

    fn emit_binding_identifier(&mut self, node: NodeId) {
        let state = self.enter_node(node);
        self.emit_identifier_text(node);
        self.exit_node(node, state);
    }

    fn emit_private_identifier(&mut self, node: NodeId) {
        let state = self.enter_node(node);
        let text = self.get_text_of_node(node, false);
        self.write(&text);
        self.exit_node(node, state);
    }

    fn emit_qualified_name(&mut self, node: NodeId) {
        let qualified = self.a.as_qualified_name(node);
        let state = self.enter_node(node);
        self.emit_entity_name(qualified.left);
        self.write_punctuation(b".");
        self.emit_member_name(qualified.right);
        self.exit_node(node, state);
    }

    fn emit_computed_property_name(&mut self, node: NodeId) {
        let expression = self.a.as_computed_property_name(node).expression;
        let state = self.enter_node(node);
        self.write_punctuation(b"[");
        self.emit_expression(expression, OperatorPrecedence::DISALLOW_COMMA);
        self.write_punctuation(b"]");
        self.exit_node(node, state);
    }

    fn emit_entity_name(&mut self, node: NodeId) {
        match self.a.kind(node) {
            Kind::Identifier => self.emit_identifier_reference(node),
            Kind::QualifiedName => self.emit_qualified_name(node),
            Kind::PropertyAccessExpression => {
                self.emit_expression(node, OperatorPrecedence::DISALLOW_COMMA);
            }
            _ => self.a.unhandled("unexpected EntityName", node),
        }
    }

    fn emit_binding_name(&mut self, node: NodeId) {
        if node.is_nil() {
            return;
        }
        match self.a.kind(node) {
            Kind::Identifier => self.emit_binding_identifier(node),
            Kind::ObjectBindingPattern => self.emit_object_binding_pattern(node),
            Kind::ArrayBindingPattern => self.emit_array_binding_pattern(node),
            _ => self.a.unhandled("unexpected BindingName", node),
        }
    }

    fn emit_property_name(&mut self, node: NodeId) {
        if node.is_nil() {
            return;
        }
        let saved_write_kind = self.write_kind;
        self.write_kind = WriteKind::Property;
        match self.a.kind(node) {
            Kind::Identifier => self.emit_identifier_name(node),
            Kind::PrivateIdentifier => self.emit_private_identifier(node),
            Kind::StringLiteral => self.emit_string_literal(node),
            Kind::NoSubstitutionTemplateLiteral => self.emit_no_substitution_template_literal(node),
            Kind::NumericLiteral => self.emit_numeric_literal(node),
            Kind::BigIntLiteral => self.emit_big_int_literal(node),
            Kind::ComputedPropertyName => self.emit_computed_property_name(node),
            _ => self.a.unhandled("unexpected PropertyName", node),
        }
        self.write_kind = saved_write_kind;
    }

    fn emit_member_name(&mut self, node: NodeId) {
        if node.is_nil() {
            return;
        }
        match self.a.kind(node) {
            Kind::Identifier => self.emit_identifier_name(node),
            Kind::PrivateIdentifier => self.emit_private_identifier(node),
            _ => self.a.unhandled("unexpected MemberName", node),
        }
    }

    fn emit_import_attribute_name(&mut self, node: NodeId) {
        match self.a.kind(node) {
            Kind::Identifier => self.emit_identifier_name(node),
            Kind::StringLiteral => self.emit_string_literal(node),
            _ => self.a.unhandled("unexpected ImportAttributeName", node),
        }
    }
}

// Comments, source maps, name generation, and the state around a node or a token
impl Printer<'_> {
    fn emit_comments_before_node(&mut self, node: NodeId) -> Option<CommentState> {
        if !self.should_emit_comments(node) {
            return None;
        }

        let emit_flags = self.emit_context.emit_flags(node);
        let comment_range = self.emit_context.comment_range(self.a, node);
        let container_pos = self.container_pos;
        let container_end = self.container_end;
        let declaration_list_container_end = self.declaration_list_container_end;

        // Emit leading comments: the comments of the source text and the synthetic comments of the node are not ported.
        self.a
            .unhandled::<()>("Printer.emitLeadingCommentsOfNode", node);

        if emit_flags.intersects(EmitFlags::NO_NESTED_COMMENTS) {
            self.comments_disabled = true;
        }

        Some(CommentState {
            emit_flags,
            comment_range,
            container_pos,
            container_end,
            declaration_list_container_end,
        })
    }

    fn emit_comments_after_node(&mut self, node: NodeId, state: Option<CommentState>) {
        let Some(state) = state else {
            return;
        };

        if state.emit_flags.intersects(EmitFlags::NO_NESTED_COMMENTS) {
            self.comments_disabled = false;
        }

        // The trailing comments read the range and the container positions that entering the node captured.
        let _ = (
            state.comment_range,
            state.container_pos,
            state.container_end,
            state.declaration_list_container_end,
        );
        self.a
            .unhandled::<()>("Printer.emitTrailingCommentsOfNode", node);
    }

    fn emit_comments_before_token(
        &mut self,
        pos: i32,
        context_node: NodeId,
        flags: TokenEmitFlags,
    ) -> (Option<CommentState>, i32) {
        let a = self.a;
        let mut pos = pos;
        if flags.intersects(TokenEmitFlags::NO_COMMENTS) || self.comments_disabled {
            if !self.current_source_file.is_nil() && !position_is_synthesized(pos) {
                pos = skip_trivia(a.as_source_file(self.current_source_file).text(), pos);
            }
            return (None, pos);
        }

        let start_pos = pos;
        if !self.current_source_file.is_nil() {
            pos = skip_trivia(a.as_source_file(self.current_source_file).text(), start_pos);
        }

        let node = self.emit_context.parse_node(a, context_node);
        let is_similar_node = !node.is_nil() && a.kind(node) == a.kind(context_node);
        if !is_similar_node {
            return (None, pos);
        }

        if a.pos(context_node) != start_pos {
            let indent_leading = flags.intersects(TokenEmitFlags::INDENT_LEADING_COMMENTS);
            let needs_indent = indent_leading
                && !self.current_source_file.is_nil()
                && !positions_are_on_same_line(a, start_pos, pos, self.current_source_file);
            self.increase_indent_if(needs_indent);
            self.emit_leading_comments(start_pos, false);
            self.decrease_indent_if(needs_indent);
        }

        (Some(CommentState::default()), pos)
    }

    fn emit_comments_after_token(
        &mut self,
        pos: i32,
        context_node: NodeId,
        state: Option<CommentState>,
    ) {
        if state.is_none() {
            return;
        }

        if self.a.end(context_node) != pos {
            // Emit the trailing comments of the token, unless it is the last token of the node.
            let is_jsx_expr_context = self.a.kind(context_node) == Kind::JsxExpression;
            self.emit_trailing_comments(
                pos,
                if is_jsx_expr_context {
                    CommentSeparator::None
                } else {
                    CommentSeparator::Before
                },
            );
        }
    }

    fn emit_leading_comments(&mut self, pos: i32, _elided: bool) -> bool {
        if self.comments_disabled
            || self.current_source_file.is_nil()
            || position_is_synthesized(pos)
            || pos == self.container_pos
        {
            return false;
        }
        // shouldWriteComment, shouldEmitCommentIfTripleSlash and emitComments are not ported: the comments of a source text are never written.
        self.a
            .unhandled("Printer.emitComments", self.current_source_file)
    }

    fn emit_trailing_comments(&mut self, pos: i32, _comment_separator: CommentSeparator) {
        if self.comments_disabled {
            return;
        }
        if self.current_source_file.is_nil()
            || self.container_end != -1
                && (pos == self.container_end || pos == self.declaration_list_container_end)
        {
            return;
        }
        self.a
            .unhandled::<()>("Printer.emitComments", self.current_source_file);
    }

    fn emit_trailing_comments_of_position(
        &mut self,
        pos: i32,
        _prefix_space: bool,
        _force_no_newline: bool,
    ) {
        if self.comments_disabled || self.current_source_file.is_nil() {
            return;
        }
        if self.container_end != -1
            && (pos == self.container_end || pos == self.declaration_list_container_end)
        {
            return;
        }
        let text = self.a.as_source_file(self.current_source_file).text();
        if get_trailing_comment_ranges(text, pos).is_empty() {
            return;
        }
        self.a
            .unhandled::<()>("Printer.emitComment", self.current_source_file);
    }

    // `source` is a source file: nothing is set while source maps are disabled.
    fn set_source_map_source(&mut self, source: NodeId) {
        if self.source_maps_disabled {
            return;
        }
        self.a.unhandled::<()>("Printer.setSourceMapSource", source);
    }

    fn emit_source_maps_before_node(&mut self, node: NodeId) {
        if !self.should_emit_source_maps(node) {
            return;
        }
        self.a.unhandled::<()>("Printer.emitSourcePos", node);
    }

    fn emit_source_maps_after_node(&mut self, node: NodeId) {
        if !self.should_emit_source_maps(node) {
            return;
        }
        self.a.unhandled::<()>("Printer.emitSourcePos", node);
    }

    fn emit_source_maps_before_token(
        &mut self,
        token: Kind,
        context_node: NodeId,
        flags: TokenEmitFlags,
    ) {
        if !self.should_emit_token_source_maps(token, context_node, flags) {
            return;
        }
        self.a
            .unhandled::<()>("Printer.emitSourcePos", context_node);
    }

    fn emit_source_maps_after_token(
        &mut self,
        token: Kind,
        context_node: NodeId,
        flags: TokenEmitFlags,
    ) {
        if !self.should_emit_token_source_maps(token, context_node, flags) {
            return;
        }
        self.a
            .unhandled::<()>("Printer.emitSourcePos", context_node);
    }

    fn should_reuse_temp_variable_scope(&self, node: NodeId) -> bool {
        !node.is_nil()
            && self
                .emit_context
                .emit_flags(node)
                .intersects(EmitFlags::REUSE_TEMP_VARIABLE_SCOPE)
    }

    fn push_name_generation_scope(&mut self, node: NodeId) {
        let reuse = self.should_reuse_temp_variable_scope(node);
        self.name_generator.push_scope(reuse);
    }

    fn pop_name_generation_scope(&mut self, node: NodeId) {
        let reuse = self.should_reuse_temp_variable_scope(node);
        self.name_generator.pop_scope(reuse);
    }

    fn generate_all_names(&mut self, nodes: NodeListId) {
        if nodes.is_nil() {
            return;
        }
        let list = self.a.nodes(nodes);
        for node in list.as_slice() {
            self.generate_names(*node);
        }
    }

    // Only the kinds that a type node or a signature can hold are walked: the statement kinds of upstream end in the stand-in.
    fn generate_names(&mut self, node: NodeId) {
        if node.is_nil() {
            return;
        }
        let a = self.a;
        match a.kind(node) {
            Kind::VariableDeclaration
            | Kind::Parameter
            | Kind::BindingElement
            | Kind::ClassDeclaration => self.generate_name_if_needed(a.name(node)),
            Kind::ObjectBindingPattern | Kind::ArrayBindingPattern => {
                self.generate_all_names(a.element_list(node));
            }
            Kind::Block
            | Kind::CaseClause
            | Kind::DefaultClause
            | Kind::LabeledStatement
            | Kind::WithStatement
            | Kind::DoStatement
            | Kind::WhileStatement
            | Kind::IfStatement
            | Kind::ForStatement
            | Kind::ForOfStatement
            | Kind::ForInStatement
            | Kind::SwitchStatement
            | Kind::CaseBlock
            | Kind::TryStatement
            | Kind::CatchClause
            | Kind::VariableStatement
            | Kind::VariableDeclarationList
            | Kind::FunctionDeclaration
            | Kind::ImportDeclaration
            | Kind::JSImportDeclaration
            | Kind::ImportClause
            | Kind::NamespaceImport
            | Kind::NamespaceExport
            | Kind::NamedImports
            | Kind::ImportSpecifier => a.unhandled("Printer.generateNames: statement", node),
            _ => {}
        }
    }

    fn generate_all_member_names(&mut self, nodes: NodeListId) {
        if nodes.is_nil() {
            return;
        }
        let list = self.a.nodes(nodes);
        for node in list.as_slice() {
            self.generate_member_names(*node);
        }
    }

    fn generate_member_names(&mut self, node: NodeId) {
        if node.is_nil() {
            return;
        }
        match self.a.kind(node) {
            Kind::PropertyAssignment
            | Kind::ShorthandPropertyAssignment
            | Kind::PropertyDeclaration
            | Kind::PropertySignature
            | Kind::MethodDeclaration
            | Kind::MethodSignature
            | Kind::GetAccessor
            | Kind::SetAccessor => self.generate_name_if_needed(self.a.name(node)),
            _ => {}
        }
    }

    fn generate_name_if_needed(&mut self, name: NodeId) {
        if !name.is_nil() {
            if is_member_name(self.a, name) {
                self.generate_name_of(name);
            } else if is_binding_pattern(self.a, name) {
                self.generate_names(name);
            }
        }
    }

    // `generateName` of upstream: the text is discarded.
    fn generate_name_of(&mut self, name: NodeId) {
        let _ = self.generate_name(name);
    }

    // `p.nameGenerator.GenerateName(name)`: the name generator calls back for the text of a name that is not generated.
    fn generate_name(&mut self, name: NodeId) -> Vec<u8> {
        let a = self.a;
        match self
            .name_generator
            .generate_name(a, self.emit_context, name)
        {
            Some(text) => text,
            None => {
                if self.emit_context.auto_generate.contains_key(&name) {
                    // A generated name that the name generator cannot make falls back to the text of the node, where upstream makes a unique name.
                    return a.text(name).to_vec();
                }
                self.get_text_of_node(name, false)
            }
        }
    }

    fn enter_node(&mut self, node: NodeId) -> PrinterState {
        if let Some(on_before_emit_node) = self.handlers.on_before_emit_node.as_mut() {
            on_before_emit_node(node);
        }
        let comment_state = self.emit_comments_before_node(node);
        self.emit_source_maps_before_node(node);
        PrinterState { comment_state }
    }

    fn exit_node(&mut self, node: NodeId, previous_state: PrinterState) {
        self.emit_source_maps_after_node(node);
        self.emit_comments_after_node(node, previous_state.comment_state);
        if let Some(on_after_emit_node) = self.handlers.on_after_emit_node.as_mut() {
            on_after_emit_node(node);
        }
    }

    fn enter_token_node(&mut self, node: NodeId, flags: TokenEmitFlags) -> PrinterState {
        let mut state = PrinterState::default();
        if let Some(on_before_emit_token) = self.handlers.on_before_emit_token.as_mut() {
            on_before_emit_token(node);
        }
        if !flags.intersects(TokenEmitFlags::NO_COMMENTS) {
            state.comment_state = self.emit_comments_before_node(node);
        }
        if !flags.intersects(TokenEmitFlags::NO_SOURCE_MAPS) {
            self.emit_source_maps_before_node(node);
        }
        state
    }

    fn exit_token_node(&mut self, node: NodeId, previous_state: PrinterState) {
        self.emit_source_maps_after_node(node);
        self.emit_comments_after_node(node, previous_state.comment_state);
        if let Some(on_after_emit_token) = self.handlers.on_after_emit_token.as_mut() {
            on_after_emit_token(node);
        }
    }

    fn enter_token(
        &mut self,
        token: Kind,
        pos: i32,
        context_node: NodeId,
        flags: TokenEmitFlags,
    ) -> ((PrinterState, TokenEmitFlags), i32) {
        let (comment_state, pos) = self.emit_comments_before_token(pos, context_node, flags);
        self.emit_source_maps_before_token(token, context_node, flags);
        ((PrinterState { comment_state }, flags), pos)
    }

    fn exit_token(
        &mut self,
        token: Kind,
        pos: i32,
        context_node: NodeId,
        previous_state: (PrinterState, TokenEmitFlags),
    ) {
        let (previous_state, flags) = previous_state;
        self.emit_source_maps_after_token(token, context_node, flags);
        self.emit_comments_after_token(pos, context_node, previous_state.comment_state);
    }
}

fn get_opening_bracket(a: Ast<'_>, format: ListFormat) -> &'static [u8] {
    let brackets = format & ListFormat::BRACKETS_MASK;
    if brackets == ListFormat::BRACES {
        b"{"
    } else if brackets == ListFormat::PARENTHESIS {
        b"("
    } else if brackets == ListFormat::ANGLE_BRACKETS {
        b"<"
    } else if brackets == ListFormat::SQUARE_BRACKETS {
        b"["
    } else {
        a.unhandled::<()>("Unexpected bracket", NodeId::NIL);
        b""
    }
}

fn get_closing_bracket(a: Ast<'_>, format: ListFormat) -> &'static [u8] {
    let brackets = format & ListFormat::BRACKETS_MASK;
    if brackets == ListFormat::BRACES {
        b"}"
    } else if brackets == ListFormat::PARENTHESIS {
        b")"
    } else if brackets == ListFormat::ANGLE_BRACKETS {
        b">"
    } else if brackets == ListFormat::SQUARE_BRACKETS {
        b"]"
    } else {
        a.unhandled::<()>("Unexpected bracket", NodeId::NIL);
        b""
    }
}

// Signature elements and type members
impl Printer<'_> {
    fn emit_modifier_list(
        &mut self,
        parent_node: NodeId,
        modifiers: ModifierListId,
        allow_decorators: bool,
    ) -> i32 {
        let a = self.a;
        if modifiers.is_nil() {
            return a.pos(parent_node);
        }
        let nodes: Vec<NodeId> = a.modifier_list_nodes(modifiers).as_slice().to_vec();
        let Some(&last) = nodes.last() else {
            return a.pos(parent_node);
        };
        let list_loc = a.modifier_list_loc(modifiers);

        if nodes.iter().all(|node| is_modifier(a, *node)) {
            self.emit_modifier_items(Self::emit_keyword_node, parent_node, &nodes, list_loc);
        } else if nodes.iter().all(|node| is_decorator(a, *node)) {
            if !allow_decorators {
                return a.pos(parent_node);
            }
            // decorators belong to declarations that the type printer never makes
            return a.unhandled("Printer.emitDecorator", last);
        } else {
            // a list that mixes decorators and modifiers belongs to declarations that the type printer never makes
            return a.unhandled("Printer.emitDecorator", last);
        }

        greatest_end(a, a.pos(parent_node), &[EndOf::Node(last)])
    }

    // `emitList(emit, parentNode, &modifiers.NodeList, LFModifiers)`: the list is neither nil nor empty and has no brackets.
    fn emit_modifier_items(
        &mut self,
        emit: fn(&mut Self, NodeId),
        parent_node: NodeId,
        nodes: &[NodeId],
        list_loc: TextRange,
    ) {
        let mut format = ListFormat::MODIFIERS;
        if self.should_emit_on_multiple_lines(parent_node) {
            format |= ListFormat::PREFER_NEW_LINE | ListFormat::INDENTED;
        }
        self.emit_list_items(emit, parent_node, nodes, format, false, list_loc);
    }

    fn emit_type_parameter(&mut self, node: NodeId) {
        let a = self.a;
        let type_parameter = a.as_type_parameter_declaration(node);
        let state = self.enter_node(node);
        self.emit_modifier_list(node, a.modifiers(node), false);
        self.emit_binding_identifier(a.name(node));
        if !type_parameter.constraint.is_nil() {
            self.write_space();
            self.write_keyword(b"extends");
            self.write_space();
            self.emit_type_node_outside_extends(type_parameter.constraint);
        }
        if !type_parameter.default_type.is_nil() {
            self.write_space();
            self.write_operator(b"=");
            self.write_space();
            self.emit_type_node_outside_extends(type_parameter.default_type);
        }
        self.exit_node(node, state);
    }

    fn emit_type_parameter_declaration_node(&mut self, node: NodeId) {
        if is_type_parameter_declaration(self.a, node) {
            self.emit_type_parameter(node);
        } else {
            // NOTE: Strada supported `.typeArguments` on qualified names for quick info/signature help: a type argument can stand in a type parameter list.
            self.emit_type_argument(node);
        }
    }

    fn emit_parameter_name(&mut self, node: NodeId) {
        let saved_write_kind = self.write_kind;
        self.write_kind = WriteKind::Parameter;
        self.emit_binding_name(node);
        self.write_kind = saved_write_kind;
    }

    fn emit_parameter(&mut self, node: NodeId) {
        let a = self.a;
        let parameter = a.as_parameter_declaration(node);
        let state = self.enter_node(node);
        self.emit_modifier_list(node, a.modifiers(node), true);
        self.emit_token_node(parameter.dot_dot_dot_token);
        self.emit_parameter_name(a.name(node));
        self.emit_token_node(parameter.question_token);
        self.emit_type_annotation(a.type_node(node));
        let equal_token_pos = greatest_end(
            a,
            a.pos(node),
            &[
                EndOf::Node(a.type_node(node)),
                EndOf::Node(parameter.question_token),
                EndOf::Node(a.name(node)),
                EndOf::ModifierList(a.modifiers(node)),
            ],
        );
        self.emit_initializer(a.initializer(node), equal_token_pos, node);
        self.exit_node(node, state);
    }

    fn emit_parameter_declaration_node(&mut self, node: NodeId) {
        self.emit_parameter(node);
    }

    fn emit_type_parameters(&mut self, parent_node: NodeId, nodes: NodeListId) {
        if nodes.is_nil() {
            return;
        }
        let trailing_comma = if is_arrow_function(self.a, parent_node) {
            ListFormat::ALLOW_TRAILING_COMMA
        } else {
            ListFormat::NONE
        };
        self.emit_list(
            Self::emit_type_parameter_declaration_node,
            parent_node,
            nodes,
            ListFormat::TYPE_PARAMETERS | trailing_comma,
        );
    }

    fn emit_type_annotation(&mut self, node: NodeId) {
        if node.is_nil() {
            return;
        }
        self.write_punctuation(b":");
        self.write_space();
        self.emit_type_node_outside_extends(node);
    }

    fn emit_initializer(&mut self, node: NodeId, equal_token_pos: i32, context_node: NodeId) {
        if node.is_nil() {
            return;
        }
        self.write_space();
        self.emit_token(
            Kind::EqualsToken,
            equal_token_pos,
            WriteKind::Operator,
            context_node,
        );
        self.write_space();
        self.emit_expression(node, OperatorPrecedence::DISALLOW_COMMA);
    }

    fn emit_parameters(&mut self, parent_node: NodeId, parameters: NodeListId) {
        self.generate_all_names(parameters);
        self.emit_list(
            Self::emit_parameter_declaration_node,
            parent_node,
            parameters,
            ListFormat::PARAMETERS,
        );
    }

    fn emit_parameters_for_index_signature(&mut self, parent_node: NodeId, parameters: NodeListId) {
        self.generate_all_names(parameters);
        self.emit_list(
            Self::emit_parameter_declaration_node,
            parent_node,
            parameters,
            ListFormat::INDEX_SIGNATURE_PARAMETERS,
        );
    }

    fn emit_signature(&mut self, node: NodeId) {
        let a = self.a;
        self.emit_type_parameters(node, a.type_parameter_list(node));
        self.emit_parameters(node, a.parameter_list(node));
        self.emit_type_annotation(a.type_node(node));
    }

    fn emit_function_body_node(&mut self, node: NodeId) {
        if node.is_nil() {
            self.write_trailing_semicolon();
            return;
        }
        self.write_space();
        self.a.unhandled::<()>("Printer.emitFunctionBody", node);
    }

    fn emit_property_signature(&mut self, node: NodeId) {
        let a = self.a;
        let state = self.enter_node(node);
        self.emit_modifier_list(node, a.modifiers(node), false);
        self.emit_property_name(a.name(node));
        self.emit_token_node(a.postfix_token(node));
        self.emit_type_annotation(a.type_node(node));
        self.write_trailing_semicolon();
        self.exit_node(node, state);
    }

    fn emit_method_signature(&mut self, node: NodeId) {
        let a = self.a;
        let state = self.enter_node(node);
        self.emit_modifier_list(node, a.modifiers(node), false);
        self.emit_property_name(a.name(node));
        self.emit_token_node(a.postfix_token(node));
        let indented = self.should_emit_indented(node);
        self.increase_indent_if(indented);
        self.push_name_generation_scope(node);
        self.emit_signature(node);
        self.write_trailing_semicolon();
        self.pop_name_generation_scope(node);
        self.decrease_indent_if(indented);
        self.exit_node(node, state);
    }

    fn emit_accessor_declaration(&mut self, token: Kind, node: NodeId) {
        let a = self.a;
        let state = self.enter_node(node);
        let pos = self.emit_modifier_list(node, a.modifiers(node), true);
        self.emit_token(token, pos, WriteKind::Keyword, node);
        self.write_space();
        self.emit_property_name(a.name(node));
        let indented = self.should_emit_indented(node);
        self.increase_indent_if(indented);
        self.push_name_generation_scope(node);
        self.emit_signature(node);
        self.emit_function_body_node(a.body(node));
        self.pop_name_generation_scope(node);
        self.decrease_indent_if(indented);
        self.exit_node(node, state);
    }

    fn emit_get_accessor_declaration(&mut self, node: NodeId) {
        self.emit_accessor_declaration(Kind::GetKeyword, node);
    }

    fn emit_set_accessor_declaration(&mut self, node: NodeId) {
        self.emit_accessor_declaration(Kind::SetKeyword, node);
    }

    fn emit_call_signature(&mut self, node: NodeId) {
        let state = self.enter_node(node);
        let indented = self.should_emit_indented(node);
        self.increase_indent_if(indented);
        self.push_name_generation_scope(node);
        self.emit_signature(node);
        self.write_trailing_semicolon();
        self.pop_name_generation_scope(node);
        self.decrease_indent_if(indented);
        self.exit_node(node, state);
    }

    fn emit_construct_signature(&mut self, node: NodeId) {
        let state = self.enter_node(node);
        self.write_keyword(b"new");
        self.write_space();
        let indented = self.should_emit_indented(node);
        self.increase_indent_if(indented);
        self.push_name_generation_scope(node);
        self.emit_signature(node);
        self.write_trailing_semicolon();
        self.pop_name_generation_scope(node);
        self.decrease_indent_if(indented);
        self.exit_node(node, state);
    }

    fn emit_index_signature(&mut self, node: NodeId) {
        let a = self.a;
        let state = self.enter_node(node);
        self.emit_modifier_list(node, a.modifiers(node), false);
        let indented = self.should_emit_indented(node);
        self.increase_indent_if(indented);
        self.push_name_generation_scope(node);
        self.emit_parameters_for_index_signature(node, a.parameter_list(node));
        self.emit_type_annotation(a.type_node(node));
        self.write_trailing_semicolon();
        self.pop_name_generation_scope(node);
        self.decrease_indent_if(indented);
        self.exit_node(node, state);
    }

    fn emit_type_element(&mut self, node: NodeId) {
        match self.a.kind(node) {
            Kind::PropertySignature => self.emit_property_signature(node),
            Kind::MethodSignature => self.emit_method_signature(node),
            Kind::CallSignature => self.emit_call_signature(node),
            Kind::ConstructSignature => self.emit_construct_signature(node),
            Kind::GetAccessor => self.emit_get_accessor_declaration(node),
            Kind::SetAccessor => self.emit_set_accessor_declaration(node),
            Kind::IndexSignature => self.emit_index_signature(node),
            Kind::NotEmittedTypeElement => self.emit_not_emitted_type_element(node),
            _ => self.a.unhandled("unexpected TypeElement", node),
        }
    }
}

// Lists
impl Printer<'_> {
    fn emit_list(
        &mut self,
        emit: fn(&mut Self, NodeId),
        parent_node: NodeId,
        children: NodeListId,
        format: ListFormat,
    ) {
        let mut format = format;
        if self.should_emit_on_multiple_lines(parent_node) {
            format |= ListFormat::PREFER_NEW_LINE | ListFormat::INDENTED;
        }
        self.emit_list_range(emit, parent_node, children, format, -1, -1);
    }

    fn emit_list_range(
        &mut self,
        emit: fn(&mut Self, NodeId),
        parent_node: NodeId,
        children: NodeListId,
        format: ListFormat,
        start: isize,
        count: isize,
    ) {
        let a = self.a;
        let is_nil = children.is_nil();
        let nodes: Vec<NodeId> = if is_nil {
            Vec::new()
        } else {
            a.nodes(children).as_slice().to_vec()
        };
        let length = nodes.len() as isize;
        let mut start = start;
        let mut count = count;
        if start < 0 {
            start = 0;
        }
        if count < 0 {
            count = length - start;
        }

        if is_nil && format.intersects(ListFormat::OPTIONAL_IF_NIL) {
            return;
        }

        let is_empty = is_nil || start >= length || count <= 0;
        if is_empty && format.intersects(ListFormat::OPTIONAL_IF_EMPTY) {
            if let Some(on_before_emit_node_list) = self.handlers.on_before_emit_node_list.as_mut()
            {
                on_before_emit_node_list(children);
            }
            if let Some(on_after_emit_node_list) = self.handlers.on_after_emit_node_list.as_mut() {
                on_after_emit_node_list(children);
            }
            return;
        }

        if format.intersects(ListFormat::BRACKETS_MASK) {
            self.write_punctuation(get_opening_bracket(a, format));
            if is_empty && !is_nil {
                // Emit comments within empty lists
                self.emit_trailing_comments(a.list_loc(children).pos(), CommentSeparator::Before);
            }
        }

        if let Some(on_before_emit_node_list) = self.handlers.on_before_emit_node_list.as_mut() {
            on_before_emit_node_list(children);
        }

        if is_empty {
            // Write a line terminator if the parent node was multi-line
            if format.intersects(ListFormat::MULTI_LINE)
                && !(self.options.preserve_source_newlines
                    && (parent_node.is_nil()
                        || !self.current_source_file.is_nil()
                            && range_is_on_single_line(
                                a,
                                a.loc(parent_node),
                                self.current_source_file,
                            )))
            {
                self.write_line();
            } else if format.intersects(ListFormat::SPACE_BETWEEN_BRACES)
                && !format.intersects(ListFormat::NO_SPACE_IF_EMPTY)
            {
                self.write_space();
            }
        } else {
            let end = (start + count).min(length);
            let items = usize::try_from(start)
                .ok()
                .zip(usize::try_from(end).ok())
                .and_then(|(start, end)| nodes.get(start..end))
                .unwrap_or(&[]);
            let has_trailing_comma = self.has_trailing_comma(parent_node, children);
            self.emit_list_items(
                emit,
                parent_node,
                items,
                format,
                has_trailing_comma,
                a.list_loc(children),
            );
        }

        if let Some(on_after_emit_node_list) = self.handlers.on_after_emit_node_list.as_mut() {
            on_after_emit_node_list(children);
        }

        if format.intersects(ListFormat::BRACKETS_MASK) {
            if is_empty && !is_nil {
                // Emit leading comments within empty lists
                self.emit_leading_comments(a.list_loc(children).end(), false);
            }
            self.write_punctuation(get_closing_bracket(a, format));
        }
    }

    fn has_trailing_comma(&mut self, parent_node: NodeId, children: NodeListId) -> bool {
        let a = self.a;
        // NodeList.HasTrailingComma() is unreliable on transformed nodes as some nodes may have been reused but not their lists: the trailing comma is read from the list of the original parent.
        if !a.has_trailing_comma(children) {
            return false;
        }

        let original_parent = self.emit_context.most_original(parent_node);
        if original_parent == parent_node {
            // if this node is the original node, we can trust the result
            return true;
        }

        if a.kind(original_parent) != a.kind(parent_node) {
            // if the original node is some other kind of node, we cannot correlate the list
            return false;
        }

        // determine the respective node list in the original parent
        let mut original_list = children;
        match a.kind(original_parent) {
            Kind::ObjectLiteralExpression => original_list = a.property_list(original_parent),
            Kind::ArrayLiteralExpression => original_list = a.element_list(original_parent),
            Kind::CallExpression | Kind::NewExpression => {
                if children == a.type_argument_list(parent_node) {
                    original_list = a.type_argument_list(original_parent);
                } else if children == a.argument_list(parent_node) {
                    original_list = a.argument_list(original_parent);
                }
            }
            Kind::Constructor
            | Kind::MethodDeclaration
            | Kind::GetAccessor
            | Kind::SetAccessor
            | Kind::FunctionDeclaration
            | Kind::FunctionExpression
            | Kind::ArrowFunction
            | Kind::FunctionType
            | Kind::ConstructorType
            | Kind::CallSignature
            | Kind::ConstructSignature => {
                if children == a.type_parameter_list(parent_node) {
                    original_list = a.type_parameter_list(original_parent);
                } else if children == a.parameter_list(parent_node) {
                    original_list = a.parameter_list(original_parent);
                }
            }
            Kind::ClassDeclaration
            | Kind::ClassExpression
            | Kind::InterfaceDeclaration
            | Kind::TypeAliasDeclaration
            | Kind::JSTypeAliasDeclaration => {
                if children == a.type_parameter_list(parent_node) {
                    original_list = a.type_parameter_list(original_parent);
                }
            }
            Kind::ObjectBindingPattern | Kind::ArrayBindingPattern => {
                if children == a.element_list(parent_node) {
                    original_list = a.element_list(original_parent);
                }
            }
            Kind::NamedImports | Kind::NamedExports => {
                original_list = a.element_list(original_parent);
            }
            Kind::ImportAttributes => {
                original_list = a.as_import_attributes(original_parent).attributes;
            }
            _ => {}
        }

        // if we have the original list, we can use it's result.
        if !original_list.is_nil() {
            return a.has_trailing_comma(original_list);
        }
        false
    }

    fn write_delimiter(&mut self, format: ListFormat) {
        let delimiter = format & ListFormat::DELIMITERS_MASK;
        if delimiter == ListFormat::COMMA_DELIMITED {
            self.write_punctuation(b",");
        } else if delimiter == ListFormat::BAR_DELIMITED {
            self.write_space();
            self.write_punctuation(b"|");
        } else if delimiter == ListFormat::ASTERISK_DELIMITED {
            self.write_space();
            self.write_punctuation(b"*");
            self.write_space();
        } else if delimiter == ListFormat::AMPERSAND_DELIMITED {
            self.write_space();
            self.write_punctuation(b"&");
        }
    }

    // Emits a list without brackets or line terminators.
    fn emit_list_items(
        &mut self,
        emit: fn(&mut Self, NodeId),
        parent_node: NodeId,
        children: &[NodeId],
        format: ListFormat,
        has_trailing_comma: bool,
        children_text_range: TextRange,
    ) {
        let a = self.a;
        // Write the opening line terminator or leading whitespace.
        let may_emit_intervening_comments = !format.intersects(ListFormat::NO_INTERVENING_COMMENTS);
        let mut should_emit_intervening_comments = may_emit_intervening_comments;

        let mut leading_line_terminator_count = 0;
        if let Some(&first) = children.first() {
            leading_line_terminator_count =
                self.get_leading_line_terminator_count(parent_node, first, format);
        }
        if leading_line_terminator_count > 0 {
            self.write_line_repeat(leading_line_terminator_count);
            should_emit_intervening_comments = false;
        } else if format.intersects(ListFormat::SPACE_BETWEEN_BRACES) {
            self.write_space();
        }

        // Increase the indent, if requested.
        if format.intersects(ListFormat::INDENTED) {
            self.increase_indent();
        }

        let parent_end = greatest_end(a, -1, &[EndOf::Node(parent_node)]);

        // Emit each child.
        let mut previous_sibling = NodeId::NIL;
        let mut should_decrease_indent_after_emit = false;
        for child in children.iter().copied() {
            // Write the delimiter if this is not the first node.
            if format.intersects(ListFormat::ASTERISK_DELIMITED) {
                // always write JSDoc in the format "\n *"
                self.write_line();
                self.write_delimiter(format);
            } else if !previous_sibling.is_nil() {
                // i.e. optionalCall<T>( /*1*/ ) with an empty list: the leading comments of the previous sibling's end are written when they are not the parent's trailing comments.
                if format.intersects(ListFormat::DELIMITERS_MASK)
                    && a.end(previous_sibling) != parent_end
                    && !self.comments_disabled
                    && self.should_emit_trailing_comments(previous_sibling)
                {
                    self.emit_leading_comments(a.end(previous_sibling), false);
                }

                self.write_delimiter(format);

                // Write either a line terminator or whitespace to separate the elements.
                let separating_line_terminator_count =
                    self.get_separating_line_terminator_count(previous_sibling, child, format);
                if separating_line_terminator_count > 0 {
                    // If a synthesized node in a single-line list starts on a new line, we should increase the indent.
                    if (format & (ListFormat::LINES_MASK | ListFormat::INDENTED))
                        == ListFormat::SINGLE_LINE
                    {
                        self.increase_indent();
                        should_decrease_indent_after_emit = true;
                    }

                    if should_emit_intervening_comments
                        && format.intersects(ListFormat::DELIMITERS_MASK)
                        && !position_is_synthesized(a.pos(child))
                        && self.should_emit_leading_comments(child)
                    {
                        let comment_range = self.emit_context.comment_range(a, child);
                        self.emit_trailing_comments_of_position(
                            comment_range.pos(),
                            format.intersects(ListFormat::SPACE_BETWEEN_SIBLINGS),
                            true,
                        );
                    }

                    self.write_line_repeat(separating_line_terminator_count);
                    should_emit_intervening_comments = false;
                } else if format.intersects(ListFormat::SPACE_BETWEEN_SIBLINGS) {
                    self.write_space();
                }
            }

            // Emit this child.
            if should_emit_intervening_comments && self.should_emit_leading_comments(child) {
                let comment_range = self.emit_context.comment_range(a, child);
                self.emit_trailing_comments_of_position(comment_range.pos(), false, false);
            } else {
                should_emit_intervening_comments = may_emit_intervening_comments;
            }

            self.next_list_element_pos = a.pos(child);
            emit(self, child);

            if should_decrease_indent_after_emit {
                self.decrease_indent();
                should_decrease_indent_after_emit = false;
            }

            previous_sibling = child;
        }

        // Write a trailing comma, if requested.
        let skip_trailing_comments =
            self.comments_disabled || !self.should_emit_trailing_comments(previous_sibling);
        let emit_trailing_comma = has_trailing_comma
            && format.intersects(ListFormat::ALLOW_TRAILING_COMMA)
            && format.intersects(ListFormat::COMMA_DELIMITED);
        if emit_trailing_comma {
            if !previous_sibling.is_nil() && !skip_trailing_comments {
                self.emit_token(
                    Kind::CommaToken,
                    a.end(previous_sibling),
                    WriteKind::Punctuation,
                    previous_sibling,
                );
            } else {
                self.write_punctuation(b",");
            }
        }

        // Emit any trailing comment of the last element in the list, i.e. `var array = [..., 2 /* end of element 2 */ ];`.
        if !previous_sibling.is_nil()
            && parent_end != a.end(previous_sibling)
            && format.intersects(ListFormat::DELIMITERS_MASK)
            && !skip_trailing_comments
        {
            let comments_pos = if emit_trailing_comma && children_text_range.end() > 0 {
                children_text_range.end()
            } else {
                a.end(previous_sibling)
            };
            self.emit_leading_comments(comments_pos, false);
        }

        // Decrease the indent, if requested.
        if format.intersects(ListFormat::INDENTED) {
            self.decrease_indent();
        }

        // Write the closing line terminator or closing whitespace.
        let last_child = children.last().copied().unwrap_or(NodeId::NIL);
        let closing_line_terminator_count = self.get_closing_line_terminator_count(
            parent_node,
            last_child,
            format,
            children_text_range,
        );
        if closing_line_terminator_count > 0 {
            self.write_line_repeat(closing_line_terminator_count);
        } else if format.intersects(ListFormat::SPACE_AFTER_LIST | ListFormat::SPACE_BETWEEN_BRACES)
        {
            self.write_space();
        }
    }
}

// Types
impl Printer<'_> {
    fn emit_keyword_type_node(&mut self, node: NodeId) {
        self.emit_keyword_node(node);
    }

    fn emit_type_predicate_parameter_name(&mut self, node: NodeId) {
        match self.a.kind(node) {
            Kind::Identifier => self.emit_identifier_reference(node),
            Kind::ThisType => self.emit_this_type(node),
            _ => self
                .a
                .unhandled("unexpected TypePredicateParameterName", node),
        }
    }

    fn emit_type_predicate(&mut self, node: NodeId) {
        let a = self.a;
        let predicate = a.as_type_predicate_node(node);
        let state = self.enter_node(node);
        if !predicate.asserts_modifier.is_nil() {
            self.emit_token_node(predicate.asserts_modifier);
            self.write_space();
        }
        self.emit_type_predicate_parameter_name(predicate.parameter_name);
        if !a.type_node(node).is_nil() {
            self.write_space();
            self.write_keyword(b"is");
            self.write_space();
            self.emit_type_node_outside_extends(a.type_node(node));
        }
        self.exit_node(node, state);
    }

    fn emit_type_argument(&mut self, node: NodeId) {
        self.emit_type_node_outside_extends(node);
    }

    fn emit_type_arguments(&mut self, parent_node: NodeId, nodes: NodeListId) {
        if nodes.is_nil() {
            return;
        }
        self.emit_list(
            Self::emit_type_parameter_declaration_node,
            parent_node,
            nodes,
            ListFormat::TYPE_ARGUMENTS,
        );
    }

    fn emit_type_reference(&mut self, node: NodeId) {
        let reference = self.a.as_type_reference_node(node);
        let state = self.enter_node(node);
        self.emit_entity_name(reference.type_name);
        self.emit_type_arguments(node, reference.type_arguments);
        self.exit_node(node, state);
    }

    fn emit_return_type(&mut self, node: NodeId) {
        if node.is_nil() {
            return;
        }
        let a = self.a;
        self.write_punctuation(b"=>");
        self.write_space();
        if self.in_extends
            && a.kind(node) == Kind::InferType
            && !a
                .as_type_parameter_declaration(a.as_infer_type_node(node).type_parameter)
                .constraint
                .is_nil()
        {
            // avoid ambiguity with `infer T extends U ?` by parenthesizing the return type
            self.emit_type_node_preserving_extends(node, TypePrecedence::HIGHEST);
        } else {
            self.emit_type_node_preserving_extends(node, TypePrecedence::LOWEST);
        }
    }

    fn emit_function_type(&mut self, node: NodeId) {
        let a = self.a;
        let state = self.enter_node(node);
        let indented = self.should_emit_indented(node);
        self.increase_indent_if(indented);
        self.push_name_generation_scope(node);
        self.emit_type_parameters(node, a.type_parameter_list(node));
        self.emit_parameters(node, a.parameter_list(node));
        self.write_space();
        self.emit_return_type(a.type_node(node));
        self.pop_name_generation_scope(node);
        self.decrease_indent_if(indented);
        self.exit_node(node, state);
    }

    fn emit_constructor_type(&mut self, node: NodeId) {
        let a = self.a;
        let state = self.enter_node(node);
        self.emit_modifier_list(node, a.modifiers(node), false);
        self.write_keyword(b"new");
        self.write_space();
        let indented = self.should_emit_indented(node);
        self.increase_indent_if(indented);
        self.push_name_generation_scope(node);
        self.emit_type_parameters(node, a.type_parameter_list(node));
        self.emit_parameters(node, a.parameter_list(node));
        self.write_space();
        self.emit_return_type(a.type_node(node));
        self.pop_name_generation_scope(node);
        self.decrease_indent_if(indented);
        self.exit_node(node, state);
    }

    fn emit_type_query(&mut self, node: NodeId) {
        let query = self.a.as_type_query_node(node);
        let state = self.enter_node(node);
        self.write_keyword(b"typeof");
        self.write_space();
        self.emit_entity_name(query.expr_name);
        self.emit_type_arguments(node, query.type_arguments);
        self.exit_node(node, state);
    }

    fn emit_type_literal(&mut self, node: NodeId) {
        let members = self.a.as_type_literal_node(node).members;
        let state = self.enter_node(node);
        self.push_name_generation_scope(node);
        self.generate_all_member_names(members);
        self.write_punctuation(b"{");
        let flags = if self.should_emit_on_single_line(node) {
            ListFormat::SINGLE_LINE_TYPE_LITERAL_MEMBERS
        } else {
            ListFormat::MULTI_LINE_TYPE_LITERAL_MEMBERS
        };
        self.emit_list(
            Self::emit_type_element,
            node,
            members,
            flags | ListFormat::NO_SPACE_IF_EMPTY,
        );
        self.write_punctuation(b"}");
        self.pop_name_generation_scope(node);
        self.exit_node(node, state);
    }

    fn emit_array_type(&mut self, node: NodeId) {
        let element_type = self.a.as_array_type_node(node).element_type;
        let state = self.enter_node(node);
        self.emit_postfix_type_operand(element_type, node);
        self.write_punctuation(b"[");
        self.write_punctuation(b"]");
        self.exit_node(node, state);
    }

    fn emit_postfix_type_operand(&mut self, operand: NodeId, parent: NodeId) {
        // A TypeQuery operand of a parsed array or indexed access type is written as parsed: `typeof a[]`.
        if is_parse_tree_node(self.a, parent) && self.a.kind(operand) == Kind::TypeQuery {
            self.emit_type_node(operand, TypePrecedence::TYPE_OPERATOR);
            return;
        }
        self.emit_type_node(operand, TypePrecedence::POSTFIX);
    }

    fn emit_tuple_element_type(&mut self, node: NodeId) {
        self.emit_type_node_outside_extends(node);
    }

    fn emit_tuple_type(&mut self, node: NodeId) {
        let a = self.a;
        let elements = a.as_tuple_type_node(node).elements;
        let state = self.enter_node(node);
        self.emit_token(
            Kind::OpenBracketToken,
            a.pos(node),
            WriteKind::Punctuation,
            node,
        );
        let flags = if self.should_emit_on_single_line(node) {
            ListFormat::SINGLE_LINE_TUPLE_TYPE_ELEMENTS
        } else {
            ListFormat::MULTI_LINE_TUPLE_TYPE_ELEMENTS
        };
        self.emit_list(
            Self::emit_tuple_element_type,
            node,
            elements,
            flags | ListFormat::NO_SPACE_IF_EMPTY,
        );
        self.emit_token(
            Kind::CloseBracketToken,
            a.list_loc(elements).end(),
            WriteKind::Punctuation,
            node,
        );
        self.exit_node(node, state);
    }

    fn emit_rest_type(&mut self, node: NodeId) {
        let state = self.enter_node(node);
        self.write_punctuation(b"...");
        self.emit_type_node_outside_extends(self.a.type_node(node));
        self.exit_node(node, state);
    }

    fn emit_optional_type(&mut self, node: NodeId) {
        let state = self.enter_node(node);
        self.emit_postfix_type_operand(self.a.type_node(node), node);
        self.write_punctuation(b"?");
        self.exit_node(node, state);
    }

    fn emit_named_tuple_member(&mut self, node: NodeId) {
        let a = self.a;
        let member = a.as_named_tuple_member(node);
        let state = self.enter_node(node);
        self.emit_punctuation_node(member.dot_dot_dot_token);
        self.emit_identifier_name(a.name(node));
        self.emit_punctuation_node(member.question_token);
        let colon_pos = greatest_end(
            a,
            a.end(a.name(node)),
            &[EndOf::Node(member.question_token)],
        );
        self.emit_token(Kind::ColonToken, colon_pos, WriteKind::Punctuation, node);
        self.write_space();
        self.emit_type_node_outside_extends(a.type_node(node));
        self.exit_node(node, state);
    }

    fn emit_union_type_constituent(&mut self, node: NodeId) {
        self.emit_type_node(node, TypePrecedence::TYPE_OPERATOR);
    }

    fn emit_union_type(&mut self, node: NodeId) {
        let types = self.a.as_union_type_node(node).types;
        let state = self.enter_node(node);
        self.emit_list(
            Self::emit_union_type_constituent,
            node,
            types,
            ListFormat::UNION_TYPE_CONSTITUENTS,
        );
        self.exit_node(node, state);
    }

    fn emit_intersection_type_constituent(&mut self, node: NodeId) {
        self.emit_type_node(node, TypePrecedence::TYPE_OPERATOR);
    }

    fn emit_intersection_type(&mut self, node: NodeId) {
        let types = self.a.as_intersection_type_node(node).types;
        let state = self.enter_node(node);
        self.emit_list(
            Self::emit_intersection_type_constituent,
            node,
            types,
            ListFormat::INTERSECTION_TYPE_CONSTITUENTS,
        );
        self.exit_node(node, state);
    }

    fn emit_conditional_type(&mut self, node: NodeId) {
        let conditional = self.a.as_conditional_type_node(node);
        let state = self.enter_node(node);
        self.emit_type_node(conditional.check_type, TypePrecedence::UNION);
        self.write_space();
        self.write_keyword(b"extends");
        self.write_space();
        self.emit_type_node_in_extends(conditional.extends_type);
        self.write_space();
        self.write_punctuation(b"?");
        self.write_space();
        self.emit_type_node_outside_extends(conditional.true_type);
        self.write_space();
        self.write_punctuation(b":");
        self.write_space();
        self.emit_type_node_outside_extends(conditional.false_type);
        self.exit_node(node, state);
    }

    fn emit_infer_type_parameter(&mut self, node: NodeId) {
        let a = self.a;
        let constraint = a.as_type_parameter_declaration(node).constraint;
        let state = self.enter_node(node);
        self.emit_binding_identifier(a.name(node));
        if !constraint.is_nil() {
            self.write_space();
            self.write_keyword(b"extends");
            self.write_space();
            self.emit_type_node_in_extends(constraint);
        }
        self.exit_node(node, state);
    }

    fn emit_infer_type(&mut self, node: NodeId) {
        let type_parameter = self.a.as_infer_type_node(node).type_parameter;
        let state = self.enter_node(node);
        self.write_keyword(b"infer");
        self.write_space();
        self.emit_infer_type_parameter(type_parameter);
        self.exit_node(node, state);
    }

    fn emit_parenthesized_type(&mut self, node: NodeId) {
        let state = self.enter_node(node);
        self.write_punctuation(b"(");
        self.emit_type_node_outside_extends(self.a.type_node(node));
        self.write_punctuation(b")");
        self.exit_node(node, state);
    }

    fn emit_this_type(&mut self, node: NodeId) {
        let state = self.enter_node(node);
        self.write_keyword(b"this");
        self.exit_node(node, state);
    }

    fn emit_type_operator(&mut self, node: NodeId) {
        let a = self.a;
        let operator = a.as_type_operator_node(node).operator;
        let state = self.enter_node(node);
        self.emit_token(operator, a.pos(node), WriteKind::Keyword, node);
        self.write_space();
        let precedence = if operator == Kind::ReadonlyKeyword {
            TypePrecedence::POSTFIX
        } else {
            TypePrecedence::TYPE_OPERATOR
        };
        self.emit_type_node(a.type_node(node), precedence);
        self.exit_node(node, state);
    }

    fn emit_indexed_access_type(&mut self, node: NodeId) {
        let indexed_access = self.a.as_indexed_access_type_node(node);
        let state = self.enter_node(node);
        self.emit_postfix_type_operand(indexed_access.object_type, node);
        self.write_punctuation(b"[");
        self.emit_type_node_outside_extends(indexed_access.index_type);
        self.write_punctuation(b"]");
        self.exit_node(node, state);
    }

    fn emit_mapped_type_parameter(&mut self, node: NodeId) {
        let a = self.a;
        let constraint = a.as_type_parameter_declaration(node).constraint;
        let state = self.enter_node(node);
        self.emit_binding_identifier(a.name(node));
        self.write_space();
        self.write_keyword(b"in");
        self.write_space();
        self.emit_type_node_outside_extends(constraint);
        self.exit_node(node, state);
    }

    fn emit_mapped_type(&mut self, node: NodeId) {
        let a = self.a;
        let mapped = a.as_mapped_type_node(node);
        let state = self.enter_node(node);
        let single_line = self.should_emit_on_single_line(node);
        self.write_punctuation(b"{");
        if single_line {
            self.write_space();
        } else {
            self.write_line();
            self.increase_indent();
        }
        if !mapped.readonly_token.is_nil() {
            self.emit_token_node(mapped.readonly_token);
            if a.kind(mapped.readonly_token) != Kind::ReadonlyKeyword {
                self.write_keyword(b"readonly");
            }
            self.write_space();
        }
        self.write_punctuation(b"[");
        self.emit_mapped_type_parameter(mapped.type_parameter);
        if !mapped.name_type.is_nil() {
            self.write_space();
            self.write_keyword(b"as");
            self.write_space();
            self.emit_type_node_outside_extends(mapped.name_type);
        }
        self.write_punctuation(b"]");
        if !mapped.question_token.is_nil() {
            self.emit_punctuation_node(mapped.question_token);
            if a.kind(mapped.question_token) != Kind::QuestionToken {
                self.write_punctuation(b"?");
            }
        }
        self.write_punctuation(b":");
        self.write_space();
        self.emit_type_node_outside_extends(a.type_node(node));
        self.write_trailing_semicolon();
        if !mapped.members.is_nil() && !a.nodes(mapped.members).as_slice().is_empty() {
            if single_line {
                self.write_space();
            } else {
                self.write_line();
            }
            self.emit_list(
                Self::emit_type_element,
                node,
                mapped.members,
                ListFormat::PRESERVE_LINES,
            );
        }
        if single_line {
            self.write_space();
        } else {
            self.write_line();
            self.decrease_indent();
        }
        self.write_punctuation(b"}");
        self.exit_node(node, state);
    }

    fn emit_literal_type(&mut self, node: NodeId) {
        let literal = self.a.as_literal_type_node(node).literal;
        let state = self.enter_node(node);
        self.emit_expression(literal, OperatorPrecedence::COMMA);
        self.exit_node(node, state);
    }

    fn emit_template_type_span(&mut self, node: NodeId) {
        let a = self.a;
        let literal = a.as_template_literal_type_span(node).literal;
        let state = self.enter_node(node);
        self.emit_type_node_outside_extends(a.type_node(node));
        self.emit_template_middle_tail(literal);
        self.exit_node(node, state);
    }

    fn emit_template_type_span_node(&mut self, node: NodeId) {
        self.emit_template_type_span(node);
    }

    fn emit_template_type(&mut self, node: NodeId) {
        let template = self.a.as_template_literal_type_node(node);
        let state = self.enter_node(node);
        self.emit_template_head(template.head);
        self.emit_list(
            Self::emit_template_type_span_node,
            node,
            template.template_spans,
            ListFormat::TEMPLATE_EXPRESSION_SPANS,
        );
        self.exit_node(node, state);
    }

    fn emit_import_type_node_attributes(&mut self, node: NodeId) {
        let attributes = self.a.as_import_attributes(node);
        let state = self.enter_node(node);
        self.write_punctuation(b"{");
        self.write_space();
        self.write_keyword(if attributes.token == Kind::AssertKeyword {
            b"assert"
        } else {
            b"with"
        });
        self.write_punctuation(b":");
        self.write_space();
        self.emit_list(
            Self::emit_import_attribute_node,
            node,
            attributes.attributes,
            ListFormat::IMPORT_ATTRIBUTES,
        );
        self.write_space();
        self.write_punctuation(b"}");
        self.exit_node(node, state);
    }

    fn emit_import_type_node(&mut self, node: NodeId) {
        let import_type = self.a.as_import_type_node(node);
        let state = self.enter_node(node);
        if import_type.is_type_of {
            self.write_keyword(b"typeof");
            self.write_space();
        }
        self.write_keyword(b"import");
        self.write_punctuation(b"(");
        self.emit_type_node_outside_extends(import_type.argument);
        if !import_type.attributes.is_nil() {
            self.write_punctuation(b",");
            self.write_space();
            self.emit_import_type_node_attributes(import_type.attributes);
        }
        self.write_punctuation(b")");
        if !import_type.qualifier.is_nil() {
            self.write_punctuation(b".");
            self.emit_entity_name(import_type.qualifier);
        }
        self.emit_type_arguments(node, self.a.type_argument_list(node));
        self.exit_node(node, state);
    }

    // emits a Type node in the `extends` clause of a ConditionalType or InferType
    fn emit_type_node_in_extends(&mut self, node: NodeId) {
        let saved_in_extends = self.in_extends;
        self.in_extends = true;
        self.emit_type_node_preserving_extends(node, TypePrecedence::LOWEST);
        self.in_extends = saved_in_extends;
    }

    // emits a Type node not in the `extends` clause of a ConditionalType or InferType
    fn emit_type_node_outside_extends(&mut self, node: NodeId) {
        let saved_in_extends = self.in_extends;
        self.in_extends = false;
        self.emit_type_node_preserving_extends(node, TypePrecedence::LOWEST);
        self.in_extends = saved_in_extends;
    }

    // emits a Type node preserving whether or not we are currently in the `extends` clause of a ConditionalType or InferType
    fn emit_type_node_preserving_extends(&mut self, node: NodeId, precedence: TypePrecedence) {
        self.emit_type_node(node, precedence);
    }

    fn emit_type_node(&mut self, node: NodeId, precedence: TypePrecedence) {
        let a = self.a;
        // A nil type node ends here: upstream dereferences it.
        if node.is_nil() {
            return a.unhandled("nil TypeNode", node);
        }
        if !bun_core::StackCheck::init().is_safe_to_recurse() {
            return a.unhandled("stack limit reached", node);
        }
        let mut precedence = precedence;
        if self.in_extends && precedence <= TypePrecedence::CONDITIONAL {
            // in the `extends` clause of a ConditionalType or InferType, a ConditionalType must be parenthesized
            precedence = TypePrecedence::FUNCTION;
        }

        let saved_in_extends = self.in_extends;
        let parens = get_type_node_precedence(a, node) < precedence;
        if parens {
            self.in_extends = false;
            self.write_punctuation(b"(");
        }

        match a.kind(node) {
            // Keyword types
            Kind::AnyKeyword
            | Kind::UnknownKeyword
            | Kind::NumberKeyword
            | Kind::BigIntKeyword
            | Kind::ObjectKeyword
            | Kind::BooleanKeyword
            | Kind::StringKeyword
            | Kind::SymbolKeyword
            | Kind::VoidKeyword
            | Kind::UndefinedKeyword
            | Kind::NeverKeyword
            | Kind::IntrinsicKeyword => self.emit_keyword_type_node(node),
            Kind::TypePredicate => self.emit_type_predicate(node),
            Kind::TypeReference => self.emit_type_reference(node),
            Kind::FunctionType => self.emit_function_type(node),
            Kind::ConstructorType => self.emit_constructor_type(node),
            Kind::TypeQuery => self.emit_type_query(node),
            Kind::TypeLiteral => self.emit_type_literal(node),
            Kind::ArrayType => self.emit_array_type(node),
            Kind::TupleType => self.emit_tuple_type(node),
            Kind::OptionalType => self.emit_optional_type(node),
            Kind::RestType => self.emit_rest_type(node),
            Kind::UnionType => self.emit_union_type(node),
            Kind::IntersectionType => self.emit_intersection_type(node),
            Kind::ConditionalType => self.emit_conditional_type(node),
            Kind::InferType => self.emit_infer_type(node),
            Kind::ParenthesizedType => self.emit_parenthesized_type(node),
            Kind::ThisType => self.emit_this_type(node),
            Kind::TypeOperator => self.emit_type_operator(node),
            Kind::IndexedAccessType => self.emit_indexed_access_type(node),
            Kind::MappedType => self.emit_mapped_type(node),
            Kind::LiteralType => self.emit_literal_type(node),
            Kind::NamedTupleMember => self.emit_named_tuple_member(node),
            Kind::TemplateLiteralType => self.emit_template_type(node),
            Kind::TemplateLiteralTypeSpan => self.emit_template_type_span(node),
            Kind::ImportType => self.emit_import_type_node(node),
            Kind::PropertyAccessExpression => self.emit_property_access_expression(node),
            Kind::ExpressionWithTypeArguments => self.emit_expression_with_type_arguments(node),
            Kind::JSDocAllType
            | Kind::JSDocNonNullableType
            | Kind::JSDocNullableType
            | Kind::JSDocOptionalType
            | Kind::JSDocVariadicType => a.unhandled("Printer.emitJSDocType", node),
            _ => a.unhandled("unhandled TypeNode", node),
        }

        if parens {
            self.write_punctuation(b")");
        }
        self.in_extends = saved_in_extends;
    }

    // Binding patterns

    fn emit_object_binding_pattern(&mut self, node: NodeId) {
        let elements = self.a.element_list(node);
        let state = self.enter_node(node);
        self.write_punctuation(b"{");
        self.emit_list(
            Self::emit_binding_element_node,
            node,
            elements,
            ListFormat::OBJECT_BINDING_PATTERN_ELEMENTS,
        );
        self.write_punctuation(b"}");
        self.exit_node(node, state);
    }

    fn emit_array_binding_pattern(&mut self, node: NodeId) {
        let elements = self.a.element_list(node);
        let state = self.enter_node(node);
        self.write_punctuation(b"[");
        self.emit_list(
            Self::emit_binding_element_node,
            node,
            elements,
            ListFormat::ARRAY_BINDING_PATTERN_ELEMENTS,
        );
        self.write_punctuation(b"]");
        self.exit_node(node, state);
    }

    fn emit_binding_element(&mut self, node: NodeId) {
        let a = self.a;
        let element = a.as_binding_element(node);
        let state = self.enter_node(node);
        self.emit_token_node(element.dot_dot_dot_token);
        if !element.property_name.is_nil() {
            self.emit_property_name(element.property_name);
            self.write_punctuation(b":");
            self.write_space();
        }
        // Old parse tree could have a nil name in a binding element after a transformation.
        let name = a.name(node);
        if !name.is_nil() {
            self.emit_binding_name(name);
            self.emit_initializer(a.initializer(node), a.end(name), node);
        }
        self.exit_node(node, state);
    }

    fn emit_binding_element_node(&mut self, node: NodeId) {
        self.emit_binding_element(node);
    }
}

// Expressions, as far as a type node or an entity name holds them
impl Printer<'_> {
    fn emit_keyword_expression(&mut self, node: NodeId) {
        self.emit_keyword_node(node);
    }

    // 1..toString is a valid property access, emit a dot after the literal
    fn may_need_dot_dot_for_property_access(&mut self, expression: NodeId) -> bool {
        let a = self.a;
        let expression = skip_partially_emitted_expressions(a, expression);
        if is_numeric_literal(a, expression) {
            // check if numeric literal is a decimal literal that was originally written with a dot
            let text = self.get_literal_text_of_node(
                expression,
                NodeId::NIL,
                GetLiteralTextFlags::NEVER_ASCII_ESCAPE,
            );
            // If the number will be printed verbatim and it doesn't already contain a dot or an exponent indicator, add another dot to mimic the original.
            return !a
                .as_numeric_literal(expression)
                .token_flags
                .intersects(TokenFlags::WITH_SPECIFIER)
                && !bun_core::strings::contains(&text, token_to_string(Kind::DotToken))
                && !bun_core::strings::contains_char(&text, b'E')
                && !bun_core::strings::contains_char(&text, b'e');
        }
        false
    }

    fn emit_property_access_expression(&mut self, node: NodeId) {
        let a = self.a;
        let access = a.as_property_access_expression(node);
        let name = a.name(node);
        let state = self.enter_node(node);
        self.emit_expression(
            access.expression,
            if is_optional_chain(a, node) {
                OperatorPrecedence::OPTIONAL_CHAIN
            } else {
                OperatorPrecedence::MEMBER
            },
        );
        let mut token = access.question_dot_token;
        if token.is_nil() {
            token = crate::printer::factory::new_node_factory(a, self.emit_context)
                .new_token(Kind::DotToken);
            a.set_loc(token, new_text_range(a.end(access.expression), a.pos(name)));
            self.emit_context
                .add_emit_flags(token, EmitFlags::NO_SOURCE_MAP);
        }
        let lines_before_dot = self.get_lines_between_nodes(node, access.expression, token);
        self.write_line_repeat(lines_before_dot);
        self.increase_indent_if(lines_before_dot > 0);

        let should_emit_dot_dot = a.kind(token) != Kind::QuestionDotToken
            && self.may_need_dot_dot_for_property_access(access.expression)
            && !self.w().has_trailing_comment()
            && !self.w().has_trailing_whitespace();
        if should_emit_dot_dot {
            self.write_punctuation(b".");
        }

        if !access.question_dot_token.is_nil() {
            self.emit_token_node(token);
        } else {
            self.emit_token(
                Kind::DotToken,
                a.end(access.expression),
                WriteKind::Punctuation,
                node,
            );
        }

        let lines_after_dot = self.get_lines_between_nodes(node, token, name);
        self.write_line_repeat(lines_after_dot);
        self.increase_indent_if(lines_after_dot > 0);

        self.emit_member_name(name);
        self.decrease_indent_if(lines_after_dot > 0);
        self.decrease_indent_if(lines_before_dot > 0);
        self.exit_node(node, state);
    }

    fn emit_element_access_expression(&mut self, node: NodeId) {
        let a = self.a;
        let access = a.as_element_access_expression(node);
        let state = self.enter_node(node);
        self.emit_expression(
            access.expression,
            if is_optional_chain(a, node) {
                OperatorPrecedence::OPTIONAL_CHAIN
            } else {
                OperatorPrecedence::MEMBER
            },
        );
        self.emit_token_node(access.question_dot_token);
        let open_pos = greatest_end(
            a,
            -1,
            &[
                EndOf::Node(access.expression),
                EndOf::Node(access.question_dot_token),
            ],
        );
        self.emit_token(
            Kind::OpenBracketToken,
            open_pos,
            WriteKind::Punctuation,
            node,
        );
        self.emit_expression(access.argument_expression, OperatorPrecedence::COMMA);
        self.emit_token(
            Kind::CloseBracketToken,
            a.end(access.argument_expression),
            WriteKind::Punctuation,
            node,
        );
        self.exit_node(node, state);
    }

    fn emit_prefix_unary_expression(&mut self, node: NodeId) {
        let a = self.a;
        let unary = a.as_prefix_unary_expression(node);
        let state = self.enter_node(node);
        let operator = unary.operator;
        let operand = unary.operand;
        self.emit_token(operator, a.pos(node), WriteKind::Operator, node);

        // A space separates the operator from a nested plus or minus expression: without it `+(+1)` and `+(++1)` would read as an increment.
        if a.kind(operand) == Kind::PrefixUnaryExpression {
            let inner = a.as_prefix_unary_expression(operand).operator;
            if (operator == Kind::PlusToken
                && (inner == Kind::PlusToken || inner == Kind::PlusPlusToken))
                || (operator == Kind::MinusToken
                    && (inner == Kind::MinusToken || inner == Kind::MinusMinusToken))
            {
                self.write_space();
            }
        }

        self.emit_expression(operand, OperatorPrecedence::UNARY);
        self.exit_node(node, state);
    }

    fn emit_omitted_expression(&mut self, node: NodeId) {
        let state = self.enter_node(node);
        self.exit_node(node, state);
    }

    fn emit_expression_with_type_arguments(&mut self, node: NodeId) {
        let expression = self.a.as_expression_with_type_arguments(node);
        let state = self.enter_node(node);
        self.emit_expression(expression.expression, OperatorPrecedence::MEMBER);
        self.emit_type_arguments(node, expression.type_arguments);
        self.exit_node(node, state);
    }

    fn emit_expression(&mut self, node: NodeId, precedence: OperatorPrecedence) {
        let a = self.a;
        // A nil expression ends here: upstream dereferences it.
        if node.is_nil() {
            return a.unhandled("nil Expression", node);
        }
        if !bun_core::StackCheck::init().is_safe_to_recurse() {
            return a.unhandled("stack limit reached", node);
        }
        let parens =
            get_expression_precedence(a, skip_partially_emitted_expressions(a, node)) < precedence;
        if parens {
            self.write_punctuation(b"(");
        }

        match a.kind(node) {
            // Keywords
            Kind::TrueKeyword | Kind::FalseKeyword | Kind::NullKeyword => {
                self.emit_token_node(node)
            }
            Kind::ThisKeyword | Kind::SuperKeyword | Kind::ImportKeyword => {
                self.emit_keyword_expression(node);
            }
            // Literals
            Kind::NumericLiteral => self.emit_numeric_literal(node),
            Kind::BigIntLiteral => self.emit_big_int_literal(node),
            Kind::StringLiteral => self.emit_string_literal(node),
            Kind::NoSubstitutionTemplateLiteral => self.emit_no_substitution_template_literal(node),
            // Identifiers
            Kind::Identifier => self.emit_identifier_reference(node),
            Kind::PrivateIdentifier => self.emit_private_identifier(node),
            // Expressions
            Kind::PropertyAccessExpression => self.emit_property_access_expression(node),
            Kind::ElementAccessExpression => self.emit_element_access_expression(node),
            Kind::PrefixUnaryExpression => self.emit_prefix_unary_expression(node),
            Kind::OmittedExpression => self.emit_omitted_expression(node),
            Kind::ExpressionWithTypeArguments => self.emit_expression_with_type_arguments(node),
            Kind::MissingDeclaration => {}
            Kind::NotEmittedStatement => return,
            Kind::SyntheticExpression => {
                a.unhandled::<()>("SyntheticExpression should never be printed.", node);
            }
            Kind::SyntaxList => a.unhandled::<()>("SyntaxList should not be printed", node),
            Kind::SyntheticReferenceExpression => {
                a.unhandled::<()>("SyntheticReferenceExpression should not be printed", node);
            }
            // The expressions that only a statement or a declaration holds are not ported: a type node never has one.
            Kind::RegularExpressionLiteral
            | Kind::ArrayLiteralExpression
            | Kind::ObjectLiteralExpression
            | Kind::CallExpression
            | Kind::NewExpression
            | Kind::TaggedTemplateExpression
            | Kind::TypeAssertionExpression
            | Kind::ParenthesizedExpression
            | Kind::FunctionExpression
            | Kind::ArrowFunction
            | Kind::DeleteExpression
            | Kind::TypeOfExpression
            | Kind::VoidExpression
            | Kind::AwaitExpression
            | Kind::PostfixUnaryExpression
            | Kind::BinaryExpression
            | Kind::ConditionalExpression
            | Kind::TemplateExpression
            | Kind::YieldExpression
            | Kind::SpreadElement
            | Kind::ClassExpression
            | Kind::AsExpression
            | Kind::NonNullExpression
            | Kind::SatisfiesExpression
            | Kind::MetaProperty
            | Kind::JsxElement
            | Kind::JsxSelfClosingElement
            | Kind::JsxFragment
            | Kind::PartiallyEmittedExpression => a.unhandled::<()>("Printer.emitExpression", node),
            _ => a.unhandled::<()>("unexpected Expression", node),
        }

        if parens {
            self.write_punctuation(b")");
        }
    }

    fn emit_not_emitted_type_element(&mut self, node: NodeId) {
        let state = self.enter_node(node);
        self.exit_node(node, state);
    }

    fn emit_import_attribute(&mut self, node: NodeId) {
        let a = self.a;
        let value = a.as_import_attribute(node).value;
        let state = self.enter_node(node);
        self.emit_import_attribute_name(a.name(node));
        self.write_punctuation(b":");
        self.write_space();

        // "comment1" is not considered to be leading comment for node.initializer but rather a trailing comment on the previous node.
        if !self
            .emit_context
            .emit_flags(value)
            .intersects(EmitFlags::NO_LEADING_COMMENTS)
        {
            let comment_range = self.emit_context.comment_range(a, value);
            self.emit_trailing_comments(comment_range.pos(), CommentSeparator::After);
        }
        self.emit_expression(value, OperatorPrecedence::DISALLOW_COMMA);
        self.exit_node(node, state);
    }

    fn emit_import_attribute_node(&mut self, node: NodeId) {
        self.emit_import_attribute(node);
    }
}

// Entry points
impl<'p> Printer<'p> {
    fn set_source_file(&mut self, source_file: NodeId) {
        self.current_source_file = source_file;
        self.external_helpers_module_name = NodeId::NIL;
        if !source_file.is_nil() {
            // `uniqueHelperNames` is made here upstream when the file has external helpers: helper names are not ported.
            self.external_helpers_module_name = self
                .emit_context
                .get_external_helpers_module_name(self.a, source_file);
            self.set_source_map_source(source_file);
        }
    }

    // Printer.Write. `sourceMapGenerator` has no parameter: source maps are not part of the port.
    pub fn write_exported(
        &mut self,
        node: NodeId,
        source_file: NodeId,
        writer: &'p mut (dyn EmitTextWriter + 'p),
    ) {
        let a = self.a;
        let saved_current_source_file = self.current_source_file;
        let saved_writer = self.writer.take();
        let saved_source_maps_disabled = self.source_maps_disabled;

        self.source_maps_disabled = true;

        self.set_source_file(source_file);
        let mut writer: Box<dyn EmitTextWriter + 'p> = Box::new(writer);
        if self.options.omit_trailing_semicolon {
            writer = get_trailing_semicolon_deferring_writer(writer);
        }
        self.writer = Some(writer);
        self.w().clear();

        // A nil node ends here: upstream dereferences it.
        if node.is_nil() {
            a.unhandled::<()>("nil node in Printer.Write", node);
        } else {
            self.write_node(node);
        }

        // Teardown
        self.current_source_file = saved_current_source_file;
        self.writer = saved_writer;
        self.source_maps_disabled = saved_source_maps_disabled;
    }

    // The switch of Printer.Write over the kind of the node.
    fn write_node(&mut self, node: NodeId) {
        let a = self.a;
        let kind = a.kind(node);
        match kind {
            // Pseudo-literals
            Kind::TemplateHead => self.emit_template_head(node),
            Kind::TemplateMiddle => self.emit_template_middle(node),
            Kind::TemplateTail => self.emit_template_tail(node),
            // Identifiers
            Kind::Identifier => self.emit_identifier_name(node),
            // PrivateIdentifiers
            Kind::PrivateIdentifier => self.emit_private_identifier(node),
            // Names
            Kind::QualifiedName => self.emit_qualified_name(node),
            Kind::ComputedPropertyName => self.emit_computed_property_name(node),
            // Signature elements
            Kind::TypeParameter => self.emit_type_parameter(node),
            Kind::Parameter => self.emit_parameter(node),
            // Type members
            Kind::PropertySignature => self.emit_property_signature(node),
            Kind::MethodSignature => self.emit_method_signature(node),
            Kind::GetAccessor => self.emit_get_accessor_declaration(node),
            Kind::SetAccessor => self.emit_set_accessor_declaration(node),
            Kind::CallSignature => self.emit_call_signature(node),
            Kind::ConstructSignature => self.emit_construct_signature(node),
            Kind::IndexSignature => self.emit_index_signature(node),
            // Binding patterns
            Kind::ObjectBindingPattern => self.emit_object_binding_pattern(node),
            Kind::ArrayBindingPattern => self.emit_array_binding_pattern(node),
            Kind::BindingElement => self.emit_binding_element(node),
            // Transformation nodes
            Kind::NotEmittedTypeElement => self.emit_not_emitted_type_element(node),
            // Declarations, clauses, property assignments, enum members and source files are not ported: the checker never prints one.
            Kind::Decorator
            | Kind::PropertyDeclaration
            | Kind::MethodDeclaration
            | Kind::ClassStaticBlockDeclaration
            | Kind::Constructor
            | Kind::CatchClause
            | Kind::PropertyAssignment
            | Kind::ShorthandPropertyAssignment
            | Kind::SpreadAssignment
            | Kind::EnumMember
            | Kind::SourceFile => a.unhandled("Printer.Write: declaration", node),
            _ => {
                if is_type_node(a, node) {
                    self.emit_type_node_outside_extends(node);
                } else if is_statement(a, node) {
                    a.unhandled::<()>("Printer.emitStatement", node);
                } else if is_expression(a, node) {
                    self.emit_expression(node, OperatorPrecedence::LOWEST);
                } else if is_keyword_kind(kind) {
                    self.emit_keyword_node(node);
                } else if is_punctuation_kind(kind) {
                    self.emit_punctuation_node(node);
                } else if is_jsdoc_kind(kind) {
                    a.unhandled::<()>("Printer.emitJSDocNode", node);
                } else {
                    a.unhandled::<()>("unhandled Node", node);
                }
            }
        }
    }
}
