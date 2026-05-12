use core::cmp::Ordering;
use core::fmt;

use bun_core::strings;

use crate::ExternalString;
use crate::SlicedString;
use crate::String as SemverString;
use crate::query::token::Wildcard;

pub type Version = VersionType<u64>;
pub type OldV2Version = VersionType<u32>;

// ──────────────────────────────────────────────────────────────────────────
// VersionInt — trait capturing the operations the Zig generic needed on
// `comptime IntType: type`. Only u32 and u64 are instantiated.
// ──────────────────────────────────────────────────────────────────────────

pub trait VersionInt: Copy + Default + Eq + Ord + fmt::Display + 'static {
    const ZERO: Self;
    const MAX: Self;
    /// Zig: `_tag_padding: [if (IntType == u32) 4 else 0]u8` — explicit zeroed
    /// padding so lockfile byte-serialization is deterministic.
    type TagPadding: Copy + Default + 'static;
    fn parse_ascii(s: &[u8]) -> Option<Self>;
}

impl VersionInt for u64 {
    const ZERO: Self = 0;
    const MAX: Self = u64::MAX;
    type TagPadding = [u8; 0];
    #[inline]
    fn parse_ascii(s: &[u8]) -> Option<Self> {
        // Semantics match Zig `std.fmt.parseUnsigned(u64, s, 10) catch null`:
        // None for empty, any non-[0-9] byte, or overflow. Callers rely on
        // the non-digit None case for pre-release identifier ordering
        // (semver identifiers are `[0-9A-Za-z-]+`, so `_` never appears).
        bun_core::parse_unsigned::<u64>(s, 10).ok()
    }
}

impl VersionInt for u32 {
    const ZERO: Self = 0;
    const MAX: Self = u32::MAX;
    type TagPadding = [u8; 4];
    #[inline]
    fn parse_ascii(s: &[u8]) -> Option<Self> {
        bun_core::parse_unsigned::<u32>(s, 10).ok()
    }
}

// ──────────────────────────────────────────────────────────────────────────
// VersionType
// ──────────────────────────────────────────────────────────────────────────

#[repr(C)]
#[derive(Copy, Clone)]
pub struct VersionType<T: VersionInt> {
    pub major: T,
    pub minor: T,
    pub patch: T,
    // Zig: `_tag_padding: [if (IntType == u32) 4 else 0]u8 = .{0} ** ...` —
    // explicit zeroed bytes so the alignment gap before `tag` is deterministic
    // for lockfile serialization (see padding_checker.zig).
    #[doc(hidden)]
    pub _tag_padding: T::TagPadding,
    pub tag: Tag,
}

// Layout must match Zig `extern struct` exactly (lockfile binary format).
const _: () = {
    assert!(core::mem::size_of::<Tag>() == 32);
    assert!(core::mem::align_of::<Tag>() == 8);
    assert!(core::mem::size_of::<VersionType<u64>>() == 56);
    assert!(core::mem::size_of::<VersionType<u32>>() == 48);
    assert!(core::mem::offset_of!(VersionType<u64>, tag) == 24);
    assert!(core::mem::offset_of!(VersionType<u32>, tag) == 16);
};

impl<T: VersionInt> Default for VersionType<T> {
    fn default() -> Self {
        Self {
            major: T::ZERO,
            minor: T::ZERO,
            patch: T::ZERO,
            _tag_padding: Default::default(),
            tag: Tag::default(),
        }
    }
}

impl VersionType<u32> {
    pub fn migrate(self) -> VersionType<u64> {
        VersionType {
            major: u64::from(self.major),
            minor: u64::from(self.minor),
            patch: u64::from(self.patch),
            _tag_padding: [],
            tag: Tag {
                pre: self.tag.pre,
                build: self.tag.build,
            },
        }
    }
}

impl<T: VersionInt> VersionType<T> {
    /// Assumes that there is only one buffer for all the strings
    pub fn sort_gt(ctx: &[u8], lhs: Self, rhs: Self) -> bool {
        Self::order_fn(ctx, lhs, rhs) == Ordering::Greater
    }

    pub fn order_fn(ctx: &[u8], lhs: Self, rhs: Self) -> Ordering {
        lhs.order(rhs, ctx, ctx)
    }

    pub fn is_zero(self) -> bool {
        self.patch == T::ZERO && self.minor == T::ZERO && self.major == T::ZERO
    }

    pub fn parse_utf8(slice: &[u8]) -> ParseResult<T> {
        Self::parse(SlicedString { buf: slice, slice })
    }

