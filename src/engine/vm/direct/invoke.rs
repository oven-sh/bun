//! Calls a form as generated code does, going by nothing but its description.

use bun_engine_text::StringImpl;

use super::form::{MAX_DOUBLES, MAX_INTEGERS};
use super::{Context, DirectForm, Gives, Kind, Throws};
use crate::{Cx, JsResult, Thrown, Value};

/// Of the text of an operand of a call that is made ahead of time.
const MAX_FOLDED_LENGTH: usize = 128;

#[derive(Default)]
struct Registers {
    integers: [u64; MAX_INTEGERS],
    doubles: [f64; MAX_DOUBLES],
    integer_count: usize,
    double_count: usize,
}

impl Registers {
    fn push(&mut self, is_double: bool, bits: u64) {
        if is_double {
            self.doubles[self.double_count] = f64::from_bits(bits);
            self.double_count += 1;
        } else {
            self.integers[self.integer_count] = bits;
            self.integer_count += 1;
        }
    }

    /// What is in the two registers for results afterwards.
    ///
    /// # Safety
    /// `entry` is a function that takes what is in the registers.
    #[cfg(target_arch = "x86_64")]
    unsafe fn call(&self, entry: usize) -> (u64, f64) {
        let (integer, double);
        let ([a, b, c, d, e, f], [s, t, u, v, w, x, y, z]) = (self.integers, self.doubles);
        // SAFETY: the caller's.
        unsafe {
            core::arch::asm!(
                "call {entry}",
                entry = in(reg) entry,
                in("rdi") a, in("rsi") b, in("rdx") c, in("rcx") d, in("r8") e, in("r9") f,
                inlateout("xmm0") s => double, in("xmm1") t, in("xmm2") u, in("xmm3") v,
                in("xmm4") w, in("xmm5") x, in("xmm6") y, in("xmm7") z,
                lateout("rax") integer,
                clobber_abi("sysv64"),
            );
        }
        (integer, double)
    }

    /// # Safety
    /// As above.
    #[cfg(target_arch = "aarch64")]
    unsafe fn call(&self, entry: usize) -> (u64, f64) {
        let (integer, double);
        let ([a, b, c, d, e, f], [s, t, u, v, w, x, y, z]) = (self.integers, self.doubles);
        // SAFETY: the caller's.
        unsafe {
            core::arch::asm!(
                "blr {entry}",
                entry = in(reg) entry,
                inlateout("x0") a => integer, in("x1") b, in("x2") c, in("x3") d, in("x4") e, in("x5") f,
                inlateout("d0") s => double, in("d1") t, in("d2") u, in("d3") v,
                in("d4") w, in("d5") x, in("d6") y, in("d7") z,
                clobber_abi("C"),
            );
        }
        (integer, double)
    }
}

/// An operand that a compiler knows.
#[derive(Clone, Copy)]
pub enum Constant<'a> {
    /// The bits of a value that is no cell.
    Immediate(u64),
    String(&'a StringImpl),
}

impl DirectForm {
    /// Whether the result says that it has thrown.
    pub(super) fn is_mark(&self, register: u64) -> bool {
        self.throws != Throws::Never
            && match self.gives {
                Gives::Int32 { .. } => register as i32 == Gives::THREW_INT32,
                Gives::Boolean => register as u32 == Gives::THREW_BOOLEAN,
                _ => register == 0,
            }
    }

    /// Whether what is in the register for the result is as `gives` says.
    #[cfg(debug_assertions)]
    pub(super) fn could_give(&self, register: u64, first_operand: u64) -> bool {
        use crate::SpeculatedType as T;
        match self.gives {
            Gives::Value {
                types,
                min,
                max,
                or_first_operand,
            } => {
                // SAFETY: what the function has returned for a value.
                let value = unsafe { Value::from_bits_or_empty(register) };
                let integer = value.and_then(Value::as_int32);
                (or_first_operand && register == first_operand)
                    || (types.contains(T::of(value))
                        && integer.is_none_or(|it| (min..=max).contains(&it)))
            }
            Gives::Int32 { min, max } => (min..=max).contains(&(register as i32)),
            Gives::Boolean => register <= 1,
            Gives::Double(types) => types.contains(match f64::from_bits(register) {
                nan if nan.is_nan() && register != Value::PURE_NAN_BITS => T::IMPURE_NAN,
                number => T::of_double(number),
            }),
            Gives::Operand(_) | Gives::Constant(_) => false,
        }
    }

