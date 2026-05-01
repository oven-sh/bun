//! Stub native-addon loaders for standalone (`bun build --compile`) executables.
//!
//! The bun binary carries a small fixed table of "link slots" in its own
//! section (`__DATA,__bun_napi_lnk` on Mach-O, `.bun_napi_link` on ELF,
//! `.bnapi` on PE). Each slot is 256 bytes: `{ magic, offset, length, hash,
//! path[224] }`. A post-build linker can binary-patch a slot in place and
//! append the `.node` image into the `__BUN,__bun` / `.bun` section *after*
//! the standalone module graph payload, without re-running the bundler.
//!
//! At runtime, when `process.dlopen` sees a `/$bunfs/...` path, it consults
//! this table before falling back to the per-launch tmpfile extraction used
//! for bundler-embedded addons. A matching slot is loaded entirely from
//! memory: on macOS via `NSCreateObjectFileImageFromMemory` + `NSLinkModule`
//! (bun never writes a `.node` to disk; whatever modern dyld does internally
//! to satisfy code-signing is its own business), on Linux via
//! `memfd_create(MFD_EXEC)` + `dlopen("/proc/self/fd/N")`. Windows still goes
//! through a content-hashed cache file until a PE memory-loader is wired up.

/// Mirrors `BunNapiLinkSlot` in `c-bindings.cpp`. Keep both at 256 bytes.
pub const Slot = extern struct {
    magic: u64,
    offset: u64,
    length: u64,
    hash: u64,
    path: [224]u8,

    pub const count = 8;
    /// `"bunlink\0"` little-endian — the low 7 bytes are the signature, the
    /// high byte carries the slot index so patchers can locate slot N by
    /// scanning for `62 75 6E 6C 69 6E 6B NN`.
    pub const magic_base: u64 = 0x006B6E696C6E7562;

    comptime {
        bun.assert(@sizeOf(Slot) == 256);
    }

    pub fn isUsed(self: *const Slot) bool {
        return self.offset != 0 and self.length != 0;
    }

    pub fn index(self: *const Slot) u32 {
        return @intCast(self.magic >> 56);
    }

    pub fn pathSlice(self: *const Slot) []const u8 {
        return bun.sliceTo(&self.path, 0);
    }

    pub fn isValid(self: *const Slot) bool {
        return (self.magic & 0x00FF_FFFF_FFFF_FFFF) == magic_base;
    }
};

extern "C" fn Bun__getNapiLinkSlots() [*]Slot;
extern "C" fn Bun__getNapiLinkSlotCount() u32;
extern "C" fn Bun__getNapiLinkSectionBase() ?[*]const u8;
extern "C" fn Bun__darwinLoadMachOFromMemory(bytes: [*]const u8, len: usize, name: [*:0]const u8) ?*anyopaque;

/// Cache of already-loaded slots so repeated `require()` of the same virtual
/// path returns the same module instance. Indexed by slot number; entries
/// are written once and never freed (native addons can't be unloaded).
var loaded_handles: [Slot.count]?*anyopaque = @splat(null);

pub fn slots() []Slot {
    return Bun__getNapiLinkSlots()[0..Bun__getNapiLinkSlotCount()];
}

/// Returns true if *any* slot has been populated. Cheap enough to gate the
/// per-dlopen path comparison behind.
var has_any_slot_cache: ?bool = null;
pub fn hasAnySlot() bool {
    if (has_any_slot_cache) |v| return v;
    for (slots()) |*s| {
        if (s.isValid() and s.isUsed()) {
            has_any_slot_cache = true;
            return true;
        }
    }
    has_any_slot_cache = false;
    return false;
}

/// Find the slot whose virtual path matches `input_path` exactly.
pub fn findSlot(input_path: []const u8) ?*const Slot {
    if (!hasAnySlot()) return null;
    for (slots()) |*s| {
        if (!s.isValid() or !s.isUsed()) continue;
        if (bun.strings.eql(s.pathSlice(), input_path)) return s;
    }
    return null;
}

/// Return the embedded `.node` bytes for `slot` as a slice pointing directly
/// into the mapped `__BUN,__bun` / `.bun` section. The memory lives for the
/// lifetime of the process.
pub fn slotBytes(slot: *const Slot) ?[]const u8 {
    const base = Bun__getNapiLinkSectionBase() orelse return null;
    return base[slot.offset..][0..slot.length];
}

