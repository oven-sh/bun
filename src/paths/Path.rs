// TODO(port): requires #![feature(adt_const_params)] for enum const generics (ConstParamTy).
// Phase B: either enable the feature crate-wide or lower the const-generic enums to a
// trait-per-option encoding if nightly is unacceptable.

use core::marker::{ConstParamTy, PhantomData};
use core::mem::ManuallyDrop;

use bun_core::Environment;
use bun_paths::{
    self as path, PathBuffer, WPathBuffer, MAX_PATH_BYTES, PATH_MAX_WIDE, SEP, SEP_POSIX,
    SEP_WINDOWS,
};
use bun_str::{strings, WStr, ZStr};
use bun_sys::Fd;

// ──────────────────────────────────────────────────────────────────────────
// Options
// ──────────────────────────────────────────────────────────────────────────
//
// Zig models `Options` as a struct of comptime enum fields passed as a single
// `comptime opts: Options` parameter. Rust cannot take a struct as a const
// generic on stable, so the fields are spread as individual const-generic
// parameters on `Path` below. The `Options` namespace is kept as a module for
// the enums so diff readers can map `Options.Kind` ↔ `options::Kind`.

pub mod options {
    use super::*;

    #[derive(ConstParamTy, PartialEq, Eq, Clone, Copy, Debug)]
    pub enum Unit {
        U8,
        U16,
        Os,
    }

    #[derive(ConstParamTy, PartialEq, Eq, Clone, Copy, Debug)]
    pub enum BufType {
        Pool,
        // Stack,
        // ArrayList,
    }

    #[derive(ConstParamTy, PartialEq, Eq, Clone, Copy, Debug)]
    pub enum Kind {
        Abs,
        Rel,

        // not recommended, but useful when you don't know
        Any,
    }

    #[derive(ConstParamTy, PartialEq, Eq, Clone, Copy, Debug)]
    pub enum CheckLength {
        AssumeAlwaysLessThanMaxPath,
        CheckForGreaterThanMaxPath,
    }

    #[derive(ConstParamTy, PartialEq, Eq, Clone, Copy, Debug)]
    pub enum PathSeparators {
        Any,
        Auto,
        Posix,
        Windows,
    }

    impl PathSeparators {
        pub const fn char(self) -> u8 {
            match self {
                // Zig: @compileError("use the existing slash")
                PathSeparators::Any => panic!("use the existing slash"),
                PathSeparators::Auto => SEP,
                PathSeparators::Posix => SEP_POSIX,
                PathSeparators::Windows => SEP_WINDOWS,
            }
        }
    }

    // Zig: `pub fn pathUnit(comptime opts) type` / `notPathUnit`
    // Rust models this as a trait with an associated `Other` type; see `PathUnit` below.

    // Zig: `pub fn maxPathLength(comptime opts) usize`
    // Moved to `PathUnit::MAX_PATH` associated const; the `.assume_always_less_than_max_path`
    // arm's @compileError is enforced by simply never reading MAX_PATH in that mode.

    /// `error{MaxPathExceeded}`
    #[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error, strum::IntoStaticStr)]
    pub enum Error {
        #[error("MaxPathExceeded")]
        MaxPathExceeded,
    }

    impl From<Error> for bun_core::Error {
        fn from(e: Error) -> Self {
            bun_core::err!("MaxPathExceeded")
        }
    }

    // Zig: `pub fn ResultFn(comptime opts) fn(type) type` — returns `T` when
    // `.assume_always_less_than_max_path`, `Error!T` otherwise.
    //
    // TODO(port): Rust cannot vary a fn's return type on a const-generic value.
    // All `Result(T)` call sites below return `Result<T, Error>` unconditionally;
    // callers configured with `AssumeAlwaysLessThanMaxPath` should treat the
    // `Err` arm as unreachable. Phase B may split into two inherent impls via
    // `where` bounds on `CHECK_LENGTH` once `generic_const_exprs` lands, or
    // expose `_unchecked` variants.
    pub type Result<T> = core::result::Result<T, Error>;

    // Zig: `pub fn inputChildType(opts, InputType) type` — strips array-ness
    // off string literals to get the element type. In Rust the generic `&[C]`
    // parameter already names `C` directly, so this helper disappears.
}

use options::{BufType, CheckLength, Error as PathError, Kind, PathSeparators, Unit};

// ──────────────────────────────────────────────────────────────────────────
// PathUnit trait — replaces `opts.pathUnit()` / `opts.notPathUnit()` /
// `opts.Buf().pooled`'s type-level switch on `opts.unit`.
// ──────────────────────────────────────────────────────────────────────────

/// A path code unit: `u8` (UTF-8/WTF-8 bytes) or `u16` (WTF-16, Windows).
pub trait PathUnit: Copy + Eq + 'static {
    /// `opts.notPathUnit()`
    type Other: PathUnit;
    /// The fixed-size buffer type (`PathBuffer` / `WPathBuffer`).
    type Buffer: 'static;
    /// `opts.maxPathLength()` for this unit.
    const MAX_PATH: usize;
    /// `[:0]const u8` → `ZStr`, `[:0]const u16` → `WStr` (length-carrying NUL-terminated slice).
    type ZSlice: ?Sized;

    fn from_ascii(c: u8) -> Self;
    fn eq_ascii(self, c: u8) -> bool;
    /// Return `Some(b)` if this code unit is in the ASCII range (`<= 0x7F`), else `None`.
    fn to_ascii(self) -> Option<u8>;

    /// Construct a borrowed NUL-terminated slice (`ZStr` / `WStr`) from a raw pointer + len.
    ///
    /// # Safety
    /// `ptr[..=len]` must be valid for reads for `'a`, and `ptr[len]` must be `0`.
    unsafe fn zslice_from_raw<'a>(ptr: *const Self, len: usize) -> &'a Self::ZSlice;

    /// `bun.path_buffer_pool.get()` / `bun.w_path_buffer_pool.get()`
    // LIFETIMES.tsv classifies `Buf.pooled` as OWNED → Box<PathBuffer>; the
    // underlying pool hands out heap buffers and reclaims them in `deinit`.
    // TODO(port): swap to `bun_paths::path_buffer_pool()` RAII guard once the
    // guard type is generic over unit; for now model as Box and put-back in Drop.
    fn pool_get() -> Box<Self::Buffer>;
    fn pool_put(buf: Box<Self::Buffer>);

    fn buffer_as_mut_slice(buf: &mut Self::Buffer) -> &mut [Self];
    fn buffer_as_slice(buf: &Self::Buffer) -> &[Self];
}

