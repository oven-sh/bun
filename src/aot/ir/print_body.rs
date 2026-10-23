#[cfg(test)]
mod tests;

use std::fmt::Write;

use super::body::{BlockView, Body, TargetView, TerminatorView, ValueView};
use super::generated::{BlockFrequency, BlockRole, print_terminator_fields, print_value_fields};
use super::ids::{Id, ValueId};
use super::print::Printer;

pub(super) fn print_body(printer: &mut Printer<'_>, body: &Body) {
    if body.block_count == 0 {
        return;
    }
    printer.out.push_str(" {\n");
    if body.check_stream().is_ok() {
        for block in body.blocks() {
            print_block(printer, block);
        }
    } else {
        let _ = writeln!(printer.out, "  <invalid body {}>", body.code.len());
    }
    printer.out.push('}');
}

#[allow(clippy::large_types_passed_by_value)] // made for this call
fn print_block(printer: &mut Printer<'_>, block: BlockView<'_>) {
    let _ = write!(printer.out, "  {}(", block.id);
    printer.print_separated(
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
    printer.out.push(')');
    if block.role != BlockRole::default() {
        let _ = write!(printer.out, " role={}", block.role.name());
    }
    if let Some(subject) = block.subject {
        let _ = write!(printer.out, " subject={subject}");
    }
    if block.frequency != BlockFrequency::default() {
        let _ = write!(printer.out, " frequency={}", block.frequency.name());
    }
    if let Some(handler) = block.handler() {
        printer.out.push_str(" handler=");
        print_target(printer, handler);
    }
    printer.out.push_str(":\n");
    for value in block.values() {
        print_value(printer, value);
    }
    print_terminator(printer, block.terminator());
}

fn print_value(printer: &mut Printer<'_>, value: ValueView<'_>) {
    printer.out.push_str("    ");
    if value.opcode.has_result() {
        let _ = write!(printer.out, "{} = ", value.id);
    }
    printer.out.push_str(value.opcode.name());
    print_value_fields(value.opcode, value.fields, printer);
    print_position(printer, value.position);
    printer.out.push('\n');
}

fn print_terminator(printer: &mut Printer<'_>, terminator: TerminatorView<'_>) {
    let kind = terminator.kind;
    let _ = write!(printer.out, "    {}", kind.name());
    print_terminator_fields(kind, terminator.fields, printer);
    let target_count = terminator.target_count();
    if target_count > 0 {
        printer.out.push_str(" -> ");
        printer.print_separated(
            terminator.targets().enumerate(),
            |printer, (index, target)| {
                let name = kind.target_name(index, target_count);
                printer.out.push_str(name.unwrap_or("<invalid target>"));
                printer.out.push(' ');
                print_target(printer, target);
            },
        );
    }
    print_position(printer, terminator.position);
    printer.out.push('\n');
}

fn print_target(printer: &mut Printer<'_>, target: TargetView<'_>) {
    let _ = write!(printer.out, "{}(", target.block);
    printer.print_separated(target.arguments(), |printer, argument| {
        let _ = write!(printer.out, "{argument}");
    });
    if !target.proofs.is_empty() {
        let has_arguments = target.arguments().next().is_some();
        printer
            .out
            .push_str(if has_arguments { " | " } else { "| " });
        printer.print_separated(target.proofs, |printer, proof| {
            let _ = write!(printer.out, "{proof}");
        });
    }
    printer.out.push(')');
}

fn print_position(printer: &mut Printer<'_>, position: Option<u32>) {
    if let Some(position) = position {
        let _ = write!(printer.out, " @{position}");
    }
}
