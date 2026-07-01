// Copyright (c) Meta Platforms, Inc. and affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Verbose debug printer for ReactiveFunction.
//!
//! Produces output identical to the TS `printDebugReactiveFunction`.
//! Delegates shared formatting (Places, Identifiers, Scopes, Types,
//! InstructionValues, Effects, Errors) to `crate::hir::print::PrintFormatter`.

use core::fmt;

use crate::hir::environment::Environment;
use crate::hir::print::PrintFormatter;
use crate::hir::{
    HirFunction, ParamPattern, ReactiveBlock, ReactiveFunction, ReactiveInstruction,
    ReactiveStatement, ReactiveTerminal, ReactiveTerminalStatement, ReactiveValue, SourceLocation,
};

/// Zero-allocation `Display` adapter for `Option<SourceLocation>`, producing
/// the same output as `hir::print::format_loc` without the intermediate `String`.
struct Loc<'a>(&'a Option<SourceLocation>);

impl fmt::Display for Loc<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.0 {
            Some(l) => write!(
                f,
                "{}:{}-{}:{}",
                l.start.line, l.start.column, l.end.line, l.end.column
            ),
            None => f.write_str("generated"),
        }
    }
}

pub struct DebugPrinter<'a> {
    pub fmt: PrintFormatter<'a>,
    /// Optional formatter for HIR functions (used for inner functions in FunctionExpression/ObjectMethod)
    pub hir_formatter: Option<&'a HirFunctionFormatter>,
}

impl<'a> DebugPrinter<'a> {
    pub fn new(env: &'a Environment) -> Self {
        Self {
            fmt: PrintFormatter::new(env),
            hir_formatter: None,
        }
    }

    /// Write a single indented line built from `args` directly into the
    /// formatter's output buffer, avoiding the temporary `String` that
    /// `self.fmt.line(&format!(..))` would allocate.
    fn line_fmt(&mut self, args: core::fmt::Arguments<'_>) {
        self.fmt.line_fmt(args);
    }

    pub fn format_reactive_function(&mut self, func: &ReactiveFunction) {
        self.fmt.indent();
        match &func.id {
            Some(id) => self.line_fmt(format_args!("id: \"{}\"", id)),
            None => self.fmt.line("id: null"),
        }
        match &func.name_hint {
            Some(h) => self.line_fmt(format_args!("name_hint: \"{}\"", h)),
            None => self.fmt.line("name_hint: null"),
        }
        self.line_fmt(format_args!("generator: {}", func.generator));
        self.line_fmt(format_args!("is_async: {}", func.is_async));
        self.line_fmt(format_args!("loc: {}", Loc(&func.loc)));

        // params
        self.fmt.line("params:");
        self.fmt.indent();
        for (i, param) in func.params.iter().enumerate() {
            match param {
                ParamPattern::Place(place) => {
                    self.fmt.format_place_field(&format!("[{}]", i), place);
                }
                ParamPattern::Spread(spread) => {
                    self.line_fmt(format_args!("[{}] Spread:", i));
                    self.fmt.indent();
                    self.fmt.format_place_field("place", &spread.place);
                    self.fmt.dedent();
                }
            }
        }
        self.fmt.dedent();

        // directives
        self.fmt.line("directives:");
        self.fmt.indent();
        for (i, d) in func.directives.iter().enumerate() {
            self.line_fmt(format_args!("[{}] \"{}\"", i, d));
        }
        self.fmt.dedent();

        self.fmt.line("");
        self.fmt.line("Body:");
        self.fmt.indent();
        self.format_reactive_block(&func.body);
        self.fmt.dedent();
        self.fmt.dedent();
    }

    fn format_reactive_block(&mut self, block: &ReactiveBlock) {
        for stmt in block.iter() {
            self.format_reactive_statement(stmt);
        }
    }

