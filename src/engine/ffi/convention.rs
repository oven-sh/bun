//! Where the arguments of a C function go.

use bun_engine_asm::{Fpr, Gpr, arm64, x64};

use crate::{NativeType, Representation};

pub struct Convention {
    gprs: &'static [Gpr],
    fprs: &'static [Fpr],
    /// The position among all arguments picks the register, not that among those of the bank.
    is_positional: bool,
    /// What the callee may use below the arguments on the stack.
    shadow_bytes: u32,
    /// An argument on the stack takes its own size, not a word.
    packs_stack: bool,
    /// Tells a variadic function how many floats are in registers.
    float_count: Option<Gpr>,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Place {
    Gpr(Gpr),
    Fpr(Fpr),
    /// From the stack pointer before the call. Only the size of the type is the argument's.
    Stack(u32),
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Layout {
    pub places: Box<[Place]>,
    /// A multiple of 16.
    pub stack_bytes: u32,
    /// No integer is on the stack that has less than a word to itself.
    pub has_only_words_on_stack: bool,
    /// A register and what to put in it.
    pub float_count: Option<(Gpr, u32)>,
}

const WORD: u32 = 8;
const STACK_ALIGNMENT: u32 = 16;

impl Convention {
    /// System V Application Binary Interface, AMD64 Architecture Processor Supplement, 3.2.3.
    pub const SYSTEM_V: Convention = Convention {
        gprs: &x64::abi::ARGUMENT_GPRS,
        fprs: &x64::abi::ARGUMENT_FPRS,
        is_positional: false,
        shadow_bytes: 0,
        packs_stack: false,
        float_count: Some(x64::RAX),
    };

    /// <https://learn.microsoft.com/en-us/cpp/build/x64-calling-convention>
    pub const WINDOWS_X64: Convention = Convention {
        gprs: &[x64::RCX, x64::RDX, x64::R8, x64::R9],
        fprs: &[x64::XMM0, x64::XMM1, x64::XMM2, x64::XMM3],
        is_positional: true,
        shadow_bytes: 4 * WORD,
        packs_stack: false,
        float_count: None,
    };

    /// Procedure Call Standard for the Arm 64-bit Architecture, 6.8.
    pub const AAPCS64: Convention = Convention {
        gprs: &arm64::abi::ARGUMENT_GPRS,
        fprs: &arm64::abi::ARGUMENT_FPRS,
        is_positional: false,
        shadow_bytes: 0,
        packs_stack: false,
        float_count: None,
    };

    /// <https://developer.apple.com/documentation/xcode/writing-arm64-code-for-apple-platforms>
    pub const APPLE_ARM64: Convention = Convention {
        packs_stack: true,
        ..Self::AAPCS64
    };

    /// That of `extern "C"`.
    pub const HOST: Convention = if cfg!(all(target_arch = "x86_64", windows)) {
        Self::WINDOWS_X64
    } else if cfg!(target_arch = "x86_64") {
        Self::SYSTEM_V
    } else if cfg!(target_vendor = "apple") {
        Self::APPLE_ARM64
    } else {
        Self::AAPCS64
    };

    /// None of the types is `Void`.
    pub fn layout(&self, arguments: &[NativeType]) -> Layout {
        let (mut gprs, mut fprs, mut stack_bytes) = (0, 0, self.shadow_bytes);
        let mut has_only_words_on_stack = true;
        let place = |(position, argument): (usize, &NativeType)| {
            let representation = argument.representation();
            let is_float = matches!(representation, Representation::Float(_));
            let used = if is_float { &mut fprs } else { &mut gprs };
            let index = if self.is_positional { position } else { *used };
            let register = if is_float {
                self.fprs.get(index).copied().map(Place::Fpr)
            } else {
                self.gprs.get(index).copied().map(Place::Gpr)
            };
            *used += usize::from(register.is_some());
            register.unwrap_or_else(|| {
                let size = match representation.size() {
                    Some(size) if self.packs_stack => size.bytes().into(),
                    _ => WORD,
                };
                has_only_words_on_stack &= is_float || size == WORD;
                let offset = stack_bytes.next_multiple_of(size);
                stack_bytes = offset + size;
                Place::Stack(offset)
            })
        };
        let places = arguments.iter().enumerate().map(place).collect();
        Layout {
            places,
            stack_bytes: stack_bytes.next_multiple_of(STACK_ALIGNMENT),
            has_only_words_on_stack,
            float_count: self.float_count.map(|register| (register, fprs as u32)),
        }
    }

    /// For a function that takes two words.
    pub(crate) fn first_two_gprs(&self) -> [Gpr; 2] {
        [self.gprs[0], self.gprs[1]]
    }

    pub(crate) fn shadow_bytes(&self) -> u32 {
        self.shadow_bytes
    }
}
