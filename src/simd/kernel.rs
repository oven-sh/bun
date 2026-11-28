use crate::gate::{Enter, TokenOf};
use crate::ops::Ops;
use crate::{Lane, Named, Tag, Target, Targets, Unsigned, Width};

/// A target, as a type. It has no name but `S`, which [`simd`](macro@crate::simd) and [`kernel`](macro@crate::kernel) declare, so code for it runs only where the CPU has its features.
///
/// [`has!`](macro@crate::has) says what is fast on the target. Only this crate implements the trait.
///
/// ```
/// use bun_simd::prelude::*;
/// #[simd]
/// fn spaces(text: &[u8]) -> usize {
///     over(text).count(|v| v.simd_eq(b' '))
/// }
/// assert_eq!(spaces::<Baseline>(b"a b c"), 2);
/// ```
#[diagnostic::on_unimplemented(
    message = "this depends on the target, and `{Self}` is none",
    label = "`S` is the target in what has `#[simd]` or `#[kernel]`",
    note = "add `#[simd]` to the function, type, `impl` or constant around this, also in a `macro_rules!`, or to its module. A `static` has no target",
    note = "`S` is the last parameter, as in `Simd<u8, B16, S>`, and the name is taken"
)]
#[allow(private_bounds)]
pub trait Isa:
    Copy
    + Send
    + Sync
    + Default
    + Ord
    + core::hash::Hash
    + core::fmt::Debug
    + 'static
    + Ops
    + Enter
    + Tags
    + Has
    + crate::only::Words
    + crate::masks::Masks
{
    /// The target, as a constant.
    const TARGET: Target;
    /// With the features in quotes and the words for tuning that the list of the kernel adds.
    #[doc(hidden)]
    const LISTED: Target;
    /// What has! looks at, and nothing else.
    #[doc(hidden)]
    const WORDS: Target = Self::LISTED;
    /// The width of the registers.
    type Native: Width<Half = Self::Half, Twice = Self::Twice> + crate::only::Registers;
    /// A register, but no more than 32 bytes.
    type Upto32: Width<Half: Width<Twice = Self::Upto32>, Twice: Width<Half = Self::Upto32>>;
    /// Half of a register.
    type Half: Width<Half = Self::Quarter, Twice = Self::Native>;
    /// A quarter.
    type Quarter: Width<Half = Self::Eighth, Twice = Self::Half>;
    /// An eighth.
    type Eighth: Width<Twice = Self::Quarter>;
    /// Two registers.
    type Twice: Width<Half = Self::Native, Twice = Self::Four>;
    /// Four.
    type Four: Width<Half = Self::Twice, Twice = Self::Eight>;
    /// Eight.
    type Eight: Width<Half = Self::Four>;

    /// How many vector registers there are. `HWY_REGISTERS`.
    const REGISTERS: usize = if cfg!(target_arch = "x86") {
        8
    } else if cfg!(target_arch = "aarch64") || Self::AVX512F {
        32
    } else {
        16
    };
}

/// For code that passes the target as a value: this crate and its tests.
#[doc(hidden)]
pub trait WithToken: Isa {
    crate::make::tables!(on_token none Self);
    crate::masks::on_token!();
    crate::over::on_token!();

    #[inline(always)]
    fn set_bit_positions<T: Unsigned>(self, bits: u64, first: T, to: &mut (impl crate::Sink<T> + ?Sized)) -> usize {
        struct Positions<S, T>(S, u64, T);
        impl<S: Isa, T: Unsigned> crate::sink::Job<T> for Positions<S, T> {
            #[inline(always)]
            fn run(self, mut to: impl crate::Place<T>) -> usize {
                let count = self.0.full::<T>().write_set_bit_indices(self.1, self.2, to.again());
                to.keep(count);
                count
            }
        }
        let to = crate::whole::takes::<T, crate::whole::Values<T, crate::B64, 64>, _>(to);
        crate::Sink::with_room(to, 64, Positions(self, bits, first))
    }

