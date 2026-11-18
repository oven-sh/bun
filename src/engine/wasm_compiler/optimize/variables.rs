//! Locals, globals and the operand stack.

use bun_engine_codegen::ir::{Type, Value};
use bun_engine_wasm_format::{ConstExpr, GlobalIndex, ValType, VisitVariable};

use super::locals::{Typed, common_type};
use super::references::Fact;
use super::translator::{Operand, Translator, Visited, ir_type};
use crate::abi::{GlobalPlace, Operation};

impl Translator<'_> {
    /// What an immutable global that the module defines starts with, if that takes no code.
    fn initializer(&self, mut global: GlobalIndex) -> Option<ConstExpr> {
        loop {
            let data = self.module.global(global);
            match data.init.filter(|_| !data.mutable)? {
                ConstExpr::GlobalGet(earlier) => global = earlier,
                init => return Some(init),
            }
        }
    }

    fn load_global(&mut self, global: GlobalIndex) -> Value {
        let data = self.module.global(global);
        let (ty, place) = (ir_type(data.ty), self.env.layout.global(global));
        let (address, offset) = match place {
            GlobalPlace::Inline(offset) => (self.instance, offset),
            GlobalPlace::Indirect(offset) => (self.load_fixed(Type::I64, self.instance, offset), 0),
        };
        if data.mutable {
            let heap = self.heaps.global(self.b.function, self.module, global);
            self.load_readable(ty, address, offset, heap)
        } else {
            self.load_fixed(ty, address, offset)
        }
    }
}

#[deny(clippy::missing_trait_methods)]
impl VisitVariable for Translator<'_> {
    fn drop_(&mut self) -> Visited {
        self.pop();
        Ok(())
    }

    fn select(&mut self, ty: Option<ValType>) -> Visited {
        let (condition, or, then) = (self.pop_value(), self.pop(), self.pop());
        match self.b.int_constant(condition) {
            Some(0) => self.stack.push(or),
            Some(_) => self.stack.push(then),
            None => {
                let value = self.b.select(condition, then.value, or.value);
                let ty = common_type(self.types, then.ty, or.ty, ty.unwrap_or(then.ty));
                self.push(value, ty);
            }
        }
        Ok(())
    }

    #[inline]
    fn local_get(&mut self, local: u32) -> Visited {
        let local = self.activation.first_local + local;
        let Typed { value, ty } = self.locals.get(self.b.function, self.types, local);
        self.stack.push(Operand { value, ty, local });
        Ok(())
    }

    #[inline]
    fn local_set(&mut self, local: u32) -> Visited {
        let operand = self.pop();
        self.unused_comparison = Value::NONE;
        (self.locals).set(self.activation.first_local + local, operand.typed());
        Ok(())
    }

    #[inline]
    fn local_tee(&mut self, local: u32) -> Visited {
        let operand = self.stack.last_mut().expect("the code was validated");
        operand.local = self.activation.first_local + local;
        self.unused_comparison = Value::NONE;
        self.locals.set(operand.local, operand.typed());
        Ok(())
    }

    fn global_get(&mut self, global: GlobalIndex) -> Visited {
        let mut ty = self.module.global(global).ty;
        let value = match self.initializer(global) {
            Some(ConstExpr::I32(value)) => self.b.const32(value),
            Some(ConstExpr::I64(value)) => self.b.const64(value),
            Some(ConstExpr::F32(bits)) => self.b.constant(Type::F32, bits.into()),
            Some(ConstExpr::F64(bits)) => self.b.constant(Type::F64, bits),
            Some(ConstExpr::RefNull) => self.null(),
            Some(ConstExpr::RefFunc(func)) => {
                let value = self.load_global(global);
                self.facts.add(value, Fact::Function(func));
                ty = self.type_of_reference_to(func);
                value
            }
            _ => self.load_global(global),
        };
        self.push(value, ty);
        Ok(())
    }

    fn global_set(&mut self, global: GlobalIndex) -> Visited {
        let operand = self.pop();
        let heap = self.heaps.global(self.b.function, self.module, global);
        match self.env.layout.global(global) {
            GlobalPlace::Inline(offset) => {
                self.b.store(operand.value, self.instance, offset, heap);
                self.write_barrier(self.instance, operand, heap);
            }
            GlobalPlace::Indirect(_) if operand.ty.is_ref() => {
                let args = [self.b.const32(global.0 as i32), operand.value];
                self.call_operation(Operation::GlobalSetReference, &args, Type::Void, heap);
            }
            GlobalPlace::Indirect(offset) => {
                let address = self.load_fixed(Type::I64, self.instance, offset);
                self.b.store(operand.value, address, 0, heap);
            }
        }
        Ok(())
    }
}