    pub fn clone_into(self, slice: &[u8], buf: &mut &mut [u8]) -> Self {
        Self {
            major: self.major,
            minor: self.minor,
            patch: self.patch,
            _tag_padding: Default::default(),
            tag: self.tag.clone_into(slice, buf),
        }
    }

    #[inline]
    pub fn len(&self) -> u32 {
        (self.tag.build.len() + self.tag.pre.len()) as u32
    }

    pub fn fmt<'a>(self, input: &'a [u8]) -> Formatter<'a, T> {
        Formatter {
            version: self,
            input,
        }
    }

    pub fn diff_fmt<'a>(
        self,
        other: Self,
        this_buf: &'a [u8],
        other_buf: &'a [u8],
    ) -> DiffFormatter<'a, T> {
        DiffFormatter {
            version: self,
            buf: this_buf,
            other,
            other_buf,
        }
    }

    pub fn which_version_is_different(
        left: Self,
        right: Self,
        left_buf: &[u8],
        right_buf: &[u8],
    ) -> Option<ChangedVersion> {
        if left.major != right.major {
            return Some(ChangedVersion::Major);
        }
        if left.minor != right.minor {
            return Some(ChangedVersion::Minor);
        }
        if left.patch != right.patch {
            return Some(ChangedVersion::Patch);
        }

        if left.tag.has_pre() != right.tag.has_pre() {
            return Some(ChangedVersion::Pre);
        }
        if !left.tag.has_pre() && !right.tag.has_pre() {
            return None;
        }
        if left.tag.order_pre(right.tag, left_buf, right_buf) != Ordering::Equal {
            return Some(ChangedVersion::Pre);
        }

        if left.tag.has_build() != right.tag.has_build() {
            return Some(ChangedVersion::Build);
        }
        if !left.tag.has_build() && !right.tag.has_build() {
            return None;
        }
        if left.tag.build.order(&right.tag.build, left_buf, right_buf) != Ordering::Equal {
            Some(ChangedVersion::Build)
        } else {
            None
        }
    }

    pub fn count<B>(&self, buf: &[u8], builder: &mut B)
    where
        B: crate::StringBuilder,
    {
        if self.tag.has_pre() && !self.tag.pre.is_inline() {
            builder.count(self.tag.pre.slice(buf));
        }
        if self.tag.has_build() && !self.tag.build.is_inline() {
            builder.count(self.tag.build.slice(buf));
        }
    }

    pub fn append<B>(&self, buf: &[u8], builder: &mut B) -> Self
    where
        B: crate::StringBuilder,
    {
        let mut that = *self;

        if self.tag.has_pre() && !self.tag.pre.is_inline() {
            that.tag.pre = builder.append::<ExternalString>(self.tag.pre.slice(buf));
        }
        if self.tag.has_build() && !self.tag.build.is_inline() {
            that.tag.build = builder.append::<ExternalString>(self.tag.build.slice(buf));
        }

        that
    }

    pub fn eql(self, rhs: Self) -> bool {
        self.major == rhs.major
            && self.minor == rhs.minor
            && self.patch == rhs.patch
            && rhs.tag.eql(self.tag)
    }

    /// Modified version of pnpm's `whichVersionIsPinned`
    /// https://github.com/pnpm/pnpm/blob/bc0618cf192a9cafd0ab171a3673e23ed0869bbd/packages/which-version-is-pinned/src/index.ts#L9
    ///
    /// Differences:
    /// - It's not used for workspaces
    /// - `npm:` is assumed already removed from aliased versions
    /// - Invalid input is considered major pinned (important because these strings are coming
    ///    from package.json)
    ///
    /// The goal of this function is to avoid a complete parse of semver that's unused
    #[allow(unused_assignments)]
    pub fn which_version_is_pinned(input: &[u8]) -> PinnedVersion {
        let version = strings::trim(input, &strings::WHITESPACE_CHARS);

        let mut i: usize = 0;

        let pinned: PinnedVersion = 'pinned: {
            for j in 0..version.len() {
                match version[j] {
                    // newlines & whitespace
                    b' '
                    | b'\t'
                    | b'\n'
                    | b'\r'
                    | 0x0B // std.ascii.control_code.vt
                    | 0x0C // std.ascii.control_code.ff

                    // version separators
                    | b'v'
                    | b'=' => {}

                    c => {
                        i = j;

                        match c {
                            b'~' | b'^' => {
                                i += 1;

                                for k in i..version.len() {
                                    match version[k] {
                                        b' '
                                        | b'\t'
                                        | b'\n'
                                        | b'\r'
                                        | 0x0B
                                        | 0x0C => {
                                            // `v` and `=` not included.
                                            // `~v==1` would update to `^1.1.0` if versions `1.0.0`, `1.0.1`, `1.1.0`, and `2.0.0` are available
                                            // note that `~` changes to `^`
                                        }

                                        _ => {
                                            i = k;
                                            break 'pinned if c == b'~' {
                                                PinnedVersion::Minor
                                            } else {
                                                PinnedVersion::Major
                                            };
                                        }
                                    }
                                }

                                // entire version after `~` is whitespace. invalid
                                return PinnedVersion::Major;
                            }

                            b'0'..=b'9' => break 'pinned PinnedVersion::Patch,

                            // could be invalid, could also be valid range syntax (>=, ...)
                            // either way, pin major
                            _ => return PinnedVersion::Major,
                        }
                    }
                }
            }

            // entire semver is whitespace, `v`, and `=`. Invalid
            return PinnedVersion::Major;
        };

        // `pinned` is `.major`, `.minor`, or `.patch`. Check for each version core number:
        // - if major is missing, return `if (pinned == .patch) .major else pinned`
        // - if minor is missing, return `if (pinned == .patch) .minor else pinned`
        // - if patch is missing, return `pinned`
        // - if there's whitespace or non-digit characters between core numbers, return `.major`
        // - if the end is reached, return `pinned`

        // major
        if i >= version.len() || !version[i].is_ascii_digit() {
            return PinnedVersion::Major;
        }
        let mut d = version[i];
        while d.is_ascii_digit() {
            i += 1;
            if i >= version.len() {
                return if pinned == PinnedVersion::Patch {
                    PinnedVersion::Major
                } else {
                    pinned
                };
            }
            d = version[i];
        }

        if d != b'.' {
            return PinnedVersion::Major;
        }

        // minor
        i += 1;
        if i >= version.len() || !version[i].is_ascii_digit() {
            return PinnedVersion::Major;
        }
        d = version[i];
        while d.is_ascii_digit() {
            i += 1;
            if i >= version.len() {
                return if pinned == PinnedVersion::Patch {
                    PinnedVersion::Minor
                } else {
                    pinned
                };
            }
            d = version[i];
        }

        if d != b'.' {
            return PinnedVersion::Major;
        }

        // patch
        i += 1;
        if i >= version.len() || !version[i].is_ascii_digit() {
            return PinnedVersion::Major;
        }
        d = version[i];
        while d.is_ascii_digit() {
            i += 1;

            // patch is done and at input end, valid
            if i >= version.len() {
                return pinned;
            }
            d = version[i];
        }

        // Skip remaining valid pre/build tag characters and whitespace.
        // Does not validate whitespace used inside pre/build tags.
        if !valid_pre_or_build_tag_character(d) || d.is_ascii_whitespace() {
            return PinnedVersion::Major;
        }
        i += 1;

        // at this point the semver is valid so we can return pinned if it ends
        if i >= version.len() {
            return pinned;
        }
        d = version[i];
        while valid_pre_or_build_tag_character(d) && !d.is_ascii_whitespace() {
            i += 1;
            if i >= version.len() {
                return pinned;
            }
            d = version[i];
        }

        // We've come across a character that is not valid for tags or is whitespace.
        // Trailing whitespace was trimmed so we can assume there's another range
        PinnedVersion::Major
    }

    pub fn is_tagged_version_only(input: &[u8]) -> bool {
        let version = strings::trim(input, &strings::WHITESPACE_CHARS);

        // first needs to be a-z
        if version.is_empty() || !version[0].is_ascii_alphabetic() {
            return false;
        }

        for i in 1..version.len() {
            if !version[i].is_ascii_alphanumeric() {
                return false;
            }
        }

        true
    }

    pub fn order_without_tag(lhs: Self, rhs: Self) -> Ordering {
        if lhs.major < rhs.major {
            return Ordering::Less;
        }
        if lhs.major > rhs.major {
            return Ordering::Greater;
        }
        if lhs.minor < rhs.minor {
            return Ordering::Less;
        }
        if lhs.minor > rhs.minor {
            return Ordering::Greater;
        }
        if lhs.patch < rhs.patch {
            return Ordering::Less;
        }
        if lhs.patch > rhs.patch {
            return Ordering::Greater;
        }

        if lhs.tag.has_pre() {
            if !rhs.tag.has_pre() {
                return Ordering::Less;
            }
        } else {
            if rhs.tag.has_pre() {
                return Ordering::Greater;
            }
        }

        Ordering::Equal
    }

    pub fn order(self, rhs: Self, lhs_buf: &[u8], rhs_buf: &[u8]) -> Ordering {
        let order_without_tag = Self::order_without_tag(self, rhs);
        if order_without_tag != Ordering::Equal {
            return order_without_tag;
        }

        self.tag.order(rhs.tag, lhs_buf, rhs_buf)
    }

    pub fn order_without_build(self, rhs: Self, lhs_buf: &[u8], rhs_buf: &[u8]) -> Ordering {
        let order_without_tag = Self::order_without_tag(self, rhs);
        if order_without_tag != Ordering::Equal {
            return order_without_tag;
        }

        self.tag.order_without_build(rhs.tag, lhs_buf, rhs_buf)
    }

    #[allow(unused_assignments)]
    pub fn parse(sliced_string: SlicedString) -> ParseResult<T> {
        let input = sliced_string.slice;
        let mut result = ParseResult::<T>::default();

        let mut part_i: u8 = 0;
        let mut part_start_i: usize = 0;
        let mut last_char_i: usize = 0;

        if input.is_empty() {
            result.valid = false;
            return result;
        }
        let mut is_done = false;

        let mut i: usize = 0;

        for c in 0..input.len() {
            match input[c] {
                // newlines & whitespace
                b' '
                | b'\t'
                | b'\n'
                | b'\r'
                | 0x0B // std.ascii.control_code.vt
                | 0x0C // std.ascii.control_code.ff

                // version separators
                | b'v'
                | b'=' => {}
                _ => {
                    i = c;
                    break;
                }
            }
        }

        if i == input.len() {
            result.valid = false;
            return result;
        }

        // two passes :(
        while i < input.len() {
            if is_done {
                break;
            }

            match input[i] {
                b' ' => {
                    is_done = true;
                    break;
                }
                b'|' | b'^' | b'#' | b'&' | b'%' | b'!' => {
                    is_done = true;
                    if i > 0 {
                        i -= 1;
                    }
                    break;
                }
                b'0'..=b'9' => {
                    part_start_i = i;
                    i += 1;

                    while i < input.len() && matches!(input[i], b'0'..=b'9') {
                        i += 1;
                    }

                    last_char_i = i;

                    match part_i {
                        0 => {
                            result.version.major =
                                Self::parse_version_number(&input[part_start_i..last_char_i]);
                            part_i = 1;
                        }
                        1 => {
                            result.version.minor =
                                Self::parse_version_number(&input[part_start_i..last_char_i]);
                            part_i = 2;
                        }
                        2 => {
                            result.version.patch =
                                Self::parse_version_number(&input[part_start_i..last_char_i]);
                            part_i = 3;
                        }
                        _ => {}
                    }

                    if i < input.len()
                        && match input[i] {
                            // `.` is expected only if there are remaining core version numbers
                            b'.' => part_i != 3,
                            _ => false,
                        }
                    {
                        i += 1;
                    }
                }
                b'.' => {
                    result.valid = false;
                    is_done = true;
                    break;
                }
                b'-' | b'+' => {
                    // Just a plain tag with no version is invalid.
                    if part_i < 2 && result.wildcard == Wildcard::None {
                        result.valid = false;
                        is_done = true;
                        break;
                    }

                    part_start_i = i;
                    while i < input.len() && matches!(input[i], b' ') {
                        i += 1;
                    }
                    let tag_result = Tag::parse(sliced_string.sub(&input[part_start_i..]));
                    result.version.tag = tag_result.tag;
                    i += tag_result.len as usize;
                    break;
                }
                b'x' | b'*' | b'X' => {
                    part_start_i = i;
                    i += 1;

                    while i < input.len() && matches!(input[i], b'x' | b'*' | b'X') {
                        i += 1;
                    }

                    last_char_i = i;

                    if i < input.len() && matches!(input[i], b'.') {
                        i += 1;
                    }

                    if result.wildcard == Wildcard::None {
                        match part_i {
                            0 => {
                                result.wildcard = Wildcard::Major;
                                part_i = 1;
                            }
                            1 => {
                                result.wildcard = Wildcard::Minor;
                                part_i = 2;
                            }
                            2 => {
                                result.wildcard = Wildcard::Patch;
                                part_i = 3;
                            }
                            _ => {}
                        }
                    }
                }
                c => {
                    // Some weirdo npm packages in the wild have a version like "1.0.0rc.1"
                    // npm just expects that to work...even though it has no "-" qualifier.
                    if result.wildcard == Wildcard::None
                        && part_i >= 2
                        && matches!(c, b'a'..=b'z' | b'A'..=b'Z')
                    {
                        part_start_i = i;
                        let tag_result =
                            Tag::parse_with_pre_count(sliced_string.sub(&input[part_start_i..]), 1);
                        result.version.tag = tag_result.tag;
                        i += tag_result.len as usize;
                        is_done = true;
                        last_char_i = i;
                        break;
                    }

                    last_char_i = 0;
                    result.valid = false;
                    is_done = true;
                    break;
                }
            }
        }

        let _ = last_char_i;
        let _ = is_done;

        if result.wildcard == Wildcard::None {
            match part_i {
                0 => {
                    result.wildcard = Wildcard::Major;
                }
                1 => {
                    result.wildcard = Wildcard::Minor;
                }
                2 => {
                    result.wildcard = Wildcard::Patch;
                }
                _ => {}
            }
        }

        result.len = u32::try_from(i).expect("int cast");

        result
    }

    fn parse_version_number(input: &[u8]) -> Option<T> {
        // max decimal u64 is 18446744073709551615
        let mut bytes = [0u8; 20];
        let mut byte_i: u8 = 0;

        debug_assert!(input[0] != b'.');

        for &char in input {
            match char {
                b'X' | b'x' | b'*' => return None,
                b'0'..=b'9' => {
                    // out of bounds
                    if (byte_i as usize) + 1 > bytes.len() {
                        return None;
                    }
                    bytes[byte_i as usize] = char;
                    byte_i += 1;
                }
                b' ' | b'.' => break,
                // ignore invalid characters
                _ => {}
            }
        }

        // If there are no numbers
        if byte_i == 0 {
            return None;
        }

        if cfg!(debug_assertions) {
            return match T::parse_ascii(&bytes[0..byte_i as usize]) {
                Some(v) => Some(v),
                None => {
                    // TODO(port): Output.prettyErrorln with @errorName — Rust parse
                    // error doesn't carry a Zig-style tag name.
                    bun_core::pretty_errorln!(
                        "ERROR parsing version: \"{}\", bytes: {}",
                        bstr::BStr::new(input),
                        bstr::BStr::new(&bytes[0..byte_i as usize]),
                    );
                    Some(T::ZERO)
                }
            };
        }

        Some(T::parse_ascii(&bytes[0..byte_i as usize]).unwrap_or(T::ZERO))
    }
}

