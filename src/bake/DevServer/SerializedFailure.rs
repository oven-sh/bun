//! Errors sent to the HMR client in the browser are serialized. The same format
//! is used for thrown JavaScript exceptions as well as bundler errors.
//! Serialized failures contain a handle on what file or route they came from,
//! which allows the bundler to dismiss or update stale failures via index as
//! opposed to re-sending a new payload. This also means only changed files are
//! rebuilt, instead of all of the failed files.
//!
//! The HMR client in the browser is expected to sort the final list of errors
//! for deterministic output; there is code in DevServer that uses `swapRemove`.

use bun_logger as logger;

use super::incremental_graph::IncrementalGraph;
use super::route_bundle::RouteBundle;
use super::DevServer;
// TODO(port): `Side` is the comptime enum param to IncrementalGraph (.client/.server) — confirm exact path
use super::Side;

pub struct SerializedFailure {
    /// Serialized data is always owned by `dev.allocator()`
    /// The first 32 bits of this slice contain the owner
    pub data: Box<[u8]>,
}

// Zig `deinit` only freed `data` via `dev.allocator()`; `Box<[u8]>` drops automatically.
// No explicit `Drop` impl needed.

/// The metaphorical owner of an incremental file error. The packed variant
/// is given to the HMR runtime as an opaque handle.
pub enum Owner {
    None,
    Route(super::route_bundle::Index),
    // TODO(port): IncrementalGraph<const SIDE> associated FileIndex types — verify Rust spelling
    Client(<IncrementalGraph<{ Side::Client }> as super::incremental_graph::Graph>::FileIndex),
    Server(<IncrementalGraph<{ Side::Server }> as super::incremental_graph::Graph>::FileIndex),
}

impl Owner {
    pub fn encode(&self) -> Packed {
        match self {
            Owner::None => Packed::new(PackedKind::None, 0),
            Owner::Client(data) => Packed::new(PackedKind::Client, data.get()),
            Owner::Server(data) => Packed::new(PackedKind::Server, data.get()),
            Owner::Route(data) => Packed::new(PackedKind::Route, data.get()),
        }
    }
}

/// Zig: `packed struct(u32) { data: u30, kind: enum(u2) }`
/// First field at LSB → `data` = bits 0..30, `kind` = bits 30..32.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub struct Packed(u32);

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum PackedKind {
    None = 0,
    Route = 1,
    Client = 2,
    Server = 3,
}

impl Packed {
    const DATA_MASK: u32 = (1 << 30) - 1;

    #[inline]
    pub const fn new(kind: PackedKind, data: u32) -> Self {
        debug_assert!(data <= Self::DATA_MASK);
        Packed((data & Self::DATA_MASK) | ((kind as u32) << 30))
    }

    #[inline]
    pub const fn data(self) -> u32 {
        self.0 & Self::DATA_MASK
    }

    #[inline]
    pub const fn kind(self) -> PackedKind {
        // SAFETY: bits 30..32 always hold a value in 0..=3, all of which are valid PackedKind discriminants
        unsafe { core::mem::transmute::<u8, PackedKind>((self.0 >> 30) as u8) }
    }

    #[inline]
    pub const fn bits(self) -> u32 {
        self.0
    }

    #[inline]
    pub const fn from_bits(bits: u32) -> Self {
        Packed(bits)
    }

    pub fn decode(self) -> Owner {
        match self.kind() {
            PackedKind::None => Owner::None,
            // TODO(port): confirm FileIndex::init / RouteBundle.Index::init signatures
            PackedKind::Client => Owner::Client(IncrementalGraph::<{ Side::Client }>::FileIndex::init(self.data())),
            PackedKind::Server => Owner::Server(IncrementalGraph::<{ Side::Server }>::FileIndex::init(self.data())),
            PackedKind::Route => Owner::Route(super::route_bundle::Index::init(self.data())),
        }
    }
}

// Zig: comptime { assert(@as(u32, @bitCast(Packed{ .kind = .none, .data = 1 })) == 1); }
const _: () = assert!(Packed::new(PackedKind::None, 1).bits() == 1);

impl SerializedFailure {
    pub fn get_owner(&self) -> Owner {
        // Zig: std.mem.bytesAsValue(Owner.Packed, failure.data[0..4]).decode()
        let bytes: [u8; 4] = self.data[0..4].try_into().expect("unreachable");
        Packed::from_bits(u32::from_ne_bytes(bytes)).decode()
    }
}

/// This assumes the hash map contains only one SerializedFailure per owner.
/// This is okay since SerializedFailure can contain more than one error.
pub struct ArrayHashContextViaOwner;

impl ArrayHashContextViaOwner {
    pub fn hash(&self, k: &SerializedFailure) -> u32 {
        // TODO(port): std.hash.int — Zig stdlib integer mixer; map to bun_collections::hash_int or equivalent
        bun_collections::hash_int(k.get_owner().encode().bits())
    }

    pub fn eql(&self, a: &SerializedFailure, b: &SerializedFailure, _: usize) -> bool {
        a.get_owner().encode().bits() == b.get_owner().encode().bits()
    }
}

pub struct ArrayHashAdapter;

impl ArrayHashAdapter {
    pub fn hash(&self, own: &Owner) -> u32 {
        // TODO(port): std.hash.int — see above
        bun_collections::hash_int(own.encode().bits())
    }

