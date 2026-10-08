//! Prettier's `language-html/print/angular-*.js`.

use super::ast::{Flags, Id, Kind};
use super::cursor::Target;
use super::printer::Printer;
use crate::css::text;

/// `ANGULAR_CONTROL_FLOW_BLOCK_SETTINGS.get(name)?.has(next)`
fn can_follow(name: &[u8], next: &[u8]) -> bool {
    match name {
        b"if" | b"else if" => matches!(next, b"else if" | b"else"),
        b"for" => next == b"empty",
        b"defer" | b"placeholder" | b"error" | b"loading" => {
            matches!(next, b"placeholder" | b"error" | b"loading")
        }
        b"boundary" => next == b"error",
        _ => false,
    }
}

impl Printer<'_, '_, '_, '_, '_> {
    /// `shouldCloseBlock`
    fn should_close_block(&self, id: Id) -> bool {
        !self.tree.next_of(id).is_some_and(|next| {
            next.kind == Kind::AngularControlFlowBlock
                && can_follow(&self.tree[id].name, &next.name)
        })
    }

    pub(crate) fn print_angular_control_flow_block(&mut self, id: Id) {
        let node = &self.tree[id];
        let is_default_never = &node.name[..] == b"default never";
        if !is_default_never {
            self.out.start_group_with(true, None);
        }
        // `isPreviousBlockUnClosed`
        if self.tree.prev(id).is_some_and(|previous| {
            self.tree[previous].kind == Kind::AngularControlFlowBlock
                && !self.tree.has_prettier_ignore(previous)
                && !self.should_close_block(previous)
        }) {
            self.out.token("} ");
        }
        self.out.token("@");
        self.out.text(&node.name);
        if let Some(parameters) = self.tree.parameters(id) {
            self.out.token(if is_default_never { "(" } else { " (" });
            self.out.start_group();
            self.with_ancestor(|printer| {
                printer.with_cursor_marks(Target::Node(parameters), |printer| {
                    printer.print_angular_control_flow_block_parameters_or_embed(id, parameters);
                });
            });
            self.out.end_group();
            self.out.token(")");
        }
        if is_default_never {
            return self.out.token(";");
        }
        // `isSwitchFallthroughCase`
        let is_fallthrough = matches!(&node.name[..], b"case" | b"default")
            && node.end_span().is_some_and(|span| span.start == span.end);
        if !is_fallthrough {
            self.out.token(" {");
            let should_print_close_bracket = self.should_close_block(id);
            if self.tree.has_children(id) {
                self.out.start_indent();
                self.out.hardline();
                self.print_children(id);
                self.out.end_indent();
                if should_print_close_bracket {
                    self.out.hardline();
                    self.out.token("}");
                }
            } else if should_print_close_bracket {
                self.out.token("}");
            }
        }
        self.out.end_group();
    }

    fn print_angular_control_flow_block_parameters_or_embed(&mut self, block: Id, parameters: Id) {
        if self.formats_embedded()
            && self.embed_angular_control_flow_block_parameters(block, parameters)
        {
            return;
        }
        self.print_angular_control_flow_block_parameters(parameters);
    }

    pub(crate) fn print_angular_control_flow_block_parameters(&mut self, id: Id) {
        self.out.start_indent();
        self.out.softline();
        for (index, parameter) in self.tree.children(id).enumerate() {
            if index > 0 {
                self.out.token(";");
                self.out.line();
            }
            // One string to Prettier, with the line breaks in it.
            let expression = super::utilities::html_trim(&self.tree[parameter].value);
            self.with_cursor_marks(Target::Node(parameter), |printer| {
                printer.out.string(expression);
            });
        }
        self.out.end_indent();
        self.out.softline();
    }

    pub(crate) fn print_angular_let_declaration(&mut self, id: Id) {
        let node = &self.tree[id];
        self.out.start_group();
        self.out.token("@let ");
        self.out.start_group();
        self.out.text(&node.name);
        self.out.token(" =");
        self.out.start_group();
        self.out.start_indent();
        self.out.line();
        self.with_cursor_marks(Target::LetInitializer(id), |printer| {
            if !(printer.formats_embedded()
                && printer.embed_angular_let_declaration_initializer(id))
            {
                printer.out.string(&node.value);
            }
        });
        self.out.end_indent();
        self.out.end_group();
        self.out.end_group();
        self.out.token(";");
        self.out.end_group();
    }

    pub(crate) fn print_angular_icu_expression(&mut self, id: Id) {
        let (tags, node) = (self.tags(), &self.tree[id]);
        self.out.built_text(|out| tags.opening_tag_start(id, out));
        let group_id = self.out.new_group_id();
        self.out.start_group_with(false, Some(group_id));
        self.out.string(text::trim(&node.value));
        self.out.token(", ");
        self.out.string(&node.name);
        if self.tree.has_children(id) {
            self.out.token(",");
            self.out.start_indent();
            self.out.line();
            self.with_ancestor(|printer| {
                for (index, case) in printer.tree.children(id).enumerate() {
                    if index > 0 {
                        printer.out.line();
                    }
                    printer.with_cursor_marks(Target::Node(case), |printer| {
                        printer.print_angular_icu_case(case)
                    });
                }
            });
            self.out.end_indent();
        }
        self.out.softline();
        self.out.end_group();
        self.out.note_line_at_end_of_group(group_id);
        self.out.built_text(|out| tags.closing_tag_end(id, out));
    }

    pub(crate) fn print_angular_icu_case(&mut self, id: Id) {
        self.out.string(&self.tree[id].value);
        self.out.token(" {");
        self.out.start_group();
        self.out.start_indent();
        self.out.softline();
        self.with_ancestor(|printer| {
            for child in printer.tree.children(id) {
                let node = &printer.tree[child];
                let is_text = node.kind == Kind::Text;
                if is_text && node.has(Flags::HAS_LEADING_SPACES) {
                    printer.out.line();
                }
                printer.print_node(child);
                if is_text
                    && node.has(Flags::HAS_TRAILING_SPACES)
                    && printer.tree.next(child).is_some()
                {
                    printer.out.line();
                }
            }
        });
        self.out.end_indent();
        self.out.softline();
        self.out.end_group();
        self.out.token("}");
    }
}