/// Load the addon image stored in `slot` and return an opaque handle usable
/// by `process.dlopen` (an `NSModule` on macOS, a `dlopen()` handle on
/// Linux, `HMODULE` on Windows). The handle is memoised per slot so static
/// constructors only fire once; a repeated call returns the cached handle
/// and `Process_functionDlopen` replays `napi_module_register` from the
/// `DLHandleMap` keyed on that handle.
///
/// `is_ns_module` is set on macOS when the handle came from `NSLinkModule`
/// rather than `dlopen()`, so the caller knows to use
/// `NSLookupSymbolInModule` instead of `dlsym()`. On every other platform it
/// is always false.
pub fn loadSlotFromMemory(slot: *const Slot, is_ns_module: *bool) ?*anyopaque {
    is_ns_module.* = false;
    const idx = slot.index();
    if (idx < loaded_handles.len) {
        if (loaded_handles[idx]) |h| {
            if (comptime Environment.isMac) is_ns_module.* = true;
            return h;
        }
    }

    const handle = loadSlotForPlatform(slot, is_ns_module);
    if (handle) |h| {
        if (idx < loaded_handles.len) loaded_handles[idx] = h;
    }
    return handle;
}

const loadSlotForPlatform = switch (Environment.os) {
    .mac => loadSlotMac,
    .linux => loadSlotLinux,
    .freebsd => loadSlotPosixCacheFile,
    else => loadSlotUnsupported,
};

fn loadSlotMac(slot: *const Slot, is_ns_module: *bool) ?*anyopaque {
    if (comptime !Environment.isMac) unreachable;
    const bytes = slotBytes(slot) orelse return null;
    var name_buf: [64]u8 = undefined;
    // dyld uses this as the image's install name; keep it stable per slot
    // so stack traces and `NSNameOfModule` are recognisable.
    const name = std.fmt.bufPrintZ(&name_buf, "bun:napi-slot-{d}", .{slot.index()}) catch "bun:napi-slot";
    is_ns_module.* = true;
    return Bun__darwinLoadMachOFromMemory(bytes.ptr, bytes.len, name.ptr);
}

fn loadSlotLinux(slot: *const Slot, is_ns_module: *bool) ?*anyopaque {
    if (comptime !Environment.isLinux) unreachable;
    _ = is_ns_module;
    const bytes = slotBytes(slot) orelse return null;
    var path_buf: bun.PathBuffer = undefined;
    const p = realizeViaMemfd(slot, bytes, &path_buf) orelse return null;
    var zbuf: bun.PathBuffer = undefined;
    @memcpy(zbuf[0..p.len], p);
    zbuf[p.len] = 0;
    return std.c.dlopen(zbuf[0..p.len :0], .{ .LAZY = true });
}

fn loadSlotPosixCacheFile(slot: *const Slot, is_ns_module: *bool) ?*anyopaque {
    if (comptime !Environment.isPosix) unreachable;
    _ = is_ns_module;
    // FreeBSD: no memfd, no NSLinkModule. Materialise to a content-addressed
    // cache file and `dlopen()` that — still avoids the per-launch tmpfile
    // the bundler-embedded path uses.
    const bytes = slotBytes(slot) orelse return null;
    var path_buf: bun.PathBuffer = undefined;
    const path = realizeViaCacheFile(slot, bytes, &path_buf) orelse return null;
    var zbuf: bun.PathBuffer = undefined;
    @memcpy(zbuf[0..path.len], path);
    zbuf[path.len] = 0;
    return std.c.dlopen(zbuf[0..path.len :0], .{ .LAZY = true });
}

fn loadSlotUnsupported(slot: *const Slot, is_ns_module: *bool) ?*anyopaque {
    // Windows: no in-memory PE loader yet and the PE post-link patcher
    // isn't written, so slots can't be populated on Windows today anyway.
    // `Process_functionDlopen` reports ERR_DLOPEN_FAILED for the (currently
    // unreachable) case of a populated slot.
    _ = slot;
    _ = is_ns_module;
    return null;
}

