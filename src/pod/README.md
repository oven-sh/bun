Plain-old-data: which types may be viewed as bytes, which may be made from
bytes, and the safe casts those two facts allow. `bun_core` re-exports
everything here; only crates below it name `bun_pod`.

| trait           | promise                                  | unlocks                |
| --------------- | ---------------------------------------- | ---------------------- |
| `NoUninit`      | every byte of every value is initialized | `&T` → `&[u8]`         |
| `AnyBitPattern` | every byte pattern is a value            | `&[u8]` → `T`          |
| `Pod`           | both (blanket-implemented)               | `&mut T` ↔ `&mut [u8]` |
| `Zeroable`      | the all-zero byte pattern is a value     | `zeroed()`             |

# Implementing the traits

`impl_no_uninit!`, `impl_any_bit_pattern!`, `impl_pod!` and `impl_zeroable!` are
safe. rustc's own layout analysis (`core::mem::TransmuteFrom`) proves the promise
for the type's real layout on the target being compiled, so a field that
introduces padding or a niche is a compile error at the macro call.

`NoUninit` rules out padding (between fields, after the last one, or in the
shorter arms of a union), `MaybeUninit` and pointers, whose bytes carry
provenance. `#[repr(u8)]` enums and `bool` qualify: their bytes are restricted,
not uninitialized.

```
#[repr(C)]
#[derive(Clone, Copy)]
struct Header { tag: Tag, flags: u8, len: u16 }
#[repr(u8)]
#[derive(Clone, Copy)]
enum Tag { A = 1, B = 2 }
bun_pod::impl_no_uninit!(Header, Tag);
assert_eq!(bun_pod::bytes_of(&Header { tag: Tag::B, flags: 3, len: 0 }), [2, 3, 0, 0]);
```

```compile_fail,E0277
#[repr(C)]
#[derive(Clone, Copy)]
struct Padded { a: u8, b: u32 }
bun_pod::impl_no_uninit!(Padded);
```

```compile_fail,E0277
#[repr(C)]
#[derive(Clone, Copy)]
union Uneven { a: u32, b: u8 }
bun_pod::impl_no_uninit!(Uneven);
```

```compile_fail,E0277
#[repr(C)]
#[derive(Clone, Copy)]
struct HasPointer { p: *const u8 }
bun_pod::impl_no_uninit!(HasPointer);
```

`AnyBitPattern` rules out `bool`, `char`, enums, `NonZero*`, references and
pointers. Padding is fine. It is the bound for bytes that come from a file, the
network or the kernel. The macro also implements `Zeroable`.

```
#[repr(C)]
#[derive(Clone, Copy)]
struct Padded { a: u8, b: u32 }
bun_pod::impl_any_bit_pattern!(Padded);
assert_eq!(bun_pod::read_prefix::<Padded>(&[7; 9]).unwrap().a, 7);
```

```compile_fail,E0277
#[repr(u8)]
#[derive(Clone, Copy)]
enum Tag { A = 0, B = 1 }
bun_pod::impl_any_bit_pattern!(Tag);
```

```compile_fail,E0277
#[repr(C)]
#[derive(Clone, Copy)]
struct HasBool { a: bool }
bun_pod::impl_any_bit_pattern!(HasBool);
```

`impl_pod!` is both of the above.

```
#[repr(C, packed)]
#[derive(Clone, Copy)]
struct Setting { id: u16, value: u32 }
bun_pod::impl_pod!(Setting);
let mut s: Setting = bun_pod::zeroed();
bun_pod::bytes_of_mut(&mut s)[0] = 1;
assert_eq!({ s.id }, u16::from_ne_bytes([1, 0]));
```

`Zeroable` rules out references, `Box`, `NonNull`, `NonZero*`, bare fn pointers
and enums without a zero discriminant. Raw pointers (null), `Option` of a
niche-optimized pointer (`None`) and padding are fine.

```
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Debug)]
enum Tag { A = 0, B = 1 }
bun_pod::impl_zeroable!(Tag);
assert_eq!(bun_pod::zeroed::<Tag>(), Tag::A);
```

```compile_fail,E0277
#[repr(u8)]
#[derive(Clone, Copy)]
enum Tag { A = 1, B = 2 }
bun_pod::impl_zeroable!(Tag);
```

# What the proof leaves to you

The macros prove that the cast is sound. Two things are outside that:

- **Field order.** rustc orders the fields of a `repr(Rust)` struct as it likes,
  and such a struct passes when the order it picked leaves no padding. Its bytes
  follow that order, which the next compiler may change. Give every type a
  `#[repr(C)]`, `#[repr(transparent)]` or `#[repr(u8)]`-style attribute.
  `test/internal/source-lints/pod-impl-repr.test.ts` rejects one without.
- **Invariants.** `AnyBitPattern` lets safe code make any value of the type
  without going through its constructors. rustc knows that a `bool` is 0 or 1. It
  does not know that an index is meant to be in range, in this type or in the
  private fields of a field's type, even one from another crate. Do not implement
  it for a type, or a wrapper around one, whose fields `unsafe` code trusts.

# When to write `unsafe impl`

Only for what the analysis cannot do, each of which is a compile error from the
macro rather than a wrong answer:

- generic parameters (`impl<T> .. for ExternalSlice<T>`);
- a field whose type is an associated type (`T::Padding`, the storage of a
  `bitflags!` struct);
- pointers, which only `Zeroable` allows;
- types over 4 KiB. The analysis recurses once per byte and overflows rustc's
  stack somewhere past 16 KiB, so the macros refuse early.

```compile_fail,E0080
#[repr(C)]
#[derive(Clone, Copy)]
struct TooLarge([u8; 1 << 20]);
bun_pod::impl_no_uninit!(TooLarge);
```

# Casting

- `bytes_of`, `bytes_of_mut`, `slice_as_bytes`, `slice_as_bytes_mut`: to bytes.
  Cannot fail, and are `const`.
- `read_prefix`: copy a value out of the front of a byte slice at any alignment.
- `try_cast_slice`, `try_cast_slice_mut`: `None` if the data is not aligned for
  the target or does not divide into whole elements.
- `cast_slice`, `cast_slice_mut`: the same, panicking. For layouts the caller
  has already established.

When the target is no more aligned than the source and its size divides the
source's, both checks compare constants and the cast compiles to a length
computation. An empty slice always casts: its pointer is often dangling, so it
says nothing about the alignment of the data it stands for.

`Unaligned<T>` is a `T` with alignment 1, so `&[u8]` → `&[Unaligned<T>]` has no
alignment to check. `Unaligned::slice_of` and `slice_of_mut` also leave out a
trailing partial element, so they cannot fail. Use them for bytes whose address
Bun does not control: an `ArrayBuffer` over `bun:ffi` or N-API memory, an offset
into a file. `vec_from_bytes` (feature `alloc`) copies such bytes into a `Vec<T>`.

```
let bytes = [0u8, 1, 0, 2, 0, 3];
let odd = bun_pod::Unaligned::<u16>::slice_of(&bytes[1..]);
assert_eq!(odd.len(), 2);
assert_eq!(odd[1].get(), u16::from_ne_bytes([2, 0]));
```