fn valid_pre_or_build_tag_character(c: u8) -> bool {
    matches!(c, b'-' | b'+' | b'.' | b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9')
}

// ──────────────────────────────────────────────────────────────────────────
// Formatter
// ──────────────────────────────────────────────────────────────────────────

pub struct Formatter<'a, T: VersionInt> {
    pub version: VersionType<T>,
    pub input: &'a [u8],
}

impl<'a, T: VersionInt> fmt::Display for Formatter<'a, T> {
    fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
        let self_ = self.version;
        write!(writer, "{}.{}.{}", self_.major, self_.minor, self_.patch)?;

        if self_.tag.has_pre() {
            let pre = self_.tag.pre.slice(self.input);
            write!(writer, "-{}", bstr::BStr::new(pre))?;
        }

        if self_.tag.has_build() {
            let build = self_.tag.build.slice(self.input);
            write!(writer, "+{}", bstr::BStr::new(build))?;
        }

        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// DiffFormatter
// ──────────────────────────────────────────────────────────────────────────

pub struct DiffFormatter<'a, T: VersionInt> {
    pub version: VersionType<T>,
    pub buf: &'a [u8],
    pub other: VersionType<T>,
    pub other_buf: &'a [u8],
}

impl<'a, T: VersionInt> fmt::Display for DiffFormatter<'a, T> {
    fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
        use core::fmt::Write as _;
        use core::sync::atomic::Ordering as AtomicOrdering;