/// Called from `Process_functionDlopen` when the target starts with the
/// `/$bunfs/` prefix. If the path matches a populated slot, loads it from
/// memory and writes the resulting handle into `out_handle`. Returns true
/// whether or not the load succeeded — a true return with `out_handle == null`
/// means "this path is a link slot but loading failed", so the caller
/// surfaces a dlopen error instead of falling through to the
/// module-graph tmpfile extractor (which wouldn't find it either).
pub export fn Bun__tryLoadNapiLinkSlot(
    path_ptr: [*]const u8,
    path_len: usize,
    out_handle: *?*anyopaque,
    out_is_ns_module: *bool,
) bool {
    out_handle.* = null;
    out_is_ns_module.* = false;
    const slot = findSlot(path_ptr[0..path_len]) orelse return false;
    out_handle.* = loadSlotFromMemory(slot, out_is_ns_module);
    return true;
}

fn realizeViaMemfd(slot: *const Slot, bytes: []const u8, out_buf: *bun.PathBuffer) ?[]const u8 {
    if (comptime !Environment.isLinux) return null;

    var name_buf: [64]u8 = undefined;
    const name = std.fmt.bufPrintZ(&name_buf, "bun-napi-{d}", .{slot.index()}) catch "bun-napi";
    const fd = switch (bun.sys.memfd_create(name, .executable)) {
        .result => |f| f,
        .err => return null,
    };
    // Pre-size so dlopen sees the full extent immediately.
    _ = bun.sys.ftruncate(fd, @intCast(bytes.len));
    var remain = bytes;
    while (remain.len > 0) {
        switch (bun.sys.write(fd, remain)) {
            .result => |n| {
                if (n == 0) {
                    fd.close();
                    return null;
                }
                remain = remain[n..];
            },
            .err => {
                fd.close();
                return null;
            },
        }
    }
    // Leave the fd open so /proc/self/fd/N remains valid for dlopen and for
    // the lifetime of the loaded module.
    return std.fmt.bufPrint(out_buf, "/proc/self/fd/{d}", .{fd.native()}) catch null;
}

fn realizeViaCacheFile(slot: *const Slot, bytes: []const u8, out_buf: *bun.PathBuffer) ?[]const u8 {
    if (comptime !Environment.isPosix) return null; // only used for the FreeBSD / memfd-less fallback

    // Deterministic cache path keyed on the addon's content hash so repeated
    // launches (and multiple executables linking the same addon) share one
    // on-disk copy. The slot already carries the hash the linker computed; we
    // trust it but fall back to recomputing if it was left zero.
    const h: u64 = if (slot.hash != 0) slot.hash else bun.hash(bytes);

    const dir = cacheDir(out_buf) orelse {
        // No cache dir available — fall back to the legacy per-launch tmpfile
        // path; the caller (`resolveEmbeddedFile`) will handle that when we
        // return null here, provided the file was also embedded in the module
        // graph. For slot-only addons there is no fallback.
        return null;
    };
    mkdirAll(dir);

    const path = std.fmt.bufPrintZ(out_buf, "{s}" ++ std.fs.path.sep_str ++ "napi-{x:0>16}.node", .{ dir, h }) catch return null;

    if (bun.sys.existsZ(path)) return path;

    // Write via a tmpfile + rename so a concurrent launch never dlopens a
    // half-written image.
    var tmp_buf: bun.PathBuffer = undefined;
    const tmp = std.fmt.bufPrintZ(&tmp_buf, "{s}.{x}.tmp", .{ path, std.crypto.random.int(u32) }) catch return null;
    const file = bun.sys.File.openat(bun.FD.cwd(), tmp, bun.O.WRONLY | bun.O.CREAT | bun.O.TRUNC, 0o755).unwrap() catch return null;
    var ok = true;
    switch (file.writeAll(bytes)) {
        .result => {},
        .err => ok = false,
    }
    file.close();
    if (!ok) {
        _ = bun.sys.unlink(tmp);
        return null;
    }
    switch (bun.sys.renameat(bun.FD.cwd(), tmp, bun.FD.cwd(), path)) {
        .result => {},
        .err => {
            // Another process may have raced us to the final name.
            _ = bun.sys.unlink(tmp);
            if (!bun.sys.existsZ(path)) return null;
        },
    }
    return path;
}

