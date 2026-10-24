#[cfg(test)]
mod tests;

use std::fmt::Write;

use super::body::{BlockView, Body, TargetView, TerminatorView, ValueView};
use super::generated::{BlockFrequency, BlockRole, print_terminator_fields, print_value_fields};
use super::ids::{Id, ValueId};
use super::print::Printer;

impl Printer<'_> {
    pub fn print_body(&mut self, body: &Body) {
        if body.block_count == 0 {
            return;
        }
        self.out.push_str(" {\n");
        if body.check_stream().is_ok() {
            for block in body.blocks() {
                self.print_block(block);
            }
        } else {
            let _ = writeln!(self.out, "  <invalid body {}>", body.code.len());
        }
        self.out.push('}');
    }

    #[allow(clippy::large_types_passed_by_value)] // made for this call
    fn print_block(&mut self, block: BlockView<'_>) {
        let _ = write!(self.out, "  {}(", block.id);
        self.print_separated(
            block.parameter_types().enumerate(),
            |printer, (index, ty)| {
                let value = ValueId::new(block.first_parameter.index() + index);
                let _ = write!(printer.out, "{value}");
                if let Some(ty) = ty {
                    printer.out.push_str(": ");
                    printer.print_type(ty);
                }
            },
        );
        self.out.push(')');
        if block.role != BlockRole::default() {
            let _ = write!(self.out, " role={}", block.role.name());
        }
        if let Some(subject) = block.subject {
            let _ = write!(self.out, " subject={subject}");
        }
        if block.frequency != BlockFrequency::default() {
            let _ = write!(self.out, " frequency={}", block.frequency.name());
        }
        if let Some(handler) = block.handler() {
            self.out.push_str(" handler=");
            self.print_target(handler);
        }
        self.out.push_str(":\n");
        for value in block.values() {
            self.print_value(value);
        }
        self.print_terminator(block.terminator());
    }

    fn print_value(&mut self, value: ValueView<'_>) {
        self.out.push_str("    ");
        if value.opcode.has_result() {
            let _ = write!(self.out, "{} = ", value.id);
        }
        self.out.push_str(value.opcode.name());
        print_value_fields(value.opcode, value.fields, self);
        self.print_position(value.position);
        self.out.push('\n');
    }

    fn print_terminator(&mut self, terminator: TerminatorView<'_>) {
        let kind = terminator.kind;
        let _ = write!(self.out, "    {}", kind.name());
        print_terminator_fields(kind, terminator.fields, self);
        let target_count = terminator.target_count();
        if target_count > 0 {
            self.out.push_str(" -> ");
            self.print_separated(
                terminator.targets().enumerate(),
                |printer, (index, target)| {
                    let name = kind.target_name(index, target_count);
                    printer.out.push_str(name.unwrap_or("<invalid target>"));
                    printer.out.push(' ');
                    printer.print_target(target);
                },
            );
        }
        self.print_position(terminator.position);
        self.out.push('\n');
    }

    fn print_target(&mut self, target: TargetView<'_>) {
        let _ = write!(self.out, "{}(", target.block);
        self.print_separated(target.arguments(), |printer, argument| {
            let _ = write!(printer.out, "{argument}");
        });
        if !target.proofs.is_empty() {
            let has_arguments = target.arguments().next().is_some();
            self.out.push_str(if has_arguments { " | " } else { "| " });
            self.print_separated(target.proofs, |printer, proof| {
                let _ = write!(printer.out, "{proof}");
            });
        }
        self.out.push(')');
    }

    fn print_position(&mut self, position: Option<u32>) {
        if let Some(position) = position {
            let _ = write!(self.out, " @{position}");
        }
    }
}
