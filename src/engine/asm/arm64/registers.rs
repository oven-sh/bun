use crate::register::{Fpr, Gpr};

macro_rules! names {
    ($type:ident: $($name:ident = $number:literal),*) => {
        $(pub const $name: $type = $type($number);)*
    };
}

names!(Gpr: X0 = 0, X1 = 1, X2 = 2, X3 = 3, X4 = 4, X5 = 5, X6 = 6, X7 = 7);
names!(Gpr: X8 = 8, X9 = 9, X10 = 10, X11 = 11, X12 = 12, X13 = 13, X14 = 14, X15 = 15);
names!(Gpr: X16 = 16, X17 = 17, X18 = 18, X19 = 19, X20 = 20, X21 = 21, X22 = 22, X23 = 23);
names!(Gpr: X24 = 24, X25 = 25, X26 = 26, X27 = 27, X28 = 28, FP = 29, LR = 30, SP = 31);
names!(Fpr: V0 = 0, V1 = 1, V2 = 2, V3 = 3, V4 = 4, V5 = 5, V6 = 6, V7 = 7);
names!(Fpr: V8 = 8, V9 = 9, V10 = 10, V11 = 11, V12 = 12, V13 = 13, V14 = 14, V15 = 15);
names!(Fpr: V16 = 16, V17 = 17, V18 = 18, V19 = 19, V20 = 20, V21 = 21, V22 = 22, V23 = 23);
names!(Fpr: V24 = 24, V25 = 25, V26 = 26, V27 = 27, V28 = 28, V29 = 29, V30 = 30, V31 = 31);

/// Encoded like `SP`, in the operands that cannot be `SP`. It is in no register set.
pub const ZR: Gpr = Gpr(63);