        if !bun_core::output::ENABLE_ANSI_COLORS_STDOUT.load(AtomicOrdering::Relaxed) {
            // print normally if no colors
            let formatter = Formatter {
                version: self.version,
                input: self.buf,
            };
            return fmt::Display::fmt(&formatter, writer);
        }

        let diff = VersionType::which_version_is_different(
            self.version,
            self.other,
            self.buf,
            self.other_buf,
        )
        .unwrap_or(ChangedVersion::None);

        // TODO(port): Output.prettyFmt is a comptime ANSI-tag expander. `pretty_fmt!`
        // currently passes the literal through; the proc-macro substitution lands later.
        match diff {
            ChangedVersion::Major => write!(
                writer,
                concat!(bun_core::pretty_fmt!("<r><b><red>", true), "{}.{}.{}"),
                self.version.major, self.version.minor, self.version.patch,
            )?,
            ChangedVersion::Minor => {
                if self.version.major == T::ZERO {
                    write!(
                        writer,
                        concat!(
                            bun_core::pretty_fmt!("<d>", true),
                            "{}.",
                            bun_core::pretty_fmt!("<r><b><red>", true),
                            "{}.{}"
                        ),
                        self.version.major, self.version.minor, self.version.patch,
                    )?;
                } else {
                    write!(
                        writer,
                        concat!(
                            bun_core::pretty_fmt!("<d>", true),
                            "{}.",
                            bun_core::pretty_fmt!("<r><b><yellow>", true),
                            "{}.{}"
                        ),
                        self.version.major, self.version.minor, self.version.patch,
                    )?;
                }
            }
            ChangedVersion::Patch => {
                if self.version.major == T::ZERO && self.version.minor == T::ZERO {
                    write!(
                        writer,
                        concat!(
                            bun_core::pretty_fmt!("<d>", true),
                            "{}.{}.",
                            bun_core::pretty_fmt!("<r><b><red>", true),
                            "{}"
                        ),
                        self.version.major, self.version.minor, self.version.patch,
                    )?;
                } else {
                    write!(
                        writer,
                        concat!(
                            bun_core::pretty_fmt!("<d>", true),
                            "{}.{}.",
                            bun_core::pretty_fmt!("<r><b><green>", true),
                            "{}"
                        ),
                        self.version.major, self.version.minor, self.version.patch,
                    )?;
                }
            }
            ChangedVersion::None | ChangedVersion::Pre | ChangedVersion::Build => write!(
                writer,
                concat!(bun_core::pretty_fmt!("<d>", true), "{}.{}.{}"),
                self.version.major, self.version.minor, self.version.patch,
            )?,
        }

