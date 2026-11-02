A set of the variants of a fieldless enum: one bit per variant, in the narrowest
of `u8`, `u16`, `u32` and `u64` that has a bit for each.

```
use bun_collections::{EnumSet, EnumSetType};

#[derive(Clone, Copy, PartialEq, Eq, Debug, EnumSetType)]
enum Flag {
    A,
    B,
    C,
}

let mut set = Flag::A | Flag::C;
assert_eq!(size_of_val(&set), 1);

set.insert(Flag::B);
set.remove(Flag::A);
set.set(Flag::C, false);
assert!(set.contains(Flag::B));
assert_eq!(set.len(), 1);

// In declaration order.
assert_eq!((!set).iter().collect::<Vec<_>>(), [Flag::A, Flag::C]);
```

# What the derive accepts

The bit of a variant is its discriminant, and iterating turns a bit back into the
variant at that position. So the discriminants have to count up from 0, which
they do unless they are written out:

```compile_fail,E0080
#[derive(Clone, Copy, PartialEq, Eq, bun_collections::EnumSetType)]
enum Sparse {
    A = 0,
    B = 2,
}
```

```compile_fail,E0080
#[derive(Clone, Copy, PartialEq, Eq, bun_collections::EnumSetType)]
enum StartsAtOne {
    A = 1,
    B = 2,
}
```

```compile_fail,E0080
#[derive(Clone, Copy, PartialEq, Eq, bun_collections::EnumSetType)]
enum OutOfOrder {
    A = 1,
    B = 0,
}
```

```compile_fail,E0080
#[repr(u64)]
#[derive(Clone, Copy, PartialEq, Eq, bun_collections::EnumSetType)]
enum PastU32 {
    A = 1 << 32,
}
```

No variant has fields, and there are 1 to 64 of them. This one has 65:

```compile_fail
#[derive(Clone, Copy, PartialEq, Eq, bun_collections::EnumSetType)]
enum OneTooMany {
    V0, V1, V2, V3, V4, V5, V6, V7, V8, V9, V10, V11, V12, V13, V14, V15, V16,
    V17, V18, V19, V20, V21, V22, V23, V24, V25, V26, V27, V28, V29, V30, V31,
    V32, V33, V34, V35, V36, V37, V38, V39, V40, V41, V42, V43, V44, V45, V46,
    V47, V48, V49, V50, V51, V52, V53, V54, V55, V56, V57, V58, V59, V60, V61,
    V62, V63, V64,
}
```