    fn format_reactive_statement(&mut self, stmt: &ReactiveStatement) {
        match stmt {
            ReactiveStatement::Instruction(instr) => {
                self.format_reactive_instruction_block(instr);
            }
            ReactiveStatement::Terminal(term) => {
                self.fmt.line("ReactiveTerminalStatement {");
                self.fmt.indent();
                self.format_terminal_statement(term);
                self.fmt.dedent();
                self.fmt.line("}");
            }
            ReactiveStatement::Scope(scope) => {
                self.fmt.line("ReactiveScopeBlock {");
                self.fmt.indent();
                self.fmt.format_scope_field("scope", scope.scope);
                self.fmt.line("instructions:");
                self.fmt.indent();
                self.format_reactive_block(&scope.instructions);
                self.fmt.dedent();
                self.fmt.dedent();
                self.fmt.line("}");
            }
            ReactiveStatement::PrunedScope(scope) => {
                self.fmt.line("PrunedReactiveScopeBlock {");
                self.fmt.indent();
                self.fmt.format_scope_field("scope", scope.scope);
                self.fmt.line("instructions:");
                self.fmt.indent();
                self.format_reactive_block(&scope.instructions);
                self.fmt.dedent();
                self.fmt.dedent();
                self.fmt.line("}");
            }
        }
    }

    fn format_reactive_instruction_block(&mut self, instr: &ReactiveInstruction) {
        self.fmt.line("ReactiveInstruction {");
        self.fmt.indent();
        self.format_reactive_instruction(instr);
        self.fmt.dedent();
        self.fmt.line("}");
    }

    fn format_reactive_instruction(&mut self, instr: &ReactiveInstruction) {
        self.line_fmt(format_args!("id: {}", instr.id.0));
        match &instr.lvalue {
            Some(place) => self.fmt.format_place_field("lvalue", place),
            None => self.fmt.line("lvalue: null"),
        }
        self.fmt.line("value:");
        self.fmt.indent();
        self.format_reactive_value(&instr.value);
        self.fmt.dedent();
        match &instr.effects {
            Some(effects) => {
                self.fmt.line("effects:");
                self.fmt.indent();
                for (i, eff) in effects.iter().enumerate() {
                    self.line_fmt(format_args!("[{}] {}", i, self.fmt.format_effect(eff)));
                }
                self.fmt.dedent();
            }
            None => self.fmt.line("effects: null"),
        }
        self.line_fmt(format_args!("loc: {}", Loc(&instr.loc)));
    }