impl PathUnit for u8 {
    type Other = u16;
    type Buffer = PathBuffer;
    const MAX_PATH: usize = MAX_PATH_BYTES;
    type ZSlice = ZStr;

    #[inline]
    fn from_ascii(c: u8) -> Self {
        c
    }
    #[inline]
    fn eq_ascii(self, c: u8) -> bool {
        self == c
    }
    #[inline]
    fn to_ascii(self) -> Option<u8> {
        Some(self)
    }
    #[inline]
    unsafe fn zslice_from_raw<'a>(ptr: *const u8, len: usize) -> &'a ZStr {
        ZStr::from_raw(ptr, len)
    }
    fn pool_get() -> Box<PathBuffer> {
        bun_paths::path_buffer_pool::get()
    }
    fn pool_put(buf: Box<PathBuffer>) {
        bun_paths::path_buffer_pool::put(buf)
    }
    #[inline]
    fn buffer_as_mut_slice(buf: &mut PathBuffer) -> &mut [u8] {
        &mut buf[..]
    }
    #[inline]
    fn buffer_as_slice(buf: &PathBuffer) -> &[u8] {
        &buf[..]
    }
}

impl PathUnit for u16 {
    type Other = u8;
    type Buffer = WPathBuffer;
    const MAX_PATH: usize = PATH_MAX_WIDE;
    type ZSlice = WStr;

    #[inline]
    fn from_ascii(c: u8) -> Self {
        c as u16
    }
    #[inline]
    fn eq_ascii(self, c: u8) -> bool {
        self == c as u16
    }
    #[inline]
    fn to_ascii(self) -> Option<u8> {
        u8::try_from(self).ok()
    }
    #[inline]
    unsafe fn zslice_from_raw<'a>(ptr: *const u16, len: usize) -> &'a WStr {
        WStr::from_raw(ptr, len)
    }
    fn pool_get() -> Box<WPathBuffer> {
        bun_paths::w_path_buffer_pool::get()
    }
    fn pool_put(buf: Box<WPathBuffer>) {
        bun_paths::w_path_buffer_pool::put(buf)
    }
    #[inline]
    fn buffer_as_mut_slice(buf: &mut WPathBuffer) -> &mut [u16] {
        &mut buf[..]
    }
    #[inline]
    fn buffer_as_slice(buf: &WPathBuffer) -> &[u16] {
        &buf[..]
    }
}

/// `Unit::Os` — resolves to `u16` on Windows, `u8` elsewhere.
#[cfg(windows)]
pub type OsUnit = u16;
#[cfg(not(windows))]
pub type OsUnit = u8;

// ──────────────────────────────────────────────────────────────────────────
// Buf — `opts.Buf()` (only the `.pool` variant is implemented in Zig)
// ──────────────────────────────────────────────────────────────────────────

pub struct Buf<U: PathUnit, const SEP_OPT: PathSeparators> {
    // LIFETIMES.tsv: OWNED → Box<PathBuffer> (pool.get() in init(); pool.put() in deinit()).
    // Wrapped in ManuallyDrop so `Path::drop` can move the Box back into the pool
    // without leaving a dangling Box behind for the field destructor.
    pooled: ManuallyDrop<Box<U::Buffer>>,
    len: usize,
}

impl<U: PathUnit, const SEP_OPT: PathSeparators> Buf<U, SEP_OPT> {
    #[inline]
    pub fn set_length(&mut self, new_len: usize) {
        self.len = new_len;
    }

    /// Append `characters` (same code-unit width as `U`), optionally prefixing a separator.
    pub fn append(&mut self, characters: &[U], add_separator: bool) {
        let buf = U::buffer_as_mut_slice(&mut self.pooled);
        if add_separator {
            buf[self.len] = match SEP_OPT {
                PathSeparators::Any | PathSeparators::Auto => U::from_ascii(SEP),
                PathSeparators::Posix => U::from_ascii(SEP_POSIX),
                PathSeparators::Windows => U::from_ascii(SEP_WINDOWS),
            };
            self.len += 1;
        }

        // opts.inputChildType(@TypeOf(characters)) == opts.pathUnit() — same-unit branch.
        match SEP_OPT {
            PathSeparators::Any => {
                buf[self.len..][..characters.len()].copy_from_slice(characters);
                self.len += characters.len();
            }
            PathSeparators::Auto | PathSeparators::Posix | PathSeparators::Windows => {
                for &c in characters {
                    buf[self.len] = if c.eq_ascii(b'/') || c.eq_ascii(b'\\') {
                        U::from_ascii(SEP_OPT.char())
                    } else {
                        c
                    };
                    self.len += 1;
                }
            }
        }
    }