    #[inline(always)]
    fn crc32<T: Unsigned>(self, state: u32, data: T) -> u32 {
        if const { Self::A64 && !Self::CRC && Baseline::CRC } {
            return baseline().crc32(state, data);
        }
        match size_of::<T>() {
            1 => self.crc32_u8(state, data.to_u64() as u8),
            2 => self.crc32_u16(state, data.to_u64() as u16),
            4 => self.crc32_u32(state, data.to_u64() as u32),
            _ => self.crc32_u64(state, data.to_u64()),
        }
    }

    #[inline(always)]
    fn crc32c<T: Unsigned>(self, state: u32, data: T) -> u32 {
        if const { Self::A64 && !Self::CRC && Baseline::CRC } {
            return baseline().crc32c(state, data);
        }
        match size_of::<T>() {
            1 => self.crc32c_u8(state, data.to_u64() as u8),
            2 => self.crc32c_u16(state, data.to_u64() as u16),
            4 => self.crc32c_u32(state, data.to_u64() as u32),
            _ => self.crc32c_u64(state, data.to_u64()),
        }
    }

    #[inline(always)]
    fn prefix_xor(self, mut bits: u64) -> u64 {
        if const { Self::HAS_AES } {
            return self.fixed::<u64, crate::B16>().from_array([bits, 0]).carryless_mul_even(u64::MAX).get_lane();
        }
        for shift in [1, 2, 4, 8, 16, 32] {
            bits ^= bits << shift;
        }
        bits
    }

    #[inline(always)]
    fn deposit_bits<T: Unsigned>(self, bits: T, mask: T) -> T {
        crate::fields::deposit(self, bits, mask)
    }

    #[inline(always)]
    fn extract_bits<T: Unsigned>(self, bits: T, mask: T) -> T {
        crate::fields::extract(self, bits, mask)
    }

    /// Calls the closure in a function that has the instructions of the target, without dispatch. It is for code that can't have a mark.
    /// What the closure calls has to be inlined or marked.
    ///
    /// ```
    /// use bun_simd::generic::*;
    /// trait Search {
    ///     fn find(&self, text: &[u8]) -> Option<usize>;
    /// }
    /// impl<S: Isa> Search for u8xN<S> {
    ///     fn find(&self, text: &[u8]) -> Option<usize> {
    ///         self.isa().run(|| self.isa().over(text).position(|v| v.simd_eq(*self)))
    ///     }
    /// }
    /// #[kernel]
    /// fn searcher(byte: u8) -> Box<dyn Search> {
    ///     Box::new(u8xN::<S>::splat(byte))
    /// }
    /// # fn main() {
    /// assert_eq!(searcher(b'c').find(b"abc"), Some(2));
    /// # }
    /// ```
    #[doc(alias("vectorize", "target_feature"))]
    #[inline(always)]
    fn run<R>(self, f: impl FnOnce() -> R) -> R {
        struct Run;
        impl<R, F: FnOnce() -> R> Kernel<(F,)> for Run {
            type Output = R;
            #[inline(always)]
            fn run<S: Isa>(_: S, (f,): (F,)) -> R {
                f()
            }
        }
        if const { Self::TARGET.is_baseline() } { f() } else { self.enter::<Run, _>((f,)) }
    }
}
impl<S: Isa> WithToken for S {}