    pub fn eql(&self, a: &Owner, b: &SerializedFailure, _: usize) -> bool {
        a.encode().bits() == b.get_owner().encode().bits()
    }
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum ErrorKind {
    // A log message. The `logger.Kind` is encoded here.
    BundlerLogErr = 0,
    BundlerLogWarn = 1,
    BundlerLogNote = 2,
    BundlerLogDebug = 3,
    BundlerLogVerbose = 4,

    /// new Error(message)
    JsError,
    /// new TypeError(message)
    JsErrorType,
    /// new RangeError(message)
    JsErrorRange,
    /// Other forms of `Error` objects, including when an error has a
    /// `code`, and other fields.
    JsErrorExtra,
    /// Non-error with a stack trace
    JsPrimitiveException,
    /// Non-error JS values
    JsPrimitive,
    /// new AggregateError(errors, message)
    JsAggregate,
}

impl SerializedFailure {
    pub fn init_from_log(
        _dev: &mut DevServer,
        owner: Owner,
        // for .client and .server, these are meant to be relative file paths
        owner_display_name: &[u8],
        messages: &[logger::Msg],
    ) -> Result<SerializedFailure, bun_alloc::AllocError> {
        debug_assert!(messages.len() > 0);

        // Avoid small re-allocations without requesting so much from the heap
        // PERF(port): was stack-fallback (std.heap.stackFallback(65536, dev.allocator())) — profile in Phase B
        let mut payload: Vec<u8> = Vec::with_capacity(65536);
        let w = &mut payload;

        write_u32_le(w, owner.encode().bits());

        write_string32(owner_display_name, w);

        write_u32_le(w, u32::try_from(messages.len()).unwrap());

        for msg in messages {
            write_log_msg(msg, w);
        }

        // Zig avoided re-cloning if the stack-fallback had spilled to heap; with
        // a plain Vec the buffer is always heap-backed, so just take ownership.
        let data = payload.into_boxed_slice();

        Ok(SerializedFailure { data })
    }
}

// All "write" functions get a corresponding "read" function in ./client/error.ts

// Zig: const Writer = std.array_list.Managed(u8).Writer;
type Writer = Vec<u8>;

#[inline]
fn write_u32_le(w: &mut Writer, v: u32) {
    w.extend_from_slice(&v.to_le_bytes());
}

#[inline]
fn write_i32_le(w: &mut Writer, v: i32) {
    w.extend_from_slice(&v.to_le_bytes());
}

fn write_log_msg(msg: &logger::Msg, w: &mut Writer) {
    // Zig: switch (msg.kind) { inline else => |k| @intFromEnum(@field(ErrorKind, "bundler_log_" ++ @tagName(k))) }
    // TODO(port): comptime reflection mapping logger::Kind tag → ErrorKind by name; written out explicitly
    let kind_byte = match msg.kind {
        logger::Kind::Err => ErrorKind::BundlerLogErr,
        logger::Kind::Warn => ErrorKind::BundlerLogWarn,
        logger::Kind::Note => ErrorKind::BundlerLogNote,
        logger::Kind::Debug => ErrorKind::BundlerLogDebug,
        logger::Kind::Verbose => ErrorKind::BundlerLogVerbose,
    } as u8;
    w.push(kind_byte);
    write_log_data(&msg.data, w);
    let notes = &msg.notes;
    write_u32_le(w, u32::try_from(notes.len()).unwrap());
    for note in notes.iter() {
        write_log_data(note, w);
    }
}

fn write_log_data(data: &logger::Data, w: &mut Writer) {
    write_string32(data.text.as_ref(), w);
    if let Some(loc) = &data.location {
        if loc.line < 0 {
            write_u32_le(w, 0);
            return;
        }
        debug_assert!(loc.column >= 0); // zero based and not negative

        write_i32_le(w, i32::try_from(loc.line).unwrap());
        write_u32_le(w, u32::try_from(loc.column).unwrap());
        write_u32_le(w, u32::try_from(loc.length).unwrap());

        // TODO: syntax highlighted line text + give more context lines
        write_string32(loc.line_text.as_deref().unwrap_or(b""), w);

        // The file is not specified here. Since the transpiler runs every file
        // in isolation, it would be impossible to reference any other file
        // in this Log. Thus, it is not serialized.
    } else {
        write_u32_le(w, 0);
    }
}

fn write_string32(data: &[u8], w: &mut Writer) {
    write_u32_le(w, u32::try_from(data.len()).unwrap());
    w.extend_from_slice(data);
}

// fn writeJsValue(value: JSValue, global: *jsc.JSGlobalObject, w: *Writer) !void {
//     if (value.isAggregateError(global)) {
//         //
//     }
//     if (value.jsType() == .DOMWrapper) {
//         if (value.as(bun.api.BuildMessage)) |build_error| {
//             _ = build_error; // autofix
//             //
//         } else if (value.as(bun.api.ResolveMessage)) |resolve_error| {
//             _ = resolve_error; // autofix
//             @panic("TODO");
//         }
//     }
//     _ = w; // autofix
//
//     @panic("TODO");
// }

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bake/DevServer/SerializedFailure.zig (216 lines)
//   confidence: medium
//   todos:      5
//   notes:      IncrementalGraph<const Side>::FileIndex spelling + std.hash.int mapping need Phase B; ArrayHash context structs may need to impl bun_collections trait instead of inherent fns
// ──────────────────────────────────────────────────────────────────────────