    /// Append `characters` of the *other* code-unit width, transcoding into the buffer.
    pub fn append_other(&mut self, characters: &[U::Other], add_separator: bool) {
        let buf = U::buffer_as_mut_slice(&mut self.pooled);
        if add_separator {
            buf[self.len] = match SEP_OPT {
                PathSeparators::Any | PathSeparators::Auto => U::from_ascii(SEP),
                PathSeparators::Posix => U::from_ascii(SEP_POSIX),
                PathSeparators::Windows => U::from_ascii(SEP_WINDOWS),
            };
            self.len += 1;
        }

        // TODO(port): the Zig branches on `opts.inputChildType(@TypeOf(characters))` to pick
        // convertUTF8toUTF16InBuffer vs convertUTF16toUTF8InBuffer. Rust cannot match on a
        // type parameter at runtime; route through a helper trait in Phase B. For now this
        // dispatches via TypeId-equivalent specialization on the two concrete impls.
        let converted_len = convert_into_buffer::<U>(&mut buf[self.len..], characters);
        if SEP_OPT != PathSeparators::Any {
            for off in 0..converted_len {
                let c = buf[self.len + off];
                if c.eq_ascii(b'/') || c.eq_ascii(b'\\') {
                    buf[self.len + off] = U::from_ascii(SEP_OPT.char());
                }
            }
        }
        self.len += converted_len;
    }

    #[allow(dead_code)]
    fn convert_append(&mut self, _characters: &[U::Other]) {
        // Intentionally empty — Zig body is fully commented out.
    }
}

// TODO(port): proper trait-based dispatch for cross-width conversion; this is a
// placeholder mirroring the two Zig arms (u8→u16 / u16→u8).
fn convert_into_buffer<U: PathUnit>(dest: &mut [U], src: &[U::Other]) -> usize {
    // SAFETY: U is exactly u8 or u16; both arms are covered below via transmute of slices.
    // Phase B: replace with a sealed-trait method on PathUnit.
    use core::any::TypeId;
    if TypeId::of::<U>() == TypeId::of::<u16>() {
        // src: &[u8], dest: &mut [u16]
        let dest: &mut [u16] = unsafe { core::mem::transmute(dest) };
        let src: &[u8] = unsafe { core::mem::transmute(src) };
        strings::convert_utf8_to_utf16_in_buffer(dest, src).len()
    } else {
        // src: &[u16], dest: &mut [u8]
        let dest: &mut [u8] = unsafe { core::mem::transmute(dest) };
        let src: &[u16] = unsafe { core::mem::transmute(src) };
        strings::convert_utf16_to_utf8_in_buffer(dest, src)
            .expect("unreachable")
            .len()
    }
}

// ──────────────────────────────────────────────────────────────────────────
// AbsPath / RelPath / Path
// ──────────────────────────────────────────────────────────────────────────

/// `AbsPath(opts)` — forces `kind = .abs`.
pub type AbsPath<
    U = u8,
    const SEP_OPT: PathSeparators = { PathSeparators::Any },
    const CHECK: CheckLength = { CheckLength::AssumeAlwaysLessThanMaxPath },
> = Path<U, { Kind::Abs }, SEP_OPT, CHECK>;

/// `Path(.{ .kind = .abs, .sep = .auto })`
pub type AutoAbsPath = Path<u8, { Kind::Abs }, { PathSeparators::Auto }>;

/// `RelPath(opts)` — forces `kind = .rel`.
pub type RelPath<
    U = u8,
    const SEP_OPT: PathSeparators = { PathSeparators::Any },
    const CHECK: CheckLength = { CheckLength::AssumeAlwaysLessThanMaxPath },
> = Path<U, { Kind::Rel }, SEP_OPT, CHECK>;

/// `Path(.{ .kind = .rel, .sep = .auto })`
pub type AutoRelPath = Path<u8, { Kind::Rel }, { PathSeparators::Auto }>;

/// `Path(comptime opts: Options) type`
///
/// `BufType` is omitted as a parameter because only `.pool` is implemented in Zig.
/// `Unit` is encoded as the type parameter `U: PathUnit` (use `u8`, `u16`, or `OsUnit`).
pub struct Path<
    U: PathUnit = u8,
    const KIND: Kind = { Kind::Any },
    const SEP_OPT: PathSeparators = { PathSeparators::Any },
    const CHECK: CheckLength = { CheckLength::AssumeAlwaysLessThanMaxPath },
> {
    _buf: Buf<U, SEP_OPT>,
    _unit: PhantomData<U>,
}