    /// `pass` gives what is passed for the operand at a position. `None` if one is not of its kind.
    ///
    /// # Safety
    /// It does so as `Kind::pass`, and `context` is what the form takes.
    unsafe fn invoke(
        &self,
        context: usize,
        pass: impl Fn(usize, Kind) -> Option<u64>,
    ) -> Option<JsResult<Value>> {
        let (mut registers, mut given) = (Registers::default(), None);
        if self.context != Context::None {
            registers.push(false, context as u64);
        }
        for (index, operand) in self.operands.iter().enumerate() {
            let bits = pass(index, operand.kind)?;
            if operand.is_passed {
                registers.push(operand.kind.is_double(), bits);
            }
            if self.gives == Gives::Operand(index as u8) {
                given = Some((operand.kind, bits));
            }
        }
        // SAFETY: the bits of a value.
        let value = |bits| unsafe { Value::from_bits(bits) };
        if let Some((kind, bits)) = given {
            return Some(Ok(match kind {
                Kind::Integer { .. } => Value::int32(bits as i32),
                Kind::Number | Kind::ToNumber => Value::double(f64::from_bits(bits)),
                _ => value(bits),
            }));
        }
        if let Gives::Constant(bits) = self.gives {
            return Some(Ok(value(bits)));
        }
        // SAFETY: the description is derived from the type of the function.
        let (integer, double) = unsafe { registers.call(self.entry()) };
        Some(match self.gives {
            _ if self.is_mark(integer) => Err(Thrown::new()),
            Gives::Int32 { .. } => Ok(Value::int32(integer as i32)),
            Gives::Boolean => Ok(Value::boolean(integer as u32 != 0)),
            Gives::Double(_) => Ok(Value::double(double)),
            _ => Ok(value(integer)),
        })
    }

    /// In the realm of the callee. `None` if an operand is not of its kind, or what the form needs does not hold. The
    /// value is of `result_types`.
    pub fn call(&self, cx: &Cx, this: Value, arguments: &[Value]) -> Option<JsResult<Value>> {
        let global = cx.global();
        if !self.prepare(cx, &global) {
            return None;
        }
        let context = match self.context {
            Context::Realm => global.address(),
            _ => core::ptr::from_ref(cx.vm()).expose_provenance(),
        };
        let operand = |index: usize| match index.checked_sub(self.takes_this.into()) {
            Some(index) => arguments.get(index).copied(),
            None => Some(this),
        };
        // SAFETY: as it asks.
        unsafe { self.invoke(context, |index, kind| kind.pass(&global, operand(index))) }
    }

    /// What a call with these operands always gives, if that is quickly found.
    pub fn evaluate(&self, cx: &Cx, this: Value, arguments: &[Value]) -> Option<Value> {
        const BITS_PER_DIGIT: usize = u64::BITS as usize;
        let length = |operand: &Value| match (operand.as_string(), operand.as_bigint()) {
            (Some(string), _) => string.len() as usize,
            (_, Some(bigint)) => bigint.value().digits().len() * BITS_PER_DIGIT,
            _ => 0,
        };
        let operands = (self.takes_this.then_some(&this).into_iter()).chain(arguments);
        if !self.is_pure()
            || self.throws == Throws::Errors
            || operands.map(length).any(|it| it > MAX_FOLDED_LENGTH)
        {
            return None;
        }
        match self.call(cx, this, arguments)? {
            Ok(value) => Some(value),
            Err(thrown) => {
                cx.discard_unless_termination(thrown);
                None
            }
        }
    }

    /// The same on any thread, as the bits of a value that is no cell. `operands` start with `this` if it is taken.
    pub fn fold(&self, operands: &[Constant<'_>]) -> Option<u64> {
        let length = |operand: &Constant<'_>| match operand {
            Constant::String(string) => string.len(),
            Constant::Immediate(_) => 0,
        };
        if !self.is_pure()
            || self.context != Context::None
            || operands.iter().map(length).any(|it| it > MAX_FOLDED_LENGTH)
        {
            return None;
        }
        let pass = |index: usize, kind: Kind| match (operands.get(index), kind) {
            (None, _) => kind.pass_immediate(None),
            (Some(&Constant::Immediate(bits)), _) => {
                // SAFETY: looked at only if it is no cell.
                let value = unsafe { Value::from_bits_or_empty(bits) };
                kind.pass_immediate(Some(value.filter(|it| !it.is_cell())?))
            }
            (Some(Constant::String(it)), Kind::Characters) => Some(it.address() as u64),
            (Some(Constant::String(it)), Kind::Unit) => {
                (it.len() == 1).then(|| it.text().at(0).into())
            }
            _ => None,
        };
        // SAFETY: it takes no context, and gets no cell.
        let result = unsafe { self.invoke(0, pass) }?;
        result.ok().map(Value::to_bits)
    }
}