    fn format_reactive_value(&mut self, value: &ReactiveValue) {
        match value {
            ReactiveValue::Instruction(iv) => {
                // Build the inner function formatter callback if we have an hir_formatter
                let hir_formatter = self.hir_formatter;
                let inner_func_cb: Option<Box<dyn Fn(&mut PrintFormatter, &HirFunction) + '_>> =
                    hir_formatter.map(|hf| {
                        Box::new(move |fmt: &mut PrintFormatter, func: &HirFunction| {
                            hf(fmt, func);
                        })
                            as Box<dyn Fn(&mut PrintFormatter, &HirFunction) + '_>
                    });
                self.fmt.format_instruction_value(
                    iv,
                    inner_func_cb
                        .as_ref()
                        .map(|cb| cb.as_ref() as &dyn Fn(&mut PrintFormatter, &HirFunction)),
                );
            }
            ReactiveValue::LogicalExpression {
                operator,
                left,
                right,
                loc,
            } => {
                self.fmt.line("LogicalExpression {");
                self.fmt.indent();
                self.line_fmt(format_args!("operator: \"{}\"", operator));
                self.fmt.line("left:");
                self.fmt.indent();
                self.format_reactive_value(left);
                self.fmt.dedent();
                self.fmt.line("right:");
                self.fmt.indent();
                self.format_reactive_value(right);
                self.fmt.dedent();
                self.line_fmt(format_args!("loc: {}", Loc(loc)));
                self.fmt.dedent();
                self.fmt.line("}");
            }
            ReactiveValue::ConditionalExpression {
                test,
                consequent,
                alternate,
                loc,
            } => {
                self.fmt.line("ConditionalExpression {");
                self.fmt.indent();
                self.fmt.line("test:");
                self.fmt.indent();
                self.format_reactive_value(test);
                self.fmt.dedent();
                self.fmt.line("consequent:");
                self.fmt.indent();
                self.format_reactive_value(consequent);
                self.fmt.dedent();
                self.fmt.line("alternate:");
                self.fmt.indent();
                self.format_reactive_value(alternate);
                self.fmt.dedent();
                self.line_fmt(format_args!("loc: {}", Loc(loc)));
                self.fmt.dedent();
                self.fmt.line("}");
            }
            ReactiveValue::SequenceExpression {
                instructions,
                id,
                value,
                loc,
            } => {
                self.fmt.line("SequenceExpression {");
                self.fmt.indent();
                self.fmt.line("instructions:");
                self.fmt.indent();
                for (i, instr) in instructions.iter().enumerate() {
                    self.line_fmt(format_args!("[{}]:", i));
                    self.fmt.indent();
                    self.format_reactive_instruction_block(instr);
                    self.fmt.dedent();
                }
                self.fmt.dedent();
                self.line_fmt(format_args!("id: {}", id.0));
                self.fmt.line("value:");
                self.fmt.indent();
                self.format_reactive_value(value);
                self.fmt.dedent();
                self.line_fmt(format_args!("loc: {}", Loc(loc)));
                self.fmt.dedent();
                self.fmt.line("}");
            }
            ReactiveValue::OptionalExpression {
                id,
                value,
                optional,
                loc,
            } => {
                self.fmt.line("OptionalExpression {");
                self.fmt.indent();
                self.line_fmt(format_args!("id: {}", id.0));
                self.fmt.line("value:");
                self.fmt.indent();
                self.format_reactive_value(value);
                self.fmt.dedent();
                self.line_fmt(format_args!("optional: {}", optional));
                self.line_fmt(format_args!("loc: {}", Loc(loc)));
                self.fmt.dedent();
                self.fmt.line("}");
            }
        }
    }

    fn format_terminal_statement(&mut self, stmt: &ReactiveTerminalStatement) {
        match &stmt.label {
            Some(label) => {
                self.line_fmt(format_args!(
                    "label: {{ id: bb{}, implicit: {} }}",
                    label.id.0, label.implicit
                ));
            }
            None => self.fmt.line("label: null"),
        }
        self.fmt.line("terminal:");
        self.fmt.indent();
        self.format_reactive_terminal(&stmt.terminal);
        self.fmt.dedent();
    }