/// A search by name is slow where each instance of an operation evaluates it, also those in dead branches.
#[rules]
macro_rules! has { ($($name:ident $feature:literal)* ; $($other:ident = $value:expr;)*) => {
    pub(crate) trait Has { $(const $name: bool;)* $(const $other: bool;)* }
    // For the time to compile: each crate evaluates a constant again, but takes the value of a static from the metadata.
    static FEATURES: [Target; ${count($name)}] = [$(Target::of(Named::Portable, &[$feature])),*];
    impl<S: Isa> Has for S { $(const $name: bool = if S::TARGET.includes(Target::Portable) { S::TARGET.includes(FEATURES[${index()}]) } else { S::TARGET.has($feature) };)* $(const $other: bool = $value;)* }
}; }
/// A word that only targets of one architecture have.
macro_rules! word {
    ($arch:literal $word:literal) => {
        cfg!(target_arch = $arch) && S::TARGET.has_word($word)
    };
}
has! {
    AVX2 "avx2" AVX512BITALG "avx512bitalg" AVX512BW "avx512bw" AVX512CD "avx512cd" AVX512DQ "avx512dq" AVX512F "avx512f"
    AVX512FP16 "avx512fp16" AVX512VBMI "avx512vbmi" AVX512VBMI2 "avx512vbmi2" AVX512VL "avx512vl" AVX512VNNI "avx512vnni" AVX512VPOPCNTDQ "avx512vpopcntdq"
    AVXVNNI "avxvnni" AVXVNNIINT16 "avxvnniint16" BMI1 "bmi1" CRC "crc" F16C "f16c" FCMA "fcma" FHM "fhm" GFNI "gfni" LZCNT "lzcnt"
    POPCNT "popcnt" RDM "rdm" RELAXED "relaxed-simd" SSE41 "sse4.1" SSE42 "sse4.2" SSSE3 "ssse3"
    VAES "vaes" SVE "sve" SVE2 "sve2" OWN_NEON "neon";
    // Also for `Portable`: see `lent!` in arm.rs.
    NEON = S::OWN_NEON || cfg!(all(target_arch = "aarch64", target_feature = "neon", target_endian = "little", not(miri)));
    // Also for `Portable`: see `everywhere!` in wasm.rs.
    WASM = crate::WASM;
    A64 = cfg!(target_arch = "aarch64") && S::NEON;
    // On AArch64, also for `Portable`.
    ARM = cfg!(all(target_arch = "aarch64", target_feature = "neon")) || S::NEON;
    // LLVM takes vectors of booleans apart.
    VECTOR_MASKS = S::ARM;
    PORTABLE = matches!(S::TARGET, Target::Portable);
    // The program is compiled without vectors.
    SCALAR = Self::PORTABLE && !cfg!(any(target_feature = "sse2", target_feature = "neon", target_feature = "simd128", target_feature = "v", target_feature = "zve32x",
        target_feature = "lsx", target_feature = "altivec", target_feature = "vector", target_feature = "msa", target_feature = "hvx"));
    // Also for `Portable`: see `x86::lend`.
    SSE2 = crate::X86 && (!Self::PORTABLE || cfg!(all(target_feature = "sse2", not(miri))));
    ONLY_SSE2 = S::SSE2 && !S::SSE41 && !cfg!(target_feature = "sse4.1");
    // `sign_*` is `psign`, but in registers of 64 bytes.
    PSIGN = crate::X86 && S::TARGET.has_word("sse4");
    HAS_AES = S::TARGET.has_word("aes");
    HAS_BF16 = S::TARGET.has_word("bf16");
    HAS_FP16 = S::TARGET.has_word("fp16");
    HAS_FMA = S::TARGET.has_word("fma");
    HAS_MASKED_MEMORY = S::TARGET.has_word("masked");
    // A part of a vector is loaded from a slice, or stored, in one step.
    PARTIAL = S::HAS_MASKED_MEMORY;
    HAS_DOT_U8_I8 = S::TARGET.has_word("vnni") || word!("aarch64" "i8mm");
    HAS_DOT = S::TARGET.has_word("dot") || S::A64 && cfg!(all(target_feature = "crc", target_feature = "rdm", target_feature = "dotprod"));
    HAS_MUL52 = S::TARGET.has_word("ifma");
    HAS_MAT_MUL = word!("aarch64" "i8mm");
    FAST_GATHER = S::AVX512FP16 || S::AVX2 && S::LISTED.has_word("fast_gather");
    FAST_PDEP = S::LISTED.has_word("fast_pdep");
    NARROW = S::TARGET.has_word("narrow");
    HAS_SHA1 = S::TARGET.has_word("sha");
    HAS_SHA256 = S::TARGET.has_word("sha");
    HAS_SHA512 = S::TARGET.has_word("sha512");
    HAS_SM4 = S::TARGET.has_word("sm4");
}

pub(crate) trait Tags: Sized {
    #[inline(always)]
    fn full<T: Lane>(self) -> Tag<Self, T, Self::Native>
    where
        Self: Isa,
    {
        Tag::new(self)
    }
    #[inline(always)]
    #[track_caller]
    fn fixed<T: Lane, W: Width>(self) -> Tag<Self, T, W>
    where
        Self: Isa,
    {
        Tag::new(self)
    }
}
impl<S> Tags for S {}

