//! `DevServer.SerializedFailure` — errors sent to the HMR client are serialized
//! once into the wire format. The same format is used for thrown JavaScript
//! exceptions as well as bundler errors. A serialized failure carries a handle
//! on the file or route it came from so the bundler can dismiss/update stale
//! failures by index instead of resending the whole payload.
//!
//! Spec: src/runtime/bake/DevServer/SerializedFailure.zig

use bun_io::Write as _;

use super::incremental_graph::{ClientFileIndex, ServerFileIndex};
use super::route_bundle;
use crate::bake::Side;

/// `SerializedFailure.Owner` — `packed struct(u32)` (1-bit side + 31-bit idx).
///
/// Distinct from `Packed` (2-bit kind + 30-bit data) below: this encoding only
/// covers `Client`/`Server` owners and is used as the `bundling_failures` map
/// key (Zig hashed via `ArrayHashContextViaOwner`; the port keys the map by
/// this newtype directly).
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Hash, Debug, Default)]
pub struct OwnerPacked(pub u32);
impl OwnerPacked {
    #[inline]
    pub fn new(side: Side, file: u32) -> Self {
        Self(file | ((side as u32) << 31))
    }
    #[inline]
    pub fn side(self) -> Side {
        if self.0 >> 31 == 0 {
            Side::Client
        } else {
            Side::Server
        }
    }
    #[inline]
    pub fn file(self) -> u32 {
        self.0 & 0x7FFF_FFFF
    }
}

/// The metaphorical owner of an incremental file error. The packed variant is
/// given to the HMR runtime as an opaque handle.
pub enum Owner {
    None,
    Route(route_bundle::Index),
    Client(ClientFileIndex),
    Server(ServerFileIndex),
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
        match (self.0 >> 30) as u8 {
            0 => PackedKind::None,
            1 => PackedKind::Route,
            2 => PackedKind::Client,
            _ => PackedKind::Server,
        }
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
            PackedKind::Client => Owner::Client(ClientFileIndex::init(self.data())),
            PackedKind::Server => Owner::Server(ServerFileIndex::init(self.data())),
            PackedKind::Route => Owner::Route(route_bundle::Index::init(self.data())),
        }
    }
}

// Zig: comptime { assert(@as(u32, @bitCast(Packed{ .kind = .none, .data = 1 })) == 1); }
const _: () = assert!(Packed::new(PackedKind::None, 1).bits() == 1);

/// Stored in `dev.bundling_failures` keyed by its `OwnerPacked`.
///
/// PERF(port): Zig's `SerializedFailure` is a slice header (`data: []u8`) and
/// gets shallow-copied between `bundling_failures` and the `failures_added`/
/// `failures_removed` lists. The Rust port owns `data` as `Box<[u8]>`, so
/// `Clone` deep-copies — profile in Phase B if this shows up.
#[derive(Clone, Default)]
pub struct SerializedFailure {
    /// Wire-format bytes (length-prefixed; first 4 bytes encode `Owner.Packed`).
    pub data: Box<[u8]>,
}

impl SerializedFailure {
    /// `SerializedFailure.getOwner` — decodes the leading 4-byte `Owner.Packed`
    /// from `data` (Zig: `std.mem.bytesAsValue(Owner.Packed, data[0..4]).decode()`).
    pub fn get_owner(&self) -> Owner {
        let raw = u32::from_ne_bytes(
            self.data[0..4]
                .try_into()
                .expect("infallible: size matches"),
        );
        Packed::from_bits(raw).decode()
    }

    /// `SerializedFailure.deinit` — releases `data`. The dev-server owns the
    /// allocator in Zig; here `Box<[u8]>` drop suffices, but we keep the
    /// signature so call sites stay 1:1 with the spec.
    pub fn deinit<D>(&self, _dev: &D) {
        // Drop happens via owner; nothing to do for the borrow form used by
        // `index_failures` (which iterates `&SerializedFailure`).
    }

