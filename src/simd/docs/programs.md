# Programs larger than a module

How kernels fit into a program with many files, tables of functions, objects that last, and traits. [The guide][guide] has the basics.

| Wanted | How |
| --- | --- |
| One list of targets and shared helpers for many files, or for several crates | [Many files and crates](#many-files-and-crates) |
| No dispatch in each call, or a table of functions | [A kernel that returns pointers](#pointers-and-tables) |
| An object that is made for a target, with its tables in vectors | [A kernel that returns a closure or a `Box<dyn Trait>`](#objects) |
| Vectors in `const`, `static`, `Vec` or a struct | [Where vectors can be](#where-vectors-can-be) |
| Cells, atomics, `MaybeUninit`, bytes as lanes | [Memory that is not a plain slice](#memory-that-is-not-a-plain-slice) |
| `impl Mul` and other traits | [Traits](#traits) |
| One kernel or helper on its own | [Marks on items](#marks-on-items) |
| One instruction in scalar code, or inputs of a few bytes | [Short work](#short-work) |
| Whether the CPU has an instruction, outside of kernels | `cpu().includes(target!(avx2 + sha))`, which is false on other architectures |
| The same code at two widths | A parameter `W: Width` of the helpers, `Simd<f32, W, S>` and `Simd::<f32, W, S>::over(x)` |
| All code for one CPU, which is known when it is compiled | [A type of one's own on `Baseline`](#without-dispatch) |
| `#[expect]`, clippy, rust-analyzer | [Lints and editors](#lints-and-editors) |
| What an error means | [Messages](#messages) |
| To see what `#[simd]` and `#[kernel]` write | [What the attributes write](#what-the-attributes-write) |

## Many files and crates

The attribute can't see into other files. So each file has a marked module of its own, and passes its names on. `targets!` names the targets once, and the modules take them by a path. **Without a path they have the default list.**

```standalone_crate
# #![forbid(unsafe_code)]
// lib.rs, with `mod lanes; mod decode; mod report;`
bun_simd::targets!(icelake, avx2, sse4, neon);

# mod lanes {
// lanes.rs
pub use simd::*;
#[bun_simd::simd(crate)]
mod simd {
    use bun_simd::prelude::*;

    pub fn is_escape(v: u8xN<S>) -> mask8xN<S> {
        v.simd_eq(b'\\')
    }
}
# }

# mod decode {
// decode.rs
pub use simd::*;
#[bun_simd::simd(crate)]
mod simd {
    use {crate::lanes::is_escape, bun_simd::prelude::*};

    #[kernel]
    pub fn escapes(text: &[u8]) -> usize {
        over(text).count(is_escape)
    }
}
# }

# mod report {
// report.rs
pub use simd::*;
#[bun_simd::simd(crate)]
mod simd {
    use {crate::decode::escapes, bun_simd::prelude::*};

    #[kernel]
    pub fn lines_with_escapes(text: &[u8]) -> usize {
        text.split(|&b| b == b'\n').filter(|line| escapes::here(line) > 0).count() // No second dispatch.
    }
}
# } fn main() {
# assert_eq!(report::lines_with_escapes(b"a\\b\nc"), 1);
# }
```

- On nightly Rust, with `#![feature(custom_inner_attributes)]`, `#![bun_simd::simd(crate)]` as the first line marks the file itself.
- A module in braces gets the mark and the list of the one around it. Other crates take the list from a `pub mod` with `#[simd(avx2, ..)]`.
- **A kernel is also a type of its name**, for `f::here`. So `mod f; pub use f::f;` is an error: give the file another name.
- An enum with a mark of its own that declares `S: bun_simd::Isa` stays as it is written. One with defaults has to declare it.
- Constants are imported by name: after `use lanes::STEP;` there is `S::STEP`.
- Helpers are compiled in the crate of the kernel that calls them. What they call and has no mark needs `#[inline]` to get their instructions.

| | |
| --- | --- |
| `f(..)` | Runs on the best target of the kernel that the CPU has, also in marked code. |
| `f::here(..)` | In marked code, on its target. If the kernel doesn't list that, it dispatches. |
| `f::baseline(..)` | On the best target of the kernel that the whole program is compiled for. It can be inlined. |
| `f::to(target, ..)` | For tests: on a target of the list, if the CPU has it. |

## Pointers and tables

In a kernel, the name of a helper is that for the same target, and can be a plain `fn` pointer. It stays valid, in all threads. One dispatch makes a whole table. `simd::shifts::to(target)` makes it for another target of the list, or gives `None` if the CPU lacks that.

```
# #![forbid(unsafe_code)]
#[bun_simd::simd]
mod simd {
    use bun_simd::prelude::*;

    pub type Shift = fn(&mut [u32]);

    fn shift<const BY: u32>(values: &mut [u32]) {
        over_mut(values).map(|v| v >> BY);
    }

    #[kernel]
    pub fn shifts() -> &'static [Shift; 3] {
        &[shift::<0, S>, shift::<1, S>, shift::<2, S>]
    }
}
# fn main() {
let shifts = simd::shifts(); // Keep it in a field or a `OnceLock`.
let mut values = [12; 40];
shifts[2](&mut values);
assert_eq!(values, [3; 40]);
# }
```

A dispatch costs about as much as a call through a pointer. A table gains where it replaces a `match` in the kernel, which is a jump and often one more call.
Vectors go through memory in a call by a pointer or `dyn`, which takes 3 to 9 ns. So let short functions take slices, or take a `match` in the loop.
On x86 that time holds for methods of traits, functions with `#[inline(never)]`, and `move` closures behind `dyn Fn` or `dyn FnMut`, if the arguments are `Copy`. Others, such as a closure as `fn` pointer, take up to 20 ns more.
Pointers that were made before `set_cpu` keep their target. The name of a kernel is a pointer that dispatches in each call.

## Objects

A closure that is written in a kernel has the instructions of its target, and can own vectors.

```
# #[forbid(unsafe_code)] #[bun_simd::simd] mod simd { use bun_simd::prelude::*;
pub type Finder = Box<dyn Fn(&[u8]) -> Option<usize> + Send + Sync>;

#[kernel]
pub fn finder(a: u8, b: u8) -> Finder {
    let (a, b) = (u8xN::splat(a), u8xN::splat(b));
    Box::new(move |text| over(text).position(|v| v.simd_eq(a) | v.simd_eq(b)))
}
# } fn main() {
let find = simd::finder(b'<', b'&');
assert_eq!(find(b"a & b"), Some(2));
# }
```

For several methods there is `dyn Trait`. The methods of a type with `S` have the instructions of the target.

```
# #[forbid(unsafe_code)] #[bun_simd::simd] mod simd { use bun_simd::prelude::*;
pub trait Search {
    fn find(&self, text: &[u8]) -> Option<usize>;
    fn count(&self, text: &[u8]) -> usize;
}

struct Byte(u8xN<S>);

impl Search for Byte<S> {
    fn find(&self, text: &[u8]) -> Option<usize> {
        over(text).position(|v| v.simd_eq(self.0))
    }
    fn count(&self, text: &[u8]) -> usize {
        over(text).count(|v| v.simd_eq(self.0))
    }
}

#[kernel]
pub fn search(byte: u8) -> Box<dyn Search> {
    Box::new(Byte(u8xN::splat(byte)))
}
# } fn main() {
let it = simd::search(b'a');
assert_eq!((it.find(b"banana"), it.count(b"banana")), (Some(1), 3));
# }
```

An object that needs no target of its own is simpler: its fields are arrays, and its methods have `#[kernel]`, in an `impl` with `#[simd]`. To load a few vectors in each call costs next to nothing.
If only the layout of its tables depends on the target, a kernel builds them, and puts the pointer to the function that reads them next to them. `f::to(target, ..)` with a stored `Target` works too, and takes up to 3 ns more for each call.

## Where vectors can be

| | |
| --- | --- |
| `const` | It can't be a vector. An array is an operand, `v & TABLE`, and `u8x16::from(TABLE)` makes the same code as a constant would |
| `static` | `Aligned<[T; N]>`. Or a `OnceLock` of an [object](#objects) |
| Structs, arrays, `Vec`, `Box` | As any value. They are aligned, `Send` and `Sync` |
| The signature of a kernel | Not by name, as the type depends on the target. Behind `dyn`, or as `Array<T, W>` |
| What is larger than a few registers | Slices of numbers, which all targets share. Where loads that [cross cache lines][slow] count, a `Vec<Aligned<[T; N]>>`. `bitcast_slice` and `bitcast_slice_mut` give the lanes of that, and of a slice of vectors |

## Memory that is not a plain slice

Loads and `over` take a slice of anything that is `Readable`. Stores take a
slice of anything that is `Writable`. `store_at`, `store_partial_at` and the loops take a mutable reference to any `Sink`.

| | Read | Written | |
| --- | --- | --- | --- |
| `&[T]` | ✓ | | |
| `&mut [T]` | | ✓ | |
| `&mut [MaybeUninit<T>]` | | ✓ | Needs no zeros first. |
| `&[[u8; N]]`, `&mut [[u8; N]]` | ✓ | ✓ | The little-endian bytes of lanes of `N` bytes, at any address. |
| `&[Cell<T>]` | ✓ | ✓ | Input and output can overlap, if the output starts no later. This row and those below are sinks only: `v.store_at(&mut &cells[..], at)`, not `v.store(cells)`. |
| `&[AtomicU8]`, `&[Shared<N>]` | ✓ | ✓ | Other threads can write at the same time. Each byte is atomic, with relaxed ordering. `Shared<2>` is `[AtomicU8; 2]`, for lanes of 2 bytes. |
| `&[AtomicU16]` and wider | ✓ | ✓ | One lane at a time, so it is slow. |
| `&mut Output<T>` | | ✓ | It is appended to. |
| `&[Streamed<T>]` | | ✓ | The stores go around the caches. |

```
# #[forbid(unsafe_code)] #[bun_simd::simd] mod simd { use bun_simd::prelude::*;
#[kernel]
pub fn invert<E: Readable<u8>, T: Sink<u8>>(from: &[E], mut to: T) {
    over(from).map_into(&mut to, |v| !v);
}
# } use {bun_simd::prelude::*, simd::*}; fn main() {
use std::{cell::Cell, sync::atomic::AtomicU8};

let mut plain = [0; 5];
invert(&[1u8; 5], &mut plain[..]);
assert_eq!(plain, [254; 5]);

let in_place = Cell::from_mut(&mut plain[..]).as_slice_of_cells();
invert(in_place, in_place);
assert_eq!(plain, [1; 5]);

let shared = [const { AtomicU8::new(2) }; 5];
invert(&shared, &mut plain[..]);
assert_eq!(plain, [253; 5]);
# }
```

## Traits

A type with `S` can have any trait, and its methods can use all that a helper can. A type for memory, which all targets share, turns into it where it is loaded.

```
# #[forbid(unsafe_code)] #[bun_simd::simd] mod simd { use bun_simd::prelude::*;
/// In memory.
#[derive(Clone, Copy, PartialEq, Debug)]
pub struct Quaternion(pub [f32; 4]);

/// In a register.
#[derive(Clone, Copy)]
struct Q(f32x4<S>);

impl core::ops::Neg for Q<S> {
    type Output = Q<S>;
    fn neg(self) -> Q<S> {
        Q(self.0 * [1.0, -1.0, -1.0, -1.0])
    }
}

impl core::ops::Add<f32> for Q<S> {
    type Output = Q<S>;
    fn add(self, real: f32) -> Q<S> {
        Q(self.0 + f32x4::splat(real) * [1.0, 0.0, 0.0, 0.0])
    }
}

#[kernel]
pub fn conjugate_and_add(all: &mut [Quaternion], real: f32) {
    for it in all {
        it.0 = (-Q(f32x4::from(it.0)) + real).0.to_array();
    }
}
# } fn main() {
let mut all = [simd::Quaternion([1.0, 2.0, 3.0, 4.0])];
simd::conjugate_and_add(&mut all, 1.0);
assert_eq!(all[0].0, [2.0, -2.0, -3.0, -4.0]);
# }
```

`impl Mul` for the type in memory can call a kernel, which is a call for each product.

A trait that bounds a parameter of a kernel has no `S` of its own. Its methods and types have it, by a mark on each.

```
# #![forbid(unsafe_code)]
use bun_simd::prelude::*;

pub trait Class {
    #[simd]
    fn has(v: u8xN<S>) -> mask8xN<S>;
}

pub struct Digits;
impl Class for Digits {
    #[simd]
    fn has(v: u8xN<S>) -> mask8xN<S> {
        v.is_ascii_digit()
    }
}

#[kernel]
fn count<C: Class>(text: &[u8]) -> usize {
    over(text).count(C::has)
}
# fn main() {
assert_eq!(count::<Digits>(b"a1b22"), 3);
# }
```

## Marks on items

A module is the usual form, as nothing can be forgotten. `#[kernel]` needs none, and `#[simd]` also marks a single function, type, `impl`, trait, constant or `macro_rules!`.
Such a kernel takes its list from `targets!` next to it, which can be a path, or from `use super::*;`.

```
# #![forbid(unsafe_code)]
use bun_simd::prelude::*;
targets!(avx2, sse4, neon);

#[simd]
fn is_digit(v: u8xN<S>) -> mask8xN<S> {
    v.within(b'0'..=b'9')
}

#[kernel]
pub fn all_digits(text: &[u8]) -> bool {
    over(text).all(is_digit)
}
# fn main() {
# assert!(all_digits(b"12"));
# }
```

Twins need a module. Mark scalar helpers too, unless code without a mark calls them: then take `#[inline]`.
A function without a mark is compiled for the baseline, unless it is inlined. That also holds for one that declares `S: bun_simd::Isa` by hand. The result is right, and it is slow: 15 to 60 times for a lookup in a table, on x86. `--cfg bun_simd_check` in tests finds it, and so does `tools/check-inlined.sh`.

## Short work

A call costs 1 to 2 ns, and code for another target than that of the caller is never inlined. There are two ways around it.

- **The baseline**, if it has the instruction. `f::baseline(..)` and code on `Baseline` are inlined. `has!(Baseline: crc32c)` is a constant: `if has!(Baseline: crc32c) && bytes.len() < 128 { f::baseline(bytes) } else { f(bytes) }`.
  No level of `-Ctarget-cpu=x86-64-v*` has `aes`: add `-Ctarget-feature=+aes,+pclmulqdq`.
- **A kernel further out**, around the loop that makes the calls. Scalar code can be in a kernel too.

## Without dispatch

A program that is compiled for the CPU that runs it needs no kernels. `u8xN<Baseline>` and the like have full speed in all functions, traits and crates, and no helper has to be inlined.

```
# #![forbid(unsafe_code)]
use bun_simd::prelude::*;

#[derive(Clone, Copy)]
pub struct Lanes(f32xN<Baseline>);

impl Lanes {
    pub fn splat(x: f32) -> Self {
        Lanes(f32xN::splat(x))
    }
}

impl core::ops::Mul for Lanes {
    type Output = Self;
    fn mul(self, other: Self) -> Self {
        Lanes(self.0 * other.0)
    }
}
# fn main() { assert_eq!((Lanes::splat(2.0) * Lanes::splat(3.0)).0[0], 6.0); }
```

A helper is called with the target by name, `f::<Baseline>(..)`, unless its arguments tell it.

## Macros that write items

A `macro_rules!` works in the body of a function as it does anywhere. Called among the items, it is called after the attribute has run, so what it writes needs `#[simd]` or `#[kernel]` of its own.

```
# #![forbid(unsafe_code)]
#[bun_simd::simd]
mod simd {
    use bun_simd::prelude::*;
    macro_rules! counts { ($($name:ident $is:ident: $t:ty, $v:ident;)*) => {$(
        #[simd]
        fn $is(v: $v<S>) -> MaskN<$t, S> { v.simd_eq($v::zero()) }
        #[kernel]
        pub fn $name(x: &[$t]) -> usize { over(x).count($is) }
    )*}; }
    counts! { zero_bytes is_zero8: u8, u8xN; zero_words is_zero32: u32, u32xN; }
}
# fn main() {
assert_eq!((simd::zero_bytes(&[0, 1, 0]), simd::zero_words(&[0, 1])), (2, 1));
# }
```

A function that is generic over the lane, `fn zeros<T: Lane>(x: &[T])`, often needs no macro.

## Lints and editors

Lints see your code as they do elsewhere, `forbid(..)` works, and each warning or error comes once. Lints on the form of a closure, such as `clippy::map_clone`, don't see closures in marked code.
rust-analyzer infers `S` as rustc does. It doesn't tell the attributes their path, so it needs the crate under the name `bun_simd`, also where another crate exports it again.

## Messages

Most messages name the fix. These are in the words of rustc:

| | |
| --- | --- |
| E0283, E0284: type annotations needed | The function has no mark, or calls a helper from outside: make that a `#[kernel]`, or `#[shared]`. A constant or `const fn` names `S`, or has `#[simd]` itself |
| E0107: missing generics | Add `S`, last |
| E0308: expected `bool`, found `Mask` | `m.any()` or `m.all()`. `&` and `\|` for `&&` and `\|\|` |
| Not supported in traits or impls | The `impl` around a kernel needs `#[simd]` |
| E0049: a method has one more parameter than in the trait | `#[simd]` on the method in the trait |
| E0308, E0271: two names for one width, such as `Upto32`, `Twice` or `Scaled` | `resize()`, which costs nothing |
| E0255: defined multiple times | A file has the name of its kernel |
| `__Targets` is missing or ambiguous | Write `targets!(..)` there |
| E0133: requires unsafe | An intrinsic needs `#[only(..)]` or `pick!` with its feature |
| E0742, E0449: visibility | Write the attribute in the macro that writes the item, by its name, and the keyword of the item too. Of macros for other crates, the outermost takes `#[shared]` |
| A long name in an error of the build, `a_function_is_called_on_a_target_..` | No twin fits: add one, or put the call after `if has!(..)`. Or the list of its module lacks the target: take that of the caller by a path |
| The same with a rule, such as `the_vector_has_no_block_K` | The operation doesn't fit its types. If that is so on some targets only, put the call after `if const { .. }` or `if has!(..)` |
| The linker misses `this_code_lacks_the_instructions_..` | See the pitfalls in [the guide][guide] |

## What the attributes write

They write safe code, but for functions that call `core::arch`: these go through one macro of the crate, which has `unsafe`. A helper gets the parameter `S`, the clause from which rustc infers it at each use, and a body that is entered through a function with the features of `S`, of which nothing is left once it is inlined. So do closures.

```text
#[simd]
fn is_space(v: u8xN<S>) -> mask8xN<S> { v.simd_eq(b' ') }

#[inline(always)]
fn is_space<S: Isa>(v: u8xN<S>) -> mask8xN<S> where ThisFunction: NeedsAttributeSimdOrKernel<S> {
    real::<S>();
    Entering::<S>::inlined1(v, #[inline(always)] move |v| v.simd_eq(b' '))
}
```

A kernel has such a function for its body, a type that leads to it for each `S`, and a function of its name that dispatches. Only dispatch names a target, so code for a target runs only where the CPU has it.

What differs from plain code: a closure can drop what it owns in another order, `must_use` in a `cfg_attr` counts on the last twin only, and names that start with `__` are taken.

[guide]: guide.md
[slow]: speed.md#slow-operations
