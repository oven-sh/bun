//! The program as text, for people and for comparing with what the engine says it has read: `Program::dump` there prints the same.

use crate::declared::Part;
use crate::format::{Opcode, end_of, record};
use crate::id::{FuncId, StrId, TyId, V};
use crate::ir::{LayoutKind, Literal, Prediction, Program, Target, Term, Why, class_flags, method_flags, only_function_flags};
use std::fmt::Write;

impl Program {
    fn quoted(&self, out: &mut String, s: StrId) {
        if s.is_none() {
            out.push('-');
            return;
        }
        out.push('"');
        for &byte in self.strs.get(s) {
            if byte < 0x20 || byte >= 0x7f || byte == b'"' || byte == b'\\' {
                let _ = write!(out, "\\x{byte:02x}");
            } else {
                out.push(byte as char);
            }
        }
        out.push('"');
    }

    pub fn dump(&self) -> String {
        let mut out = String::new();
        let o = &mut out;
        let index = |o: &mut String, value: u32| {
            if value == u32::MAX {
                o.push('-');
            } else {
                let _ = write!(o, "{value}");
            }
        };
        let only_function = |o: &mut String, func: FuncId, flags: u8| {
            if func.is_some() {
                let _ = write!(o, " only f{}{}", func.0, if flags & only_function_flags::IS_FACT != 0 { " fact" } else { "" });
            }
        };
        let ty = |o: &mut String, t: TyId| {
            if t.is_none() {
                o.push('-');
            } else {
                let _ = write!(o, "#{}", t.0);
            }
        };
        let prediction = |o: &mut String, prediction: Prediction| match prediction {
            Prediction::None => {}
            Prediction::Ty(ty) | Prediction::Field(ty) => {
                let _ = write!(o, " ~#{}", ty.0);
            }
            Prediction::Closure(func) => {
                let _ = write!(o, " ~f{}", func.0);
            }
            Prediction::ByKey(property) => {
                o.push_str(" ~[");
                self.quoted(o, property);
                o.push(']');
            }
        };
        let list = |o: &mut String, args: &[V]| {
            o.push('(');
            for (i, v) in args.iter().enumerate() {
                let _ = write!(o, "{}v{}", if i == 0 { "" } else { ", " }, v.0);
            }
            o.push(')');
        };
        let target = |o: &mut String, t: &Target| {
            let _ = write!(o, "b{}", t.block.0);
            list(o, &t.args);
        };
        for (i, declared) in self.tys.list.iter().enumerate() {
            let _ = write!(o, "type #{i}:");
            for (bit, name) in ["undefined", "null", "false", "true", "number", "string", "symbol", "bigint"].iter().enumerate() {
                if declared.prims & (1 << bit) != 0 {
                    let _ = write!(o, " {name}");
                }
            }
            if let Some((least, most)) = declared.ints {
                let _ = write!(o, " integers {least}..{most}");
            }
            for part in &declared.parts {
                let arguments: &[TyId] = match part {
                    Part::Class(shape) => {
                        let _ = write!(o, " class {}", shape.0);
                        &[]
                    }
                    Part::Global(name, args) => {
                        o.push_str(" global ");
                        self.quoted(o, *name);
                        args
                    }
                    Part::Array(element) => {
                        o.push_str(" array");
                        std::slice::from_ref(element)
                    }
                };
                if !arguments.is_empty() {
                    o.push('<');
                    for (i, &argument) in arguments.iter().enumerate() {
                        if i != 0 {
                            o.push_str(", ");
                        }
                        ty(o, argument);
                    }
                    o.push('>');
                }
            }
            if declared.any_object {
                o.push_str(" object");
            }
            if declared.any_function {
                o.push_str(" function");
            }
            o.push('\n');
        }
        for (i, layout) in self.layouts.iter().enumerate() {
            let _ = write!(o, "shape {i} {:?} ", layout.kind);
            self.quoted(o, layout.name);
            o.push_str(" base ");
            index(o, layout.base.0);
            if layout.declared_path.is_some() {
                o.push_str(" declared ");
                self.quoted(o, layout.declared_path);
                let _ = write!(o, ":{}", layout.declared_line);
            }
            if layout.kind == LayoutKind::Instance {
                o.push_str(" constructor ");
                index(o, layout.constructor.0);
                o.push_str(" environment ");
                index(o, layout.environment.0);
                for (flag, what) in [
                    (class_flags::IS_LAID_OUT, " laid out"),
                    (class_flags::IS_EVALUATED_ONCE, " evaluated once"),
                    (class_flags::HAS_FOREIGN_ROOT, " foreign root"),
                    (class_flags::HAS_FIXED_MEMBERS, " fixed members"),
                    (class_flags::MAY_HAVE_OTHER_PROTOTYPE, " other prototypes"),
                    (class_flags::HAS_STATIC_MEMBER_OF_UNKNOWN_NAME, " unknown static names"),
                ] {
                    if layout.class_flags & flag != 0 {
                        o.push_str(what);
                    }
                }
            }
            if layout.kind != LayoutKind::Instance && layout.class_flags & class_flags::MAY_HAVE_OTHER_PROTOTYPE != 0 {
                o.push_str(" other prototypes");
            }
            if layout.is_allocated {
                o.push_str(" allocated");
            }
            if layout.may_be_frozen {
                o.push_str(" frozen");
            }
            if layout.admits_foreign {
                o.push_str(" foreign");
            }
            o.push('\n');
            for (what, layouts) in [("members", &layout.members), ("specializations", &layout.specializations)] {
                if !layouts.is_empty() {
                    let _ = write!(o, "  {what}");
                    for other in layouts {
                        let _ = write!(o, " {}", other.0);
                    }
                    o.push('\n');
                }
            }
            for field in &layout.fields {
                o.push_str("  field ");
                self.quoted(o, field.name);
                o.push(' ');
                ty(o, field.declared);
                let _ = write!(o, " flags {}", field.flags);
                for literal in &field.literals {
                    o.push(' ');
                    match *literal {
                        Literal::Str(text) => self.quoted(o, text),
                        Literal::Num(value) => {
                            let _ = write!(o, "0x{:016x}", value.to_bits());
                        }
                    }
                }
                if field.type_text.is_some() {
                    o.push_str(" type ");
                    self.quoted(o, field.type_text);
                }
                only_function(o, field.only_function, field.only_function_flags);
                o.push('\n');
            }
            for (side, what) in [(0, "  method "), (method_flags::STATIC, "  static method ")] {
                for method in layout.methods.iter().filter(|method| method.flags & method_flags::STATIC == side) {
                    o.push_str(what);
                    if method.name.is_some() {
                        self.quoted(o, method.name);
                    } else {
                        let _ = write!(o, "[variable {}]", method.key);
                    }
                    let _ = writeln!(o, " {:?} f{}{}", method.kind, method.func.0, if method.flags & method_flags::MAY_BE_REPLACED != 0 { " replaced" } else { "" });
                }
            }
            for &(name, variable) in &layout.static_fields {
                o.push_str("  static field ");
                self.quoted(o, name);
                let annotated = if variable & crate::ir::STATIC_FIELD_IS_ANNOTATED != 0 { " annotated" } else { "" };
                let _ = writeln!(o, " variable {}{annotated}", variable & !crate::ir::STATIC_FIELD_IS_ANNOTATED);
            }
        }
        for (i, global) in self.globals.iter().enumerate() {
            let _ = write!(o, "variable {i} ");
            self.quoted(o, global.name);
            o.push_str(" module ");
            index(o, global.module.0);
            o.push(' ');
            ty(o, global.declared);
            o.push_str(match global.initialization {
                crate::ir::Initialization::Uninitialized => "",
                crate::ir::Initialization::Undefined => " undefined",
                crate::ir::Initialization::NeverSeen => " never seen uninitialized",
                crate::ir::Initialization::NeverSeenAndStoredOnce => " never seen uninitialized, stored once",
            });
            only_function(o, global.only_function, global.only_function_flags);
            o.push('\n');
        }
        for (i, module) in self.modules.iter().enumerate() {
            let _ = write!(o, "module {i} ");
            self.quoted(o, module.path);
            let _ = write!(o, " f{} ", module.init.0);
            self.quoted(o, module.display_path);
            let _ = writeln!(o, " line table {} bytes", module.line_table.len());
        }
        if !self.prototype_property_names.is_empty() {
            o.push_str("prototype property names");
            for &name in &self.prototype_property_names {
                o.push(' ');
                self.quoted(o, name);
            }
            o.push('\n');
        }
        for &(id, func) in &self.builtin_modules {
            let _ = writeln!(o, "builtin module {id} f{}", func.0);
        }
        for &(id, func, visibility) in &self.builtin_functions {
            let _ = writeln!(o, "builtin function {id} f{} visibility {visibility}", func.0);
        }
        for &(property, key, func) in &self.functions_by_key {
            o.push_str("by key ");
            self.quoted(o, property);
            o.push(' ');
            self.quoted(o, key);
            let _ = writeln!(o, " f{}", func.0);
        }
        for entry in &self.entries {
            let _ = writeln!(o, "entry f{}", entry.0);
        }
        for (i, func) in self.funcs.iter().enumerate() {
            let _ = write!(o, "function {i} ");
            self.quoted(o, func.name);
            let _ = write!(o, " {:?} flags {} module ", func.kind, func.flags);
            index(o, func.module.0);
            o.push_str(" captures (");
            for (i, &capture) in func.captures.iter().enumerate() {
                if i > 0 {
                    o.push_str(", ");
                }
                ty(o, capture);
            }
            o.push_str(") this ");
            ty(o, func.this_declared);
            o.push_str(" (");
            for (i, &param) in func.params.iter().enumerate() {
                if i != 0 {
                    o.push_str(", ");
                }
                ty(o, param);
                if func.why_of_param(i) == Why::Cast {
                    o.push_str(" annotated");
                }
            }
            o.push_str(") result ");
            ty(o, func.result);
            o.push('\n');
            for (b, block) in func.blocks.iter().enumerate() {
                let _ = write!(o, "  b{b}(");
                for (i, &param) in block.params.iter().enumerate() {
                    let _ = write!(o, "{}v{}: ", if i == 0 { "" } else { ", " }, param.0);
                    ty(o, func.ty(param));
                    prediction(o, func.prediction(param));
                }
                o.push_str("):\n");
                for &v in &block.ops {
                    let r = record(&func.values[v.idx()].def);
                    let _ = write!(o, "    v{}: ", v.0);
                    ty(o, func.ty(v));
                    prediction(o, func.prediction(v));
                    let _ = write!(o, " = {:?}", r.opcode);
                    let mut is_first = true;
                    for child in r.children {
                        if child.is_some() {
                            let _ = write!(o, "{}v{}", if is_first { " " } else { ", " }, child.0);
                            is_first = false;
                        }
                    }
                    let bits = (r.immediates[1] as u64) << 32 | r.immediates[0] as u64;
                    match r.opcode {
                        Opcode::Boolean => o.push_str(if r.immediates[0] != 0 { " true" } else { " false" }),
                        Opcode::Integer => {
                            let _ = write!(o, " {}", bits as i64);
                        }
                        Opcode::Double => {
                            let _ = write!(o, " 0x{bits:016x}");
                        }
                        Opcode::String
                        | Opcode::BigInt
                        | Opcode::GetGlobal
                        | Opcode::GetGlobalForTypeOf
                        | Opcode::PutGlobal
                        | Opcode::GetById
                        | Opcode::PutById
                        | Opcode::InById
                        | Opcode::DeleteById
                        | Opcode::CallMethod
                        | Opcode::Operation => {
                            o.push(' ');
                            self.quoted(o, StrId(r.immediates[0]));
                        }
                        Opcode::FunctionReference | Opcode::NewClosure | Opcode::CallDirect => {
                            let _ = write!(o, " f{}", r.immediates[0]);
                        }
                        Opcode::NewClosureOnce => {
                            let _ = write!(o, " field {} f{}", r.immediates[1], r.immediates[0]);
                        }
                        Opcode::GetModuleVariable | Opcode::PutModuleVariable => {
                            let _ = write!(o, " variable {}", r.immediates[0]);
                        }
                        Opcode::NewObjectWithShape | Opcode::IsInstanceOfClass => {
                            let _ = write!(o, " shape {}", r.immediates[0]);
                            if r.opcode == Opcode::NewObjectWithShape && StrId(r.immediates[1]).is_some() {
                                o.push_str(" with ");
                                self.quoted(o, StrId(r.immediates[1]));
                            }
                        }
                        Opcode::GetField | Opcode::PutField => {
                            let _ = write!(o, " shape {} field {}", r.immediates[0], r.immediates[1]);
                        }
                        Opcode::Cast => {
                            let _ = write!(o, " {}", ["Store", "As", "NonNull", "Claim", "Flow", "Upcast", "Coerce"][r.immediates[1] as usize]);
                            // What it tries for. For any other reason that is the type of the value.
                            if r.immediates[1] == 6 {
                                o.push(' ');
                                ty(o, TyId(r.immediates[0]));
                            }
                            // The text of what is asserted.
                            if r.immediates[1] == 2 && StrId(r.immediates[0]).is_some() {
                                o.push(' ');
                                self.quoted(o, StrId(r.immediates[0]));
                            }
                        }
                        _ => {}
                    }
                    if matches!(r.opcode, Opcode::NewArray | Opcode::Strcat | Opcode::Call | Opcode::Construct | Opcode::CallMethod | Opcode::CallDirect | Opcode::Operation | Opcode::NewClosure | Opcode::NewClosureOnce) {
                        o.push(' ');
                        list(o, r.args);
                    }
                    o.push('\n');
                }
                o.push_str("    ");
                let term = block.term.as_ref().unwrap_or(&Term::Unreachable);
                let (kind, value, targets, cases) = end_of(term);
                match kind {
                    0 => {
                        o.push_str("Jump ");
                        target(o, targets[0]);
                    }
                    1 => {
                        let _ = write!(o, "Branch v{} ? ", value.0);
                        target(o, targets[0]);
                        o.push_str(" : ");
                        target(o, targets[1]);
                    }
                    2 => {
                        let _ = write!(o, "Switch v{} [", value.0);
                        for (i, case) in cases.iter().enumerate() {
                            let _ = write!(o, "{}{case}: ", if i == 0 { "" } else { ", " });
                            target(o, targets[i]);
                        }
                        o.push_str("] default ");
                        target(o, targets[targets.len() - 1]);
                    }
                    3 => {
                        o.push_str("Return ");
                        if value.is_some() {
                            let _ = write!(o, "v{}", value.0);
                        } else {
                            o.push('-');
                        }
                    }
                    4 => {
                        let _ = write!(o, "Throw v{}", value.0);
                        if let Some(unwind) = targets.first() {
                            o.push_str(" unwind ");
                            target(o, unwind);
                        }
                    }
                    5 => {
                        o.push_str("Invoke ");
                        target(o, targets[0]);
                        o.push_str(" unwind ");
                        target(o, targets[1]);
                    }
                    _ => o.push_str("Unreachable"),
                }
                o.push('\n');
            }
        }
        out
    }
}