    /// `SerializedFailure.initFromLog`.
    pub fn init_from_log(
        owner: Owner,
        // for .client and .server, these are meant to be relative file paths
        owner_display_name: &[u8],
        messages: &[bun_ast::Msg],
    ) -> Result<SerializedFailure, bun_alloc::AllocError> {
        debug_assert!(!messages.is_empty());

        // Avoid small re-allocations without requesting so much from the heap
        // PERF(port): was stack-fallback (std.heap.stackFallback(65536, dev.arena())) — profile in Phase B
        let mut payload: Vec<u8> = Vec::with_capacity(65536);
        let w = &mut payload;

        _ = w.write_int_le::<u32>(owner.encode().bits());
        write_string32(owner_display_name, w);
        _ = w.write_int_le::<u32>(u32::try_from(messages.len()).expect("int cast"));

        for msg in messages {
            write_log_msg(msg, w);
        }

        // Zig avoided re-cloning if the stack-fallback had spilled to heap; with
        // a plain Vec the buffer is always heap-backed, so just take ownership.
        Ok(SerializedFailure {
            data: payload.into_boxed_slice(),
        })
    }
}

/// This assumes the hash map contains only one SerializedFailure per owner.
/// This is okay since SerializedFailure can contain more than one error.
pub struct ArrayHashContextViaOwner;
impl ArrayHashContextViaOwner {
    pub fn hash(&self, k: &SerializedFailure) -> u32 {
        bun_wyhash::hash_int(k.get_owner().encode().bits())
    }
    pub fn eql(&self, a: &SerializedFailure, b: &SerializedFailure, _: usize) -> bool {
        a.get_owner().encode().bits() == b.get_owner().encode().bits()
    }
}

pub struct ArrayHashAdapter;
impl ArrayHashAdapter {
    pub fn hash(&self, own: &Owner) -> u32 {
        bun_wyhash::hash_int(own.encode().bits())
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

// All "write" functions get a corresponding "read" function in ./client/error.ts
// Zig: const Writer = std.array_list.Managed(u8).Writer;
type Writer = Vec<u8>;

fn write_log_msg(msg: &bun_ast::Msg, w: &mut Writer) {
    // Zig: switch (msg.kind) { inline else => |k| @intFromEnum(@field(ErrorKind, "bundler_log_" ++ @tagName(k))) }
    let kind_byte = match msg.kind {
        bun_ast::Kind::Err => ErrorKind::BundlerLogErr,
        bun_ast::Kind::Warn => ErrorKind::BundlerLogWarn,
        bun_ast::Kind::Note => ErrorKind::BundlerLogNote,
        bun_ast::Kind::Debug => ErrorKind::BundlerLogDebug,
        bun_ast::Kind::Verbose => ErrorKind::BundlerLogVerbose,
    } as u8;
    w.push(kind_byte);
    write_log_data(&msg.data, w);
    let notes = &msg.notes;
    _ = w.write_int_le::<u32>(u32::try_from(notes.len()).expect("int cast"));
    for note in notes.iter() {
        write_log_data(note, w);
    }
}

fn write_log_data(data: &bun_ast::Data, w: &mut Writer) {
    write_string32(data.text.as_ref(), w);
    if let Some(loc) = &data.location {
        if loc.line < 0 {
            _ = w.write_int_le::<u32>(0);
            return;
        }
        debug_assert!(loc.column >= 0); // zero based and not negative

        _ = w.write_int_le::<i32>(i32::try_from(loc.line).expect("int cast"));
        _ = w.write_int_le::<u32>(u32::try_from(loc.column).expect("int cast"));
        _ = w.write_int_le::<u32>(u32::try_from(loc.length).expect("int cast"));

        // TODO: syntax highlighted line text + give more context lines
        write_string32(loc.line_text.as_deref().unwrap_or(b""), w);

        // The file is not specified here. Since the transpiler runs every file
        // in isolation, it would be impossible to reference any other file
        // in this Log. Thus, it is not serialized.
    } else {
        _ = w.write_int_le::<u32>(0);
    }
}

fn write_string32(data: &[u8], w: &mut Writer) {
    _ = w.write_int_le::<u32>(u32::try_from(data.len()).expect("int cast"));
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