        // might be pre or build. loop through all characters, and insert <red> on
        // first diff.

        let mut set_color = false;
        if self.version.tag.has_pre() {
            if self.other.tag.has_pre() {
                let pre = self.version.tag.pre.slice(self.buf);
                let other_pre = self.other.tag.pre.slice(self.other_buf);

                let mut first = true;
                for (i, &c) in pre.iter().enumerate() {
                    if !set_color && i < other_pre.len() && c != other_pre[i] {
                        set_color = true;
                        writer.write_str(bun_core::pretty_fmt!("<r><b><red>", true))?;
                    }
                    if first {
                        first = false;
                        writer.write_char('-')?;
                    }
                    writer.write_char(c as char)?;
                }
            } else {
                write!(
                    writer,
                    concat!(bun_core::pretty_fmt!("<r><b><red>", true), "-{}"),
                    self.version.tag.pre.fmt(self.buf),
                )?;
                set_color = true;
            }
        }

        if self.version.tag.has_build() {
            if self.other.tag.has_build() {
                let build = self.version.tag.build.slice(self.buf);
                let other_build = self.other.tag.build.slice(self.other_buf);

                let mut first = true;
                for (i, &c) in build.iter().enumerate() {
                    if !set_color && i < other_build.len() && c != other_build[i] {
                        set_color = true;
                        writer.write_str(bun_core::pretty_fmt!("<r><b><red>", true))?;
                    }
                    if first {
                        first = false;
                        writer.write_char('+')?;
                    }
                    writer.write_char(c as char)?;
                }
            } else {
                if !set_color {
                    write!(
                        writer,
                        concat!(bun_core::pretty_fmt!("<r><b><red>", true), "+{}"),
                        self.version.tag.build.fmt(self.buf),
                    )?;
                } else {
                    write!(writer, "+{}", self.version.tag.build.fmt(self.other_buf))?;
                }
            }
        }