impl<U: PathUnit, const KIND: Kind, const SEP_OPT: PathSeparators, const CHECK: CheckLength>
    Path<U, KIND, SEP_OPT, CHECK>
{
    pub fn init() -> Self {
        // match BufType::Pool
        Self {
            _buf: Buf {
                pooled: ManuallyDrop::new(U::pool_get()),
                len: 0,
            },
            _unit: PhantomData,
        }
    }

    // `deinit` → impl Drop (below). Body returns the buffer to the pool.

    /// `move` — transfers ownership; in Rust this is just by-value move, but kept
    /// for call-site parity with the Zig (`const moved = this.move();`).
    #[inline]
    pub fn move_(self) -> Self {
        self
    }

    pub fn init_top_level_dir() -> Self {
        debug_assert!(bun_fs::FileSystem::instance_loaded());
        let top_level_dir = bun_fs::FileSystem::instance().top_level_dir();

        let trimmed = match KIND {
            Kind::Abs => {
                debug_assert!(is_input_absolute(top_level_dir));
                trim_input(TrimInputKind::Abs, top_level_dir)
            }
            // Zig: @compileError("cannot create a relative path from top_level_dir")
            Kind::Rel => panic!("cannot create a relative path from top_level_dir"),
            Kind::Any => trim_input(TrimInputKind::Abs, top_level_dir),
        };

        let mut this = Self::init();
        // TODO(port): top_level_dir is &[u8]; when U == u16 this should route through
        // append_other. See note on `append_input` below.
        this._buf_append_input(trimmed, false);
        this
    }

    pub fn init_top_level_dir_long_path() -> Self {
        debug_assert!(bun_fs::FileSystem::instance_loaded());
        let top_level_dir = bun_fs::FileSystem::instance().top_level_dir();

        let trimmed = match KIND {
            Kind::Abs => {
                debug_assert!(is_input_absolute(top_level_dir));
                trim_input(TrimInputKind::Abs, top_level_dir)
            }
            Kind::Rel => panic!("cannot create a relative path from top_level_dir"),
            Kind::Any => trim_input(TrimInputKind::Abs, top_level_dir),
        };

        let mut this = Self::init();

        #[cfg(windows)]
        {
            // TODO(port): pick long_path_prefix vs long_path_prefix_u8 based on U.
            // Both are exposed from bun_sys::windows.
            this._buf_append_input(bun_sys::windows::long_path_prefix_for::<U>(), false);
        }

        this._buf_append_input(trimmed, false);

        this
    }

    pub fn init_fd_path(fd: Fd) -> Result<Self, bun_core::Error> {
        match KIND {
            Kind::Abs => {}
            Kind::Rel => panic!("cannot create a relative path from getFdPath"),
            Kind::Any => {}
        }

        let mut this = Self::init();
        // match BufType::Pool
        {
            let buf = U::buffer_as_mut_slice(&mut this._buf.pooled);
            // TODO(port): narrow error set
            let raw = fd.get_fd_path(buf)?;
            let trimmed = trim_input(TrimInputKind::Abs, raw);
            this._buf.len = trimmed.len();
        }

        Ok(this)
    }

    pub fn from_long_path<C: PathUnit>(input: &[C]) -> options::Result<Self> {
        // Zig restricts @TypeOf(input) to u8/u16 slices; the `C: PathUnit` bound enforces that.
        let trimmed = match KIND {
            Kind::Abs => {
                debug_assert!(is_input_absolute(input));
                trim_input(TrimInputKind::Abs, input)
            }
            Kind::Rel => {
                debug_assert!(!is_input_absolute(input));
                trim_input(TrimInputKind::Rel, input)
            }
            Kind::Any => trim_input(
                if is_input_absolute(input) {
                    TrimInputKind::Abs
                } else {
                    TrimInputKind::Rel
                },
                input,
            ),
        };

        if CHECK == CheckLength::CheckForGreaterThanMaxPath {
            if trimmed.len() >= U::MAX_PATH {
                return Err(PathError::MaxPathExceeded);
            }
        }

        let mut this = Self::init();
        #[cfg(windows)]
        {
            this._buf_append_input(bun_sys::windows::long_path_prefix_for::<U>(), false);
        }

        this._buf_append_input(trimmed, false);
        Ok(this)
    }

    pub fn from<C: PathUnit>(input: &[C]) -> options::Result<Self> {
        let trimmed = match KIND {
            Kind::Abs => {
                debug_assert!(is_input_absolute(input));
                trim_input(TrimInputKind::Abs, input)
            }
            Kind::Rel => {
                debug_assert!(!is_input_absolute(input));
                trim_input(TrimInputKind::Rel, input)
            }
            Kind::Any => trim_input(
                if is_input_absolute(input) {
                    TrimInputKind::Abs
                } else {
                    TrimInputKind::Rel
                },
                input,
            ),
        };

        if CHECK == CheckLength::CheckForGreaterThanMaxPath {
            if trimmed.len() >= U::MAX_PATH {
                return Err(PathError::MaxPathExceeded);
            }
        }

        let mut this = Self::init();
        this._buf_append_input(trimmed, false);
        Ok(this)
    }

    pub fn is_absolute(&self) -> bool {
        match KIND {
            // Zig: @compileError — Rust can't compile-error on a const-generic value
            // without specialization; debug-panic instead.
            Kind::Abs => panic!("already known to be absolute"),
            Kind::Rel => panic!("already known to not be absolute"),
            Kind::Any => is_input_absolute(self.slice()),
        }
    }

    pub fn basename(&self) -> &[U] {
        strings::basename(self.slice())
    }

    pub fn basename_z(&mut self) -> &U::ZSlice {
        // PORT NOTE: reshaped for borrowck (Zig took *const and wrote NUL via @constCast).
        let len = self._buf.len;
        let buf = U::buffer_as_mut_slice(&mut self._buf.pooled);
        buf[len] = U::from_ascii(0);
        let base = strings::basename(&buf[..len]);
        // SAFETY: `base` is a suffix of `buf[..len]`, and `buf[len] == 0` was written above.
        unsafe { U::zslice_from_raw(base.as_ptr(), base.len()) }
    }

    pub fn dirname(&self) -> Option<&[U]> {
        bun_paths::Dirname::dirname(self.slice())
    }

    pub fn slice(&self) -> &[U] {
        // match BufType::Pool
        &U::buffer_as_slice(&self._buf.pooled)[..self._buf.len]
    }

    pub fn slice_z(&mut self) -> &U::ZSlice {
        // match BufType::Pool
        // PORT NOTE: reshaped for borrowck (Zig took *const and wrote NUL via @constCast).
        let len = self._buf.len;
        let buf = U::buffer_as_mut_slice(&mut self._buf.pooled);
        buf[len] = U::from_ascii(0);
        // SAFETY: buf[len] == 0 written above; buf outlives the returned borrow.
        unsafe { U::zslice_from_raw(buf.as_ptr(), len) }
    }

    pub fn buf(&mut self) -> &mut [U] {
        // match BufType::Pool
        // PORT NOTE: reshaped for borrowck (Zig took *const and handed out a mutable slice).
        U::buffer_as_mut_slice(&mut self._buf.pooled)
    }

    pub fn set_length(&mut self, new_length: usize) {
        self._buf.set_length(new_length);

        let trimmed_len = match KIND {
            Kind::Abs => trim_input(TrimInputKind::Abs, self.slice()).len(),
            Kind::Rel => trim_input(TrimInputKind::Rel, self.slice()).len(),
            Kind::Any => {
                if self.is_absolute() {
                    trim_input(TrimInputKind::Abs, self.slice()).len()
                } else {
                    trim_input(TrimInputKind::Rel, self.slice()).len()
                }
            }
        };

        self._buf.set_length(trimmed_len);
    }

    #[inline]
    pub fn len(&self) -> usize {
        // match BufType::Pool
        self._buf.len
    }

    pub fn clone(&self) -> Self {
        // match BufType::Pool
        let mut cloned = Self::init();
        let len = self._buf.len;
        U::buffer_as_mut_slice(&mut cloned._buf.pooled)[..len]
            .copy_from_slice(&U::buffer_as_slice(&self._buf.pooled)[..len]);
        cloned._buf.len = len;
        cloned
    }

    #[inline]
    pub fn clear(&mut self) {
        self._buf.set_length(0);
    }

    pub fn append<C: PathUnit>(&mut self, input: &[C]) -> options::Result<()> {
        let needs_sep = self.len() > 0
            && match SEP_OPT {
                PathSeparators::Any => {
                    let last = self.slice()[self.len() - 1];
                    !(last.eq_ascii(b'/') || last.eq_ascii(b'\\'))
                }
                _ => !self.slice()[self.len() - 1].eq_ascii(SEP_OPT.char()),
            };

        match KIND {
            Kind::Abs => {
                let has_root = self.len() > 0;

                if cfg!(debug_assertions) {
                    if has_root {
                        debug_assert!(!is_input_absolute(input));
                    } else {
                        debug_assert!(is_input_absolute(input));
                    }
                }

                let trimmed = trim_input(
                    if has_root {
                        TrimInputKind::Rel
                    } else {
                        TrimInputKind::Abs
                    },
                    input,
                );

                if trimmed.is_empty() {
                    return Ok(());
                }

                if CHECK == CheckLength::CheckForGreaterThanMaxPath {
                    if self.len() + trimmed.len() + (needs_sep as usize) >= U::MAX_PATH {
                        return Err(PathError::MaxPathExceeded);
                    }
                }

                self._buf_append_input(trimmed, needs_sep);
            }
            Kind::Rel => {
                debug_assert!(!is_input_absolute(input));

                let trimmed = trim_input(TrimInputKind::Rel, input);

                if trimmed.is_empty() {
                    return Ok(());
                }

                if CHECK == CheckLength::CheckForGreaterThanMaxPath {
                    if self.len() + trimmed.len() + (needs_sep as usize) >= U::MAX_PATH {
                        return Err(PathError::MaxPathExceeded);
                    }
                }

                self._buf_append_input(trimmed, needs_sep);
            }
            Kind::Any => {
                let input_is_absolute = is_input_absolute(input);

                if cfg!(debug_assertions) {
                    if needs_sep {
                        debug_assert!(!input_is_absolute);
                    }
                }

                let trimmed = trim_input(
                    if self.len() > 0 {
                        // anything appended to an existing path should be trimmed
                        // as a relative path
                        TrimInputKind::Rel
                    } else if is_input_absolute(input) {
                        // path is empty, trim based on input
                        TrimInputKind::Abs
                    } else {
                        TrimInputKind::Rel
                    },
                    input,
                );

                if trimmed.is_empty() {
                    return Ok(());
                }

                if CHECK == CheckLength::CheckForGreaterThanMaxPath {
                    if self.len() + trimmed.len() + (needs_sep as usize) >= U::MAX_PATH {
                        return Err(PathError::MaxPathExceeded);
                    }
                }

                self._buf_append_input(trimmed, needs_sep);
            }
        }
        Ok(())
    }

    pub fn append_fmt(&mut self, args: core::fmt::Arguments<'_>) -> options::Result<()> {
        // TODO: there's probably a better way to do this. needed for trimming slashes
        let mut temp: Path<u8, { Kind::Any }, { PathSeparators::Any }> = Path::init();

        // match BufType::Pool
        let input = {
            use std::io::Write;
            let buf = u8::buffer_as_mut_slice(&mut temp._buf.pooled);
            let mut cursor: &mut [u8] = buf;
            let total = cursor.len();
            match cursor.write_fmt(args) {
                Ok(()) => {
                    let written = total - cursor.len();
                    &u8::buffer_as_slice(&temp._buf.pooled)[..written]
                }
                Err(_) => {
                    if CHECK == CheckLength::CheckForGreaterThanMaxPath {
                        return Err(PathError::MaxPathExceeded);
                    }
                    unreachable!();
                }
            }
        };

        self.append(input)
    }

    pub fn join(&mut self, parts: &[&[U]]) -> options::Result<()> {
        // TODO(port): Zig @compileError when unit == u16; enforced here at runtime.
        if core::any::TypeId::of::<U>() == core::any::TypeId::of::<u16>() {
            panic!("unsupported unit type");
        }

        match KIND {
            Kind::Abs => {}
            Kind::Rel => panic!("cannot join with relative path"),
            Kind::Any => {
                debug_assert!(self.is_absolute());
            }
        }

        let cloned = self.clone();

        // match BufType::Pool
        {
            // SAFETY: TypeId check above proves U == u8; transmute is an identity slice cast.
            let pooled: &mut [u8] = unsafe {
                core::mem::transmute(U::buffer_as_mut_slice(&mut self._buf.pooled))
            };
            // SAFETY: TypeId check above proves U == u8; identity slice cast.
            let cloned_slice: &[u8] = unsafe { core::mem::transmute(cloned.slice()) };
            // SAFETY: TypeId check above proves U == u8; &[&[U]] and &[&[u8]] have identical layout.
            let parts_u8: &[&[u8]] = unsafe { core::mem::transmute(parts) };
            let joined = path::join_abs_string_buf(
                cloned_slice,
                pooled,
                parts_u8,
                match SEP_OPT {
                    PathSeparators::Any | PathSeparators::Auto => path::Platform::Auto,
                    PathSeparators::Posix => path::Platform::Posix,
                    PathSeparators::Windows => path::Platform::Windows,
                },
            );

            let trimmed = trim_input(TrimInputKind::Abs, joined);
            self._buf.len = trimmed.len();
        }
        Ok(())
    }

    pub fn append_join<C: PathUnit>(&mut self, part: &[C]) -> options::Result<()> {
        match KIND {
            Kind::Abs => {}
            Kind::Rel => panic!("cannot join with relative path"),
            Kind::Any => {
                debug_assert!(self.is_absolute());
            }
        }

        // TODO(port): the Zig dispatches on `@TypeOf(part)` × `opts.pathUnit()` to pick
        // joinStringBuf vs joinStringBufW vs a transcode-then-recurse path. Rust cannot
        // match on type identity in a fn body without specialization. The four arms are
        // reproduced below via TypeId checks; Phase B should replace with a sealed-trait
        // dispatch on (C, U).
        use core::any::TypeId;
        let c_is_u8 = TypeId::of::<C>() == TypeId::of::<u8>();
        let u_is_u8 = TypeId::of::<U>() == TypeId::of::<u8>();

        match (c_is_u8, u_is_u8) {
            (true, true) => {
                // part: &[u8], unit: u8
                let cwd_path_buf = bun_paths::path_buffer_pool::get();
                // RAII guard puts back on Drop.
                // SAFETY: TypeId check above proves U == u8; transmute is an identity slice cast.
                let current_slice: &[u8] = unsafe { core::mem::transmute(self.slice()) };
                let cwd_path = &mut cwd_path_buf[..current_slice.len()];
                cwd_path.copy_from_slice(current_slice);

                // SAFETY: TypeId check above proves U == u8; identity slice cast.
                let pooled: &mut [u8] =
                    unsafe { core::mem::transmute(U::buffer_as_mut_slice(&mut self._buf.pooled)) };
                // SAFETY: TypeId check above proves C == u8; identity slice cast.
                let part_u8: &[u8] = unsafe { core::mem::transmute(part) };
                let joined = path::join_string_buf(
                    pooled,
                    &[cwd_path, part_u8],
                    match SEP_OPT {
                        PathSeparators::Any | PathSeparators::Auto => path::Platform::Auto,
                        PathSeparators::Posix => path::Platform::Posix,
                        PathSeparators::Windows => path::Platform::Windows,
                    },
                );

                let trimmed = trim_input(TrimInputKind::Abs, joined);
                self._buf.len = trimmed.len();
            }
            (true, false) => {
                // part: &[u8], unit: u16 → transcode then recurse
                let path_buf = bun_paths::w_path_buffer_pool::get();
                // SAFETY: TypeId check above proves C == u8; identity slice cast.
                let part_u8: &[u8] = unsafe { core::mem::transmute(part) };
                let converted = strings::convert_utf8_to_utf16_in_buffer(&mut path_buf[..], part_u8);
                // TODO(port): recursive call with C=u16; the Zig recurses on `appendJoin(converted)`.
                // SAFETY: TypeId check above proves U == u16; &[u16] → &[u16] identity cast for the
                // monomorphized recursion arm.
                return self.append_join_u16(unsafe { core::mem::transmute(converted) });
            }
            (false, false) => {
                // part: &[u16], unit: u16
                let cwd_path_buf = bun_paths::w_path_buffer_pool::get();
                // SAFETY: TypeId check above proves U == u16; identity slice cast.
                let current_slice: &[u16] = unsafe { core::mem::transmute(self.slice()) };
                let cwd_path = &mut cwd_path_buf[..current_slice.len()];
                cwd_path.copy_from_slice(current_slice);

                // SAFETY: TypeId check above proves U == u16; identity slice cast.
                let pooled: &mut [u16] =
                    unsafe { core::mem::transmute(U::buffer_as_mut_slice(&mut self._buf.pooled)) };
                // SAFETY: TypeId check above proves C == u16; identity slice cast.
                let part_u16: &[u16] = unsafe { core::mem::transmute(part) };
                let joined = path::join_string_buf_w(
                    pooled,
                    &[cwd_path, part_u16],
                    match SEP_OPT {
                        PathSeparators::Any | PathSeparators::Auto => path::Platform::Auto,
                        PathSeparators::Posix => path::Platform::Posix,
                        PathSeparators::Windows => path::Platform::Windows,
                    },
                );

                let trimmed = trim_input(TrimInputKind::Abs, joined);
                self._buf.len = trimmed.len();
            }
            (false, true) => {
                // part: &[u16], unit: u8 → transcode then recurse
                let path_buf = bun_paths::path_buffer_pool::get();
                // SAFETY: TypeId check above proves C == u16; identity slice cast.
                let part_u16: &[u16] = unsafe { core::mem::transmute(part) };
                let converted =
                    match strings::convert_utf16_to_utf8_in_buffer(&mut path_buf[..], part_u16) {
                        Ok(c) => c,
                        Err(_) => return Err(PathError::MaxPathExceeded),
                    };
                return self.append_join(converted);
            }
        }
        Ok(())
    }

    // TODO(port): helper for the (part:u8, unit:u16) recursion arm above; collapse
    // into trait dispatch in Phase B.
    fn append_join_u16(&mut self, part: &[u16]) -> options::Result<()> {
        self.append_join(part)
    }

    pub fn relative<const K2: Kind>(
        &self,
        to: &Path<U, K2, SEP_OPT, CHECK>,
    ) -> RelPath<U, SEP_OPT, CHECK> {
        // match BufType::Pool
        let mut output: RelPath<U, SEP_OPT, CHECK> = Path::init();
        let rel = path::relative_buf_z(
            U::buffer_as_mut_slice(&mut output._buf.pooled),
            self.slice(),
            to.slice(),
        );
        let trimmed = trim_input(TrimInputKind::Rel, rel);
        output._buf.len = trimmed.len();
        output
    }

    pub fn undo(&mut self, n_components: usize) {
        let min_len = match KIND {
            Kind::Abs => root_len(self.slice()).unwrap_or(0),
            Kind::Rel => 0,
            Kind::Any => {
                if self.is_absolute() {
                    root_len(self.slice()).unwrap_or(0)
                } else {
                    0
                }
            }
        };

        let mut i: usize = 0;
        while i < n_components {
            let slash = match SEP_OPT {
                PathSeparators::Any => self
                    .slice()
                    .iter()
                    .rposition(|c| c.eq_ascii(SEP_POSIX) || c.eq_ascii(SEP_WINDOWS)),
                PathSeparators::Auto => self.slice().iter().rposition(|c| c.eq_ascii(SEP)),
                PathSeparators::Posix => self.slice().iter().rposition(|c| c.eq_ascii(SEP_POSIX)),
                PathSeparators::Windows => {
                    self.slice().iter().rposition(|c| c.eq_ascii(SEP_WINDOWS))
                }
            };
            let Some(slash) = slash else {
                self._buf.set_length(min_len);
                return;
            };

            if slash < min_len {
                self._buf.set_length(min_len);
                return;
            }

            self._buf.set_length(slash);
            i += 1;
        }
    }

    pub fn save(&mut self) -> ResetScope<'_, U, KIND, SEP_OPT, CHECK> {
        let saved_len = self.len();
        ResetScope {
            path: self,
            saved_len,
        }
    }

    // ── private helpers ──────────────────────────────────────────────────

    /// Dispatch `Buf::append` / `Buf::append_other` based on whether the input
    /// element type matches `U`. Stands in for Zig's `anytype` + `inputChildType`.
    fn _buf_append_input<C: PathUnit>(&mut self, characters: &[C], add_separator: bool) {
        use core::any::TypeId;
        if TypeId::of::<C>() == TypeId::of::<U>() {
            // SAFETY: C and U are the same 'static type per TypeId check.
            let characters: &[U] = unsafe {
                core::slice::from_raw_parts(characters.as_ptr() as *const U, characters.len())
            };
            self._buf.append(characters, add_separator);
        } else {
            // SAFETY: C is exactly U::Other (PathUnit has only two impls: u8/u16).
            let characters: &[U::Other] = unsafe {
                core::slice::from_raw_parts(
                    characters.as_ptr() as *const U::Other,
                    characters.len(),
                )
            };
            self._buf.append_other(characters, add_separator);
        }
    }
}