    fn format_reactive_terminal(&mut self, terminal: &ReactiveTerminal) {
        match terminal {
            ReactiveTerminal::Break {
                target,
                id,
                target_kind,
                loc,
            } => {
                self.fmt.line("Break {");
                self.fmt.indent();
                self.line_fmt(format_args!("target: bb{}", target.0));
                self.line_fmt(format_args!("id: {}", id.0));
                self.line_fmt(format_args!("targetKind: \"{}\"", target_kind));
                self.line_fmt(format_args!("loc: {}", Loc(loc)));
                self.fmt.dedent();
                self.fmt.line("}");
            }
            ReactiveTerminal::Continue {
                target,
                id,
                target_kind,
                loc,
            } => {
                self.fmt.line("Continue {");
                self.fmt.indent();
                self.line_fmt(format_args!("target: bb{}", target.0));
                self.line_fmt(format_args!("id: {}", id.0));
                self.line_fmt(format_args!("targetKind: \"{}\"", target_kind));
                self.line_fmt(format_args!("loc: {}", Loc(loc)));
                self.fmt.dedent();
                self.fmt.line("}");
            }
            ReactiveTerminal::Return { value, id, loc } => {
                self.fmt.line("Return {");
                self.fmt.indent();
                self.fmt.format_place_field("value", value);
                self.line_fmt(format_args!("id: {}", id.0));
                self.line_fmt(format_args!("loc: {}", Loc(loc)));
                self.fmt.dedent();
                self.fmt.line("}");
            }
            ReactiveTerminal::Throw { value, id, loc } => {
                self.fmt.line("Throw {");
                self.fmt.indent();
                self.fmt.format_place_field("value", value);
                self.line_fmt(format_args!("id: {}", id.0));
                self.line_fmt(format_args!("loc: {}", Loc(loc)));
                self.fmt.dedent();
                self.fmt.line("}");
            }
            ReactiveTerminal::Switch {
                test,
                cases,
                id,
                loc,
            } => {
                self.fmt.line("Switch {");
                self.fmt.indent();
                self.fmt.format_place_field("test", test);
                self.fmt.line("cases:");
                self.fmt.indent();
                for (i, case) in cases.iter().enumerate() {
                    self.line_fmt(format_args!("[{}] {{", i));
                    self.fmt.indent();
                    match &case.test {
                        Some(p) => {
                            self.fmt.format_place_field("test", p);
                        }
                        None => {
                            self.fmt.line("test: null");
                        }
                    }
                    match &case.block {
                        Some(block) => {
                            self.fmt.line("block:");
                            self.fmt.indent();
                            self.format_reactive_block(block);
                            self.fmt.dedent();
                        }
                        None => self.fmt.line("block: undefined"),
                    }
                    self.fmt.dedent();
                    self.fmt.line("}");
                }
                self.fmt.dedent();
                self.line_fmt(format_args!("id: {}", id.0));
                self.line_fmt(format_args!("loc: {}", Loc(loc)));
                self.fmt.dedent();
                self.fmt.line("}");
            }
            ReactiveTerminal::DoWhile {
                loop_block,
                test,
                id,
                loc,
            } => {
                self.fmt.line("DoWhile {");
                self.fmt.indent();
                self.fmt.line("loop:");
                self.fmt.indent();
                self.format_reactive_block(loop_block);
                self.fmt.dedent();
                self.fmt.line("test:");
                self.fmt.indent();
                self.format_reactive_value(test);
                self.fmt.dedent();
                self.line_fmt(format_args!("id: {}", id.0));
                self.line_fmt(format_args!("loc: {}", Loc(loc)));
                self.fmt.dedent();
                self.fmt.line("}");
            }
            ReactiveTerminal::While {
                test,
                loop_block,
                id,
                loc,
            } => {
                self.fmt.line("While {");
                self.fmt.indent();
                self.fmt.line("test:");
                self.fmt.indent();
                self.format_reactive_value(test);
                self.fmt.dedent();
                self.fmt.line("loop:");
                self.fmt.indent();
                self.format_reactive_block(loop_block);
                self.fmt.dedent();
                self.line_fmt(format_args!("id: {}", id.0));
                self.line_fmt(format_args!("loc: {}", Loc(loc)));
                self.fmt.dedent();
                self.fmt.line("}");
            }
            ReactiveTerminal::For {
                init,
                test,
                update,
                loop_block,
                id,
                loc,
            } => {
                self.fmt.line("For {");
                self.fmt.indent();
                self.fmt.line("init:");
                self.fmt.indent();
                self.format_reactive_value(init);
                self.fmt.dedent();
                self.fmt.line("test:");
                self.fmt.indent();
                self.format_reactive_value(test);
                self.fmt.dedent();
                match update {
                    Some(u) => {
                        self.fmt.line("update:");
                        self.fmt.indent();
                        self.format_reactive_value(u);
                        self.fmt.dedent();
                    }
                    None => self.fmt.line("update: null"),
                }
                self.fmt.line("loop:");
                self.fmt.indent();
                self.format_reactive_block(loop_block);
                self.fmt.dedent();
                self.line_fmt(format_args!("id: {}", id.0));
                self.line_fmt(format_args!("loc: {}", Loc(loc)));
                self.fmt.dedent();
                self.fmt.line("}");
            }
            ReactiveTerminal::ForOf {
                init,
                test,
                loop_block,
                id,
                loc,
            } => {
                self.fmt.line("ForOf {");
                self.fmt.indent();
                self.fmt.line("init:");
                self.fmt.indent();
                self.format_reactive_value(init);
                self.fmt.dedent();
                self.fmt.line("test:");
                self.fmt.indent();
                self.format_reactive_value(test);
                self.fmt.dedent();
                self.fmt.line("loop:");
                self.fmt.indent();
                self.format_reactive_block(loop_block);
                self.fmt.dedent();
                self.line_fmt(format_args!("id: {}", id.0));
                self.line_fmt(format_args!("loc: {}", Loc(loc)));
                self.fmt.dedent();
                self.fmt.line("}");
            }
            ReactiveTerminal::ForIn {
                init,
                loop_block,
                id,
                loc,
            } => {
                self.fmt.line("ForIn {");
                self.fmt.indent();
                self.fmt.line("init:");
                self.fmt.indent();
                self.format_reactive_value(init);
                self.fmt.dedent();
                self.fmt.line("loop:");
                self.fmt.indent();
                self.format_reactive_block(loop_block);
                self.fmt.dedent();
                self.line_fmt(format_args!("id: {}", id.0));
                self.line_fmt(format_args!("loc: {}", Loc(loc)));
                self.fmt.dedent();
                self.fmt.line("}");
            }
            ReactiveTerminal::If {
                test,
                consequent,
                alternate,
                id,
                loc,
            } => {
                self.fmt.line("If {");
                self.fmt.indent();
                self.fmt.format_place_field("test", test);
                self.fmt.line("consequent:");
                self.fmt.indent();
                self.format_reactive_block(consequent);
                self.fmt.dedent();
                match alternate {
                    Some(alt) => {
                        self.fmt.line("alternate:");
                        self.fmt.indent();
                        self.format_reactive_block(alt);
                        self.fmt.dedent();
                    }
                    None => self.fmt.line("alternate: null"),
                }
                self.line_fmt(format_args!("id: {}", id.0));
                self.line_fmt(format_args!("loc: {}", Loc(loc)));
                self.fmt.dedent();
                self.fmt.line("}");
            }
            ReactiveTerminal::Label { block, id, loc } => {
                self.fmt.line("Label {");
                self.fmt.indent();
                self.fmt.line("block:");
                self.fmt.indent();
                self.format_reactive_block(block);
                self.fmt.dedent();
                self.line_fmt(format_args!("id: {}", id.0));
                self.line_fmt(format_args!("loc: {}", Loc(loc)));
                self.fmt.dedent();
                self.fmt.line("}");
            }
            ReactiveTerminal::Try {
                block,
                handler_binding,
                handler,
                id,
                loc,
            } => {
                self.fmt.line("Try {");
                self.fmt.indent();
                self.fmt.line("block:");
                self.fmt.indent();
                self.format_reactive_block(block);
                self.fmt.dedent();
                match handler_binding {
                    Some(p) => self.fmt.format_place_field("handlerBinding", p),
                    None => self.fmt.line("handlerBinding: null"),
                }
                self.fmt.line("handler:");
                self.fmt.indent();
                self.format_reactive_block(handler);
                self.fmt.dedent();
                self.line_fmt(format_args!("id: {}", id.0));
                self.line_fmt(format_args!("loc: {}", Loc(loc)));
                self.fmt.dedent();
                self.fmt.line("}");
            }
        }
    }
}

/// Type alias for a function formatter callback that can print HIR functions.
/// Used to format inner functions in FunctionExpression/ObjectMethod values.
pub type HirFunctionFormatter = dyn Fn(&mut PrintFormatter, &HirFunction);

pub fn debug_reactive_function(func: &ReactiveFunction, env: &Environment) -> String {
    debug_reactive_function_with_formatter(func, env, None)
}

pub fn debug_reactive_function_with_formatter(
    func: &ReactiveFunction,
    env: &Environment,
    hir_formatter: Option<&HirFunctionFormatter>,
) -> String {
    let mut printer = DebugPrinter::new(env);
    printer.hir_formatter = hir_formatter;
    printer.format_reactive_function(func);

    // TODO: Print outlined functions when they've been converted to reactive form

    printer.fmt.line("");
    printer.fmt.line("Environment:");
    printer.fmt.indent();
    printer.fmt.format_errors(&env.errors);
    printer.fmt.dedent();

    printer.fmt.to_string_output()
}