/// Pick a directory to drop cached `.node` extractions into. Honours
/// `$BUN_NAPI_LINK_CACHE_DIR` so tests can redirect writes, otherwise uses
/// `$XDG_CACHE_HOME/bun/napi-link`, `$HOME/.cache/bun/napi-link`, or finally
/// the system tmpdir. Writes into `out_buf` and returns a slice of it.
fn cacheDir(out_buf: *bun.PathBuffer) ?[]const u8 {
    if (bun.getenvZ("BUN_NAPI_LINK_CACHE_DIR")) |p| {
        if (p.len > 0 and p.len < out_buf.len) {
            @memcpy(out_buf[0..p.len], p);
            return out_buf[0..p.len];
        }
    }
    if (bun.getenvZ("XDG_CACHE_HOME")) |p| {
        if (p.len > 0) {
            return std.fmt.bufPrint(out_buf, "{s}" ++ std.fs.path.sep_str ++ "bun" ++ std.fs.path.sep_str ++ "napi-link", .{p}) catch null;
        }
    }
    if (bun.getenvZ("HOME")) |p| {
        if (p.len > 0) {
            return std.fmt.bufPrint(out_buf, "{s}" ++ std.fs.path.sep_str ++ ".cache" ++ std.fs.path.sep_str ++ "bun" ++ std.fs.path.sep_str ++ "napi-link", .{p}) catch null;
        }
    }
    const t = bun.fs.FileSystem.RealFS.tmpdirPath();
    return std.fmt.bufPrint(out_buf, "{s}" ++ std.fs.path.sep_str ++ "bun-napi-link", .{t}) catch null;
}

/// `mkdir -p` using `bun.sys.mkdirA` so we don't pull in `std.fs.Dir`
/// (ban-words forbids both `std.fs.cwd()` and `.stdDir()`). Silently
/// ignores failures — the subsequent `open()` will surface the real error.
fn mkdirAll(abs: []const u8) void {
    var buf: bun.PathBuffer = undefined;
    var i: usize = 0;
    while (i < abs.len) {
        // Skip any run of separators.
        while (i < abs.len and std.fs.path.isSep(abs[i])) i += 1;
        if (i >= abs.len) break;
        // Advance to the next separator or end.
        while (i < abs.len and !std.fs.path.isSep(abs[i])) i += 1;
        if (i == 0 or i > buf.len - 1) return;
        @memcpy(buf[0..i], abs[0..i]);
        buf[i] = 0;
        _ = bun.sys.mkdirA(buf[0..i :0], 0o755);
    }
}

// ---------------------------------------------------------------------------
// Linker side: rewrite a standalone executable to carry an extra `.node`
// addon in one of the free slots. This is the "change the Mach-O link
// address" step — we locate the fixed slot table section, stamp a slot,
// append the addon bytes into the `__BUN,__bun` section (after the existing
// module-graph payload so `fromExecutable`'s trailer check still lands on the
// `"\n---- Bun! ----\n"` sentinel), and re-sign.
//
// Only Mach-O is wired up for now; ELF and PE need their own section-finders
// and payload-appenders which can reuse the same slot layout.
// ---------------------------------------------------------------------------

pub const LinkError = error{
    UnsupportedExecutableFormat,
    NotStandaloneExecutable,
    NoFreeSlot,
    PathTooLong,
    SlotTableMissing,
} || std.mem.Allocator.Error;

