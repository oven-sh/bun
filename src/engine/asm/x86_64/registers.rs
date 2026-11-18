use crate::register::{Fpr, Gpr};

macro_rules! names {
    ($type:ident: $($name:ident = $number:literal),*) => {
        $(pub const $name: $type = $type($number);)*
    };
}

names!(Gpr: RAX = 0, RCX = 1, RDX = 2, RBX = 3, RSP = 4, RBP = 5, RSI = 6, RDI = 7);
names!(Gpr: R8 = 8, R9 = 9, R10 = 10, R11 = 11, R12 = 12, R13 = 13, R14 = 14, R15 = 15);
names!(Fpr: XMM0 = 0, XMM1 = 1, XMM2 = 2, XMM3 = 3, XMM4 = 4, XMM5 = 5, XMM6 = 6, XMM7 = 7);
names!(Fpr: XMM8 = 8, XMM9 = 9, XMM10 = 10, XMM11 = 11, XMM12 = 12, XMM13 = 13, XMM14 = 14, XMM15 = 15);