impl<U: PathUnit, const KIND: Kind, const SEP_OPT: PathSeparators, const CHECK: CheckLength> Drop
    for Path<U, KIND, SEP_OPT, CHECK>
{
    fn drop(&mut self) {
        // match BufType::Pool
        // SAFETY: `pooled` is initialized in `init()` and never taken before this; Drop runs once.
        let pooled = unsafe { ManuallyDrop::take(&mut self._buf.pooled) };
        U::pool_put(pooled);
        // TODO(port): replace Box<Buffer> + manual put-back with the
        // `bun_paths::path_buffer_pool()` RAII guard once it is generic over
        // unit, then delete this Drop impl entirely.
    }
}

// ──────────────────────────────────────────────────────────────────────────
// ResetScope
// ──────────────────────────────────────────────────────────────────────────

pub struct ResetScope<
    'a,
    U: PathUnit,
    const KIND: Kind,
    const SEP_OPT: PathSeparators,
    const CHECK: CheckLength,
> {
    // LIFETIMES.tsv: BORROW_PARAM → &'a mut Path
    path: &'a mut Path<U, KIND, SEP_OPT, CHECK>,
    saved_len: usize,
}

impl<'a, U: PathUnit, const KIND: Kind, const SEP_OPT: PathSeparators, const CHECK: CheckLength>
    ResetScope<'a, U, KIND, SEP_OPT, CHECK>
{
    pub fn restore(&mut self) {
        // PORT NOTE: reshaped for borrowck — Zig takes `*const ResetScope` and
        // mutates through the stored `*Path`; in Rust the reborrow is `&mut self`.
        self.path._buf.set_length(self.saved_len);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Free functions (were nested in `Path(opts)` but don't depend on opts beyond
// the input element type, so they're hoisted to generics over `C: PathUnit`)
// ──────────────────────────────────────────────────────────────────────────

pub fn root_len<C: PathUnit>(input: &[C]) -> Option<usize> {
    #[cfg(windows)]
    {
        if input.len() > 2
            && input[1].eq_ascii(b':')
            && (input[2].eq_ascii(b'/') || input[2].eq_ascii(b'\\'))
        {
            // ('a' <= letter and letter <= 'z') or ('A' <= letter and letter <= 'Z')
            if let Some(l) = input[0].to_ascii() {
                if (b'a'..=b'z').contains(&l) || (b'A'..=b'Z').contains(&l) {
                    // C:\
                    return Some(3);
                }
            }
        }

        if input.len() > 5
            && (input[0].eq_ascii(b'/') || input[0].eq_ascii(b'\\'))
            && (input[1].eq_ascii(b'/') || input[1].eq_ascii(b'\\'))
            && !(input[2].eq_ascii(b'\\') || input[2].eq_ascii(b'.'))
        {
            let mut i: usize = 3;
            // \\network\share\
            //   ^
            while i < input.len() && !(input[i].eq_ascii(b'/') || input[i].eq_ascii(b'\\')) {
                i += 1;
            }

            i += 1;
            // \\network\share\
            //           ^
            let start = i;
            while i < input.len() && !(input[i].eq_ascii(b'/') || input[i].eq_ascii(b'\\')) {
                i += 1;
            }

            if start != i
                && i < input.len()
                && (input[i].eq_ascii(b'/') || input[i].eq_ascii(b'\\'))
            {
                // \\network\share\
                //                ^
                if i + 1 < input.len() {
                    return Some(i + 1);
                }
                return Some(i);
            }
        }

        if !input.is_empty() && (input[0].eq_ascii(b'/') || input[0].eq_ascii(b'\\')) {
            // \
            return Some(1);
        }

        return None;
    }

    #[cfg(not(windows))]
    {
        if !input.is_empty() && input[0].eq_ascii(b'/') {
            // /
            return Some(1);
        }

        None
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum TrimInputKind {
    Abs,
    Rel,
}

fn trim_input<C: PathUnit>(kind: TrimInputKind, input: &[C]) -> &[C] {
    let mut trimmed: &[C] = input;

    #[cfg(windows)]
    {
        match kind {
            TrimInputKind::Abs => {
                let root = root_len(input).unwrap_or(0);
                while trimmed.len() > root
                    && (trimmed[trimmed.len() - 1].eq_ascii(b'/')
                        || trimmed[trimmed.len() - 1].eq_ascii(b'\\'))
                {
                    trimmed = &trimmed[..trimmed.len() - 1];
                }
            }
            TrimInputKind::Rel => {
                if trimmed.len() > 1 && trimmed[0].eq_ascii(b'.') {
                    let c = trimmed[1];
                    if c.eq_ascii(b'/') || c.eq_ascii(b'\\') {
                        trimmed = &trimmed[2..];
                    }
                }
                while !trimmed.is_empty()
                    && (trimmed[0].eq_ascii(b'/') || trimmed[0].eq_ascii(b'\\'))
                {
                    trimmed = &trimmed[1..];
                }
                while !trimmed.is_empty()
                    && (trimmed[trimmed.len() - 1].eq_ascii(b'/')
                        || trimmed[trimmed.len() - 1].eq_ascii(b'\\'))
                {
                    trimmed = &trimmed[..trimmed.len() - 1];
                }
            }
        }

        return trimmed;
    }

    #[cfg(not(windows))]
    {
        match kind {
            TrimInputKind::Abs => {
                let root = root_len(input).unwrap_or(0);
                while trimmed.len() > root && trimmed[trimmed.len() - 1].eq_ascii(b'/') {
                    trimmed = &trimmed[..trimmed.len() - 1];
                }
            }
            TrimInputKind::Rel => {
                if trimmed.len() > 1 && trimmed[0].eq_ascii(b'.') && trimmed[1].eq_ascii(b'/') {
                    trimmed = &trimmed[2..];
                }
                while !trimmed.is_empty() && trimmed[0].eq_ascii(b'/') {
                    trimmed = &trimmed[1..];
                }

                while !trimmed.is_empty() && trimmed[trimmed.len() - 1].eq_ascii(b'/') {
                    trimmed = &trimmed[..trimmed.len() - 1];
                }
            }
        }

        trimmed
    }
}

fn is_input_absolute<C: PathUnit>(input: &[C]) -> bool {
    if input.is_empty() {
        return false;
    }

    if input[0].eq_ascii(b'/') {
        return true;
    }

    #[cfg(windows)]
    {
        if input[0].eq_ascii(b'\\') {
            return true;
        }

        if input.len() < 3 {
            return false;
        }

        if input[1].eq_ascii(b':') && (input[2].eq_ascii(b'/') || input[2].eq_ascii(b'\\')) {
            return true;
        }
    }

    false
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/paths/Path.zig (973 lines)
//   confidence: medium
//   todos:      13
//   notes:      Heavy comptime type-returning fn → const-generic struct; needs adt_const_params or trait-per-option lowering. ResultFn collapsed to Result<T,E>. Buf.pooled is ManuallyDrop<Box<Buffer>> with manual pool put-back in Drop — swap to bun_paths RAII guard once generic over unit. anytype dispatch (append/appendJoin/convert) faked with TypeId; replace with sealed trait. slice_z/buf/basename_z/restore reshaped to &mut self for borrowck.
// ──────────────────────────────────────────────────────────────────────────