        writer.write_str(bun_core::pretty_fmt!("<r>", true))?;
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// ChangedVersion / PinnedVersion
// ──────────────────────────────────────────────────────────────────────────

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum ChangedVersion {
    Major,
    Minor,
    Patch,
    Pre,
    Build,
    None,
}

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum PinnedVersion {
    Major, // ^
    Minor, // ~
    Patch, // =
}

// ──────────────────────────────────────────────────────────────────────────
// Partial
// ──────────────────────────────────────────────────────────────────────────

#[derive(Copy, Clone)]
pub struct Partial<T: VersionInt> {
    pub major: Option<T>,
    pub minor: Option<T>,
    pub patch: Option<T>,
    pub tag: Tag,
}

impl<T: VersionInt> Default for Partial<T> {
    fn default() -> Self {
        Self {
            major: None,
            minor: None,
            patch: None,
            tag: Tag::default(),
        }
    }
}

impl<T: VersionInt> Partial<T> {
    pub fn min(self) -> VersionType<T> {
        VersionType {
            major: self.major.unwrap_or(T::ZERO),
            minor: self.minor.unwrap_or(T::ZERO),
            patch: self.patch.unwrap_or(T::ZERO),
            _tag_padding: Default::default(),
            tag: self.tag,
        }
    }