/// Append `addon_bytes` (a complete Mach-O `.node` image) to the standalone
/// executable `exe_bytes` and register it under `virtual_path` in the first
/// free link slot. Returns a freshly-allocated, re-signed Mach-O image.
pub fn linkIntoMachO(
    allocator: std.mem.Allocator,
    exe_bytes: []const u8,
    addon_bytes: []const u8,
    virtual_path: []const u8,
) LinkError![]u8 {
    if (!bun.macho.utils.isMacho(exe_bytes)) return error.UnsupportedExecutableFormat;
    if (virtual_path.len == 0 or virtual_path.len >= @sizeOf([224]u8)) return error.PathTooLong;

    var macho = bun.macho.MachoFile.init(allocator, exe_bytes, addon_bytes.len + (16 * 1024)) catch return error.UnsupportedExecutableFormat;
    defer macho.deinit();

    // The existing `__BUN,__bun` section starts with a u64 length header
    // followed by the serialised module graph (ending in the trailer). We
    // preserve that header value so `StandaloneModuleGraph.fromExecutable`
    // keeps finding the trailer, and append the addon image after it.
    const bun_section = macho.findSection("__BUN", "__bun") orelse return error.NotStandaloneExecutable;
    if (bun_section.size < @sizeOf(u64)) return error.NotStandaloneExecutable;

    const existing = macho.data.items[bun_section.file_offset..][0..bun_section.size];
    const graph_len = std.mem.readInt(u64, existing[0..8], .little);
    if (graph_len == 0) return error.NotStandaloneExecutable;
    // Current payload (without the u64 header) is `graph ++ prior napi images`.
    // The section's filesize may be padded past the last byte we care about,
    // but those padding bytes are zero; copying them is harmless and keeps
    // previously-linked addons intact.
    const prior_payload = existing[@sizeOf(u64)..];

    // Pad so the addon image starts on a 16 KiB boundary within the section —
    // matches the section alignment and gives dlopen a page-aligned source
    // when we hand it off via memfd.
    const alignment: u64 = 16 * 1024;
    const addon_off_in_payload = std.mem.alignForward(u64, prior_payload.len, alignment);
    const new_payload_len = addon_off_in_payload + addon_bytes.len;

    var new_payload = try allocator.alloc(u8, new_payload_len);
    defer allocator.free(new_payload);
    @memcpy(new_payload[0..prior_payload.len], prior_payload);
    @memset(new_payload[prior_payload.len..addon_off_in_payload], 0);
    @memcpy(new_payload[addon_off_in_payload..][0..addon_bytes.len], addon_bytes);

    // Rewrite the section. The header must keep pointing at the module graph
    // length, not the combined length.
    macho.writeSectionWithHeader(new_payload, graph_len) catch return error.UnsupportedExecutableFormat;

    // Stamp the first free slot. The slot table is fixed-size inside
    // `__DATA,__bun_napi_lnk` so this is a straight overwrite that doesn't
    // shift any load commands — but it must happen *after* `writeSection`
    // has finished shuffling bytes around, or we'd be editing stale memory
    // (the arraylist may have reallocated). `__DATA` sits before `__BUN` in
    // the file, so its offset is unaffected by the shift.
    const slot_section = macho.findSection("__DATA", "__bun_napi_lnk") orelse return error.SlotTableMissing;
    if (slot_section.size < @sizeOf(Slot)) return error.SlotTableMissing;
    const n_slots: usize = @intCast(slot_section.size / @sizeOf(Slot));
    const picked: usize = brk: {
        var i: usize = 0;
        while (i < n_slots) : (i += 1) {
            const slot_bytes = macho.data.items[slot_section.file_offset + i * @sizeOf(Slot) ..][0..@sizeOf(Slot)];
            var s: Slot = undefined;
            @memcpy(std.mem.asBytes(&s), slot_bytes);
            if (!s.isValid()) continue;
            if (!s.isUsed()) break :brk i;
        }
        return error.NoFreeSlot;
    };
    // Slot offsets are measured from the start of the section (the u64
    // header), so account for the 8-byte header `writeSectionWithHeader`
    // places before `new_payload`.
    var dest: Slot = .{
        .magic = Slot.magic_base | (@as(u64, @intCast(picked)) << 56),
        .offset = @as(u64, @sizeOf(u64)) + addon_off_in_payload,
        .length = addon_bytes.len,
        .hash = bun.hash(addon_bytes),
        .path = @splat(0),
    };
    @memcpy(dest.path[0..virtual_path.len], virtual_path);
    @memcpy(macho.data.items[slot_section.file_offset + picked * @sizeOf(Slot) ..][0..@sizeOf(Slot)], std.mem.asBytes(&dest));

    var out = std.array_list.Managed(u8).init(allocator);
    errdefer out.deinit();
    var buffer: [64 * 1024]u8 = undefined;
    var adapter = out.writer().adaptToNewApi(&buffer);
    macho.buildAndSign(&adapter.new_interface) catch return error.UnsupportedExecutableFormat;
    adapter.new_interface.flush() catch return error.UnsupportedExecutableFormat;
    return out.toOwnedSlice();
}

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