/// A kernel by hand.
///
/// ```
/// use bun_simd::{generic::*, target::*};
/// struct Sum;
/// impl Kernel<(&[u32],)> for Sum {
///     type Output = u32;
///     #[inline(always)]
///     fn run<S: Isa>(s: S, (values,): (&[u32],)) -> u32 {
///         s.over(values).sum()
///     }
/// }
/// assert_eq!(dispatch::<Sum, _>((&[1, 2, 3][..],)), 6);
/// ```
#[diagnostic::on_unimplemented(
    message = "`{Self}` is not a kernel that takes `{Args}`",
    label = "the arguments are a tuple"
)]
pub trait Kernel<Args> {
    /// What the function returns.
    type Output;
    /// The targets that [`dispatch`](crate::dispatch) chooses from.
    const TARGETS: Targets = Targets::DEFAULT;
    #[doc(hidden)]
    const APART: bool = false;
    /// Has to be `#[inline(always)]`, or it is compiled for the baseline.
    fn run<S: Isa>(simd: S, args: Args) -> Self::Output;
}

impl Targets {
    /// [`Target::ALL`], from new to old.
    pub const ALL: Targets = Targets(&{
        let (mut all, mut i) = ([Target::Portable; Target::ALL.len() - 1], 0);
        while i < all.len() {
            all[i] = Target::ALL[all.len() - i];
            i += 1;
        }
        all
    });
}

/// The best target that the whole program is compiled for.
/// For code that is too short for a call through a table: any function can use this target at full speed.
///
/// On x86-64 without `-Ctarget-cpu` this is `sse2`, which compares, adds, converts and makes bitmasks, but has no lookup of bytes and
/// no `popcnt`. `has!(Baseline: sse4 | neon)` tells.
///
/// ```
/// use bun_simd::prelude::*;
/// fn is_ascii(block: &[u8; 16]) -> bool {
///     u8x16::<Baseline>::load(block).cast_signed().is_negative().none()
/// }
/// assert!(is_ascii(b"0123456789abcdef"));
/// ```
pub type Baseline = <Target as TokenOf<{ Target::BASELINE.named() as u8 }>>::Token;

#[doc(hidden)]
#[inline(always)]
pub fn baseline() -> Baseline {
    compiled_for()
}

struct Compiled<T>(T);
impl<T: Isa> Kernel<()> for Compiled<T> {
    type Output = Option<T>;
    const TARGETS: Targets = Targets(&[T::TARGET]);
    #[inline(always)]
    fn run<S: Isa>(simd: S, (): ()) -> Option<T> {
        (&simd as &dyn core::any::Any).downcast_ref().copied()
    }
}

#[inline(always)]
pub(crate) fn compiled_for<T: Isa>() -> T {
    crate::dispatch_static::<Compiled<T>, ()>(()).unwrap()
}

/// A function that runs on the best target that the CPU has, wherever it is called. Its body is as that of a function with [`simd`](macro@crate::simd), and its signature has no `S`.
///
/// There are also:
/// - `name::here(..)`, for marked code: a call on its target
/// - `name::baseline(..)`, a call without dispatch, which can be inlined
/// - `name::to(target, ..)` and `name::targets()`, for tests
///
/// `#[kernel(avx2, sse4, neon)]`, the path of another module, as in `#[kernel(super)]`, or `#[kernel(targets = LIST)]` after
/// `const LIST: Targets = Targets(&[target!(avx2), target!(neon)]);` replaces the list of the module, or [`Targets::DEFAULT`].
///
/// ```
/// use bun_simd::prelude::*;
/// #[kernel(avx2, sse4, neon)]
/// fn sum(values: &[u32]) -> u32 {
///     over(values).sum()
/// }
/// # fn main() {
/// assert_eq!(sum(&[1, 2, 3]), 6);
/// assert!(sum::targets().all(|target| sum::to(target, &[1, 2, 3]) == Some(6)));
/// # }
/// ```
pub use bun_simd_macros::kernel;