    pub fn max(self) -> VersionType<T> {
        VersionType {
            major: self.major.unwrap_or(T::MAX),
            minor: self.minor.unwrap_or(T::MAX),
            patch: self.patch.unwrap_or(T::MAX),
            _tag_padding: Default::default(),
            tag: self.tag,
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Tag
// ──────────────────────────────────────────────────────────────────────────

#[repr(C)]
#[derive(Copy, Clone, Default)]
pub struct Tag {
    pub pre: ExternalString,
    pub build: ExternalString,
}

// TODO(port): unused module-level static in Zig (`var multi_tag_warn = false;`).
// Kept as a note; remove if confirmed dead in Phase B.
#[allow(dead_code)]
static MULTI_TAG_WARN: core::sync::atomic::AtomicBool = core::sync::atomic::AtomicBool::new(false);
// TODO: support multiple tags

impl Tag {
    pub fn order_pre(self, rhs: Tag, lhs_buf: &[u8], rhs_buf: &[u8]) -> Ordering {
        // TODO(port): Zig parameterized this on IntType (u32 vs u64). Only the
        // u64 instantiation is used at runtime (OldV2Version is migration-only),
        // so we hardcode u64 here.
        let lhs_str = self.pre.slice(lhs_buf);
        let rhs_str = rhs.pre.slice(rhs_buf);

        // 1. split each by '.', iterating through each one looking for integers
        // 2. compare as integers, or if not possible compare as string
        // 3. whichever is greater is the greater one
        //
        // 1.0.0-canary.0.0.0.0.0.0 < 1.0.0-canary.0.0.0.0.0.1

        let mut lhs_itr = strings::split(lhs_str, b".");
        let mut rhs_itr = strings::split(rhs_str, b".");

        loop {
            let lhs_part = lhs_itr.next();
            let rhs_part = rhs_itr.next();

            if lhs_part.is_none() && rhs_part.is_none() {
                return Ordering::Equal;
            }

            // if right is null, left is greater than.
            if rhs_part.is_none() {
                return Ordering::Greater;
            }

            // if left is null, left is less than.
            if lhs_part.is_none() {
                return Ordering::Less;
            }

            let lhs_part = lhs_part.unwrap();
            let rhs_part = rhs_part.unwrap();

            let lhs_uint: Option<u64> = u64::parse_ascii(lhs_part);
            let rhs_uint: Option<u64> = u64::parse_ascii(rhs_part);

            // a part that doesn't parse as an integer is greater than a part that does
            // https://github.com/npm/node-semver/blob/816c7b2cbfcb1986958a290f941eddfd0441139e/internal/identifiers.js#L12
            if lhs_uint.is_some() && rhs_uint.is_none() {
                return Ordering::Less;
            }
            if lhs_uint.is_none() && rhs_uint.is_some() {
                return Ordering::Greater;
            }

            if lhs_uint.is_none() && rhs_uint.is_none() {
                match strings::order(lhs_part, rhs_part) {
                    Ordering::Equal => {
                        // continue to the next part
                        continue;
                    }
                    not_equal => return not_equal,
                }
            }

            match lhs_uint.unwrap().cmp(&rhs_uint.unwrap()) {
                Ordering::Equal => continue,
                not_equal => return not_equal,
            }
        }
    }

    pub fn order(self, rhs: Tag, lhs_buf: &[u8], rhs_buf: &[u8]) -> Ordering {
        if !self.pre.is_empty() && !rhs.pre.is_empty() {
            return self.order_pre(rhs, lhs_buf, rhs_buf);
        }

        let pre_order = self.pre.order(&rhs.pre, lhs_buf, rhs_buf);
        if pre_order != Ordering::Equal {
            return pre_order;
        }

        self.build.order(&rhs.build, lhs_buf, rhs_buf)
    }

    pub fn order_without_build(self, rhs: Tag, lhs_buf: &[u8], rhs_buf: &[u8]) -> Ordering {
        if !self.pre.is_empty() && !rhs.pre.is_empty() {
            return self.order_pre(rhs, lhs_buf, rhs_buf);
        }

        self.pre.order(&rhs.pre, lhs_buf, rhs_buf)
    }

    pub fn clone_into(self, slice: &[u8], buf: &mut &mut [u8]) -> Tag {
        let pre: SemverString;
        let build: SemverString;

        if self.pre.is_inline() {
            pre = self.pre.value;
        } else {
            let pre_slice = self.pre.slice(slice);
            buf[..pre_slice.len()].copy_from_slice(pre_slice);
            // PORT NOTE: reshaped for borrowck — Zig does
            // `String.init(buf.*, buf.*[0..pre_slice.len])` then advances buf.
            // We capture the init args before advancing.
            pre = SemverString::init(buf, &buf[0..pre_slice.len()]);
            *buf = &mut core::mem::take(buf)[pre_slice.len()..];
        }

        if self.build.is_inline() {
            build = self.build.value;
        } else {
            let build_slice = self.build.slice(slice);
            buf[..build_slice.len()].copy_from_slice(build_slice);
            build = SemverString::init(buf, &buf[0..build_slice.len()]);
            *buf = &mut core::mem::take(buf)[build_slice.len()..];
        }

        Tag {
            pre: ExternalString {
                value: pre,
                hash: self.pre.hash,
            },
            build: ExternalString {
                value: build,
                hash: self.build.hash,
            },
        }
    }

    #[inline]
    pub fn has_pre(self) -> bool {
        !self.pre.is_empty()
    }

    #[inline]
    pub fn has_build(self) -> bool {
        !self.build.is_empty()
    }

    pub fn eql(self, rhs: Tag) -> bool {
        self.pre.hash == rhs.pre.hash
    }

    pub fn parse(sliced_string: SlicedString) -> TagResult {
        Self::parse_with_pre_count(sliced_string, 0)
    }

    pub fn parse_with_pre_count(sliced_string: SlicedString, initial_pre_count: u32) -> TagResult {
        let input = sliced_string.slice;
        let mut build_count: u32 = 0;
        let mut pre_count: u32 = initial_pre_count;

        for &c in input {
            match c {
                b' ' => break,
                b'+' => {
                    build_count += 1;
                }
                b'-' => {
                    pre_count += 1;
                }
                _ => {}
            }
        }

        if build_count == 0 && pre_count == 0 {
            return TagResult {
                len: 0,
                ..Default::default()
            };
        }

        #[derive(Copy, Clone, Eq, PartialEq)]
        enum State {
            None,
            Pre,
            Build,
        }
        let mut result = TagResult::default();
        // Common case: no allocation is necessary.
        let mut state = State::None;
        let mut start: usize = 0;

        let mut i: usize = 0;

        while i < input.len() {
            let c = input[i];
            match c {
                b'+' => {
                    // qualifier  ::= ( '-' pre )? ( '+' build )?
                    if state == State::Pre || state == State::None && initial_pre_count > 0 {
                        result.tag.pre = sliced_string.sub(&input[start..i]).external();
                    }

                    if state != State::Build {
                        state = State::Build;
                        start = i + 1;
                    }
                }
                b'-' => {
                    if state != State::Pre {
                        state = State::Pre;
                        start = i + 1;
                    }
                }

                // only continue if character is a valid pre/build tag character
                // https://semver.org/#spec-item-9
                b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'.' => {}

                _ => {
                    match state {
                        State::None => {}
                        State::Pre => {
                            result.tag.pre = sliced_string.sub(&input[start..i]).external();

                            state = State::None;
                        }
                        State::Build => {
                            result.tag.build = sliced_string.sub(&input[start..i]).external();
                            if cfg!(debug_assertions) {
                                debug_assert!(!strings::contains_char(
                                    result.tag.build.slice(sliced_string.buf),
                                    b'-'
                                ));
                            }
                            state = State::None;
                        }
                    }
                    result.len = i as u32; // @truncate
                    break;
                }
            }
            i += 1;
        }

        if state == State::None && initial_pre_count > 0 {
            state = State::Pre;
            start = 0;
        }

        match state {
            State::None => {}
            State::Pre => {
                result.tag.pre = sliced_string.sub(&input[start..i]).external();
                // a pre can contain multiple consecutive tags
                // checking for "-" prefix is not enough, as --canary.67e7966.0 is a valid tag
            }
            State::Build => {
                // a build can contain multiple consecutive tags
                result.tag.build = sliced_string.sub(&input[start..i]).external();
            }
        }
        result.len = i as u32; // @truncate

        result
    }
}

#[derive(Copy, Clone, Default)]
pub struct TagResult {
    pub tag: Tag,
    pub len: u32,
}

// ──────────────────────────────────────────────────────────────────────────
// ParseResult
// ──────────────────────────────────────────────────────────────────────────

#[derive(Copy, Clone)]
pub struct ParseResult<T: VersionInt> {
    pub wildcard: Wildcard,
    pub valid: bool,
    pub version: Partial<T>,
    pub len: u32,
}

impl<T: VersionInt> Default for ParseResult<T> {
    fn default() -> Self {
        Self {
            wildcard: Wildcard::None,
            valid: true,
            version: Partial::default(),
            len: 0,
        }
    }
}

// ported from: src/semver/Version.zig
