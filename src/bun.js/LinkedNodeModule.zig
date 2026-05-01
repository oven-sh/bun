//! Runtime side of the `.node` static-merge performed by
//! `pe.PEFile.addLinkedAddon` during `bun build --compile` on Windows.
//!
//! The build step lays each addon out as a loader-mapped RW section inside
//! bun.exe, fixes absolute addresses up for bun.exe's preferred image base,
//! and writes a `.bunL` section describing, per addon: where it lives, its
//! relocation blocks (page RVAs already bun-relative), its import table,
//! its `.pdata`, and the export RVAs `process.dlopen` needs.
//!
//! At `process.dlopen("/$bunfs/…")` we look the path up here and, if it was
//! merged, finish the link in-process:
//!
//!   1. add the ASLR delta (`GetModuleHandle(NULL) - preferred_base`) to
//!      every DIR64 relocation — the section is RW, so plain stores
//!   2. bind the IAT: host imports (`node.exe` etc.) against our own
//!      export table, everything else via `LoadLibraryA`+`GetProcAddress`
//!   3. `VirtualProtect` each original-section range to the protection the
//!      addon shipped with, then `FlushInstructionCache`
//!   4. `RtlAddFunctionTable` so SEH / C++ exceptions inside the addon work
//!   5. call the addon's `DllMain(DLL_PROCESS_ATTACH)` so its CRT and static
//!      constructors run — exactly what `LoadLibrary` would have triggered
//!
//! and hand the resolved `napi_register_module_v1` /
//! `node_api_module_get_api_version_v1` / `BUN_PLUGIN_NAME` pointers back to
//! `BunProcess.cpp` so the rest of the dlopen flow is unchanged.
//!
//! Any failure (bad blob, missing import, `DllMain` returning FALSE)
//! returns false and the caller falls back to writing a temp file and
//! `LoadLibraryExW`ing it, so behaviour never regresses.

pub const enabled = Environment.isWindows;

const log = bun.Output.scoped(.LinkedNodeModule, .visible);

/// What `process.dlopen` needs back once an addon is bound. Pointers are
/// absolute (image base already applied); zero means "addon didn't export
/// it".
pub const Resolved = extern struct {
    napi_register_module_v1: ?*anyopaque = null,
    node_api_module_get_api_version_v1: ?*anyopaque = null,
    bun_plugin_name: ?*anyopaque = null,
};

const Reader = struct {
    bytes: []const u8,
    pos: usize = 0,

    fn u8_(self: *Reader) !u8 {
        if (self.pos >= self.bytes.len) return error.Truncated;
        const v = self.bytes[self.pos];
        self.pos += 1;
        return v;
    }
    fn u16_(self: *Reader) !u16 {
        if (self.pos + 2 > self.bytes.len) return error.Truncated;
        const v = std.mem.readInt(u16, self.bytes[self.pos..][0..2], .little);
        self.pos += 2;
        return v;
    }
    fn u32_(self: *Reader) !u32 {
        if (self.pos + 4 > self.bytes.len) return error.Truncated;
        const v = std.mem.readInt(u32, self.bytes[self.pos..][0..4], .little);
        self.pos += 4;
        return v;
    }
    fn u64_(self: *Reader) !u64 {
        if (self.pos + 8 > self.bytes.len) return error.Truncated;
        const v = std.mem.readInt(u64, self.bytes[self.pos..][0..8], .little);
        self.pos += 8;
        return v;
    }
    fn str(self: *Reader) ![]const u8 {
        const n = try self.u32_();
        if (self.pos + n > self.bytes.len) return error.Truncated;
        const s = self.bytes[self.pos..][0..n];
        self.pos += n;
        return s;
    }
    fn skip(self: *Reader, n: usize) !void {
        if (self.pos + n > self.bytes.len) return error.Truncated;
        self.pos += n;
    }
};

const SectionInfo = bun.pe.PEFile.LinkedAddon.SectionInfo;

/// Parsed view over one addon's entry in the `.bunL` blob. Slices borrow
/// from the blob (which is loader-mapped for the process lifetime), so no
/// allocation and no freeing.
const Entry = struct {
    rva_base: u32,
    image_size: u32,
    entry_point: u32,
    preferred_base: u64,
    pdata_rva: u32,
    pdata_count: u32,
    export_register: u32,
    export_api_version: u32,
    export_plugin_name: u32,
    sections: []align(1) const SectionInfo,
    relocs: []const u8,
    /// Offset into the blob where this addon's import list begins, so we
    /// can stream it during bind instead of materialising a nested array.
    imports_pos: usize,
    /// Set on first successful bind so repeated `require()` / `dlopen`
    /// calls are idempotent (relocs and DllMain must run exactly once).
    resolved: ?Resolved = null,
};

var table: bun.StringHashMapUnmanaged(Entry) = .{};
var loaded = false;

extern "c" fn Bun__getLinkedAddonsPEData() ?[*]u8;
extern "c" fn Bun__getLinkedAddonsPELength() u64;

fn ensureLoaded() void {
    if (!enabled) return;
    if (loaded) return;
    loaded = true;
    const len = Bun__getLinkedAddonsPELength();
    if (len == 0) return;
    const ptr = Bun__getLinkedAddonsPEData() orelse return;
    const blob = ptr[0..len];
    parseBlob(blob) catch |err| {
        log("failed to parse .bunL blob: {s}; falling back to temp-file LoadLibrary", .{@errorName(err)});
        table.clearRetainingCapacity();
    };
}

fn parseBlob(blob: []const u8) !void {
    var r = Reader{ .bytes = blob };
    if (try r.u32_() != bun.pe.PEFile.linked_magic) return error.BadMagic;
    if (try r.u32_() != bun.pe.PEFile.linked_version) return error.BadVersion;
    const count = try r.u32_();
    try table.ensureTotalCapacity(bun.default_allocator, count);
    var i: u32 = 0;
    while (i < count) : (i += 1) {
        const name = try r.str();
        var e = Entry{
            .rva_base = try r.u32_(),
            .image_size = try r.u32_(),
            .entry_point = try r.u32_(),
            .preferred_base = try r.u64_(),
            .pdata_rva = try r.u32_(),
            .pdata_count = try r.u32_(),
            .export_register = try r.u32_(),
            .export_api_version = try r.u32_(),
            .export_plugin_name = try r.u32_(),
            .sections = undefined,
            .relocs = undefined,
            .imports_pos = 0,
        };
        const nsect = try r.u32_();
        const sect_bytes = @sizeOf(SectionInfo) * nsect;
        if (r.pos + sect_bytes > blob.len) return error.Truncated;
        e.sections = @as([*]align(1) const SectionInfo, @ptrCast(blob[r.pos..].ptr))[0..nsect];
        try r.skip(sect_bytes);
        e.relocs = try r.str();
        e.imports_pos = r.pos;
        // Walk imports once to advance the cursor past them for the next
        // addon; the actual bind re-walks from imports_pos.
        const nlib = try r.u32_();
        var j: u32 = 0;
        while (j < nlib) : (j += 1) {
            _ = try r.str(); // dll name
            _ = try r.u8_(); // is_host
            const nent = try r.u32_();
            var k: u32 = 0;
            while (k < nent) : (k += 1) {
                _ = try r.u32_(); // iat_rva
                _ = try r.u16_(); // ordinal
                _ = try r.str(); // name
            }
        }
        table.putAssumeCapacity(name, e);
    }
}

/// Attempt to initialise the merged addon for `path`. On success, writes
/// the resolved export pointers to `out` and returns true; the C++ caller
/// then skips `LoadLibraryExW` entirely. On false the caller falls through
/// to the extract-to-tempfile path, so this never surfaces as a user-
/// visible error.
pub fn init(path: []const u8, out: *Resolved) bool {
    if (!enabled) return false;
    if (bun.feature_flag.BUN_FEATURE_FLAG_DISABLE_PE_ADDON_LINK.get()) return false;
    ensureLoaded();

    const entry = lookup(path) orelse return false;
    if (entry.resolved) |r| {
        out.* = r;
        return true;
    }
    const resolved = bind(entry) catch |err| {
        log("linked-addon bind failed for {s}: {s}; falling back to temp-file LoadLibrary", .{ path, @errorName(err) });
        return false;
    };
    entry.resolved = resolved;
    out.* = resolved;
    return true;
}

fn lookup(path: []const u8) ?*Entry {
    // Build-time keys are always forward-slash `$bunfs` paths (toBytes
    // uses the public prefix), but Windows callers may hand us either
    // separator. Normalise here rather than at every call site.
    if (table.getPtr(path)) |e| return e;
    if (std.mem.indexOfScalar(u8, path, '\\') != null) {
        var buf: bun.PathBuffer = undefined;
        if (path.len > buf.len) return null;
        @memcpy(buf[0..path.len], path);
        for (buf[0..path.len]) |*c| if (c.* == '\\') {
            c.* = '/';
        };
        return table.getPtr(buf[0..path.len]);
    }
    return null;
}

fn bind(entry: *Entry) !Resolved {
    if (!enabled) unreachable;

    const base_h = k32.GetModuleHandleW(null) orelse return error.NoModuleHandle;
    const base_addr: usize = @intFromPtr(base_h);
    const base: [*]u8 = @ptrFromInt(base_addr);

    // ASLR delta: the merge fixed absolutes up for `preferred_base`, the
    // loader actually put us at `base_addr`, so every DIR64 slot is off by
    // exactly this much. Section is RW so these are plain stores.
    const delta: i64 = @as(i64, @intCast(base_addr)) - @as(i64, @bitCast(entry.preferred_base));
    if (delta != 0) try applyRelocs(base, entry.relocs, delta);

    // Bind imports. Host imports resolve against our own export table —
    // bun.exe already exports the full napi_* / uv_* surface via
    // `src/symbols.def` — so the addon's delay-load hook is unnecessary.
    try bindImports(base, entry, base_h);

    // Now that code bytes are final, restore real protections.
    for (entry.sections) |s| {
        var old: w.DWORD = undefined;
        if (VirtualProtect(base + s.rva, s.size, s.final_protect, &old) == 0) {
            return error.VirtualProtectFailed;
        }
    }
    _ = FlushInstructionCache(k32.GetCurrentProcess(), base + entry.rva_base, entry.image_size);

    // .pdata was already rebased at build time; register it so the OS
    // unwinder can walk frames inside the addon.
    if (entry.pdata_count > 0) {
        const rfn: [*]RUNTIME_FUNCTION = @ptrCast(@alignCast(base + entry.pdata_rva));
        _ = RtlAddFunctionTable(rfn, entry.pdata_count, @intFromPtr(base));
    }

    // Run CRT init + static constructors. Passing the exe's HMODULE as
    // hinstDLL is a deliberate lie: there's no separate module for the
    // addon in the loader's list, and `_DllMainCRTStartup` only uses it
    // for `DisableThreadLibraryCalls`/`GetModuleFileName`-style queries,
    // which returning the exe for is at worst what the tmpfile path gave
    // anyway (a meaningless path).
    if (entry.entry_point != 0) {
        const DllMain = *const fn (w.HINSTANCE, w.DWORD, ?*anyopaque) callconv(.winapi) w.BOOL;
        const dll_main: DllMain = @ptrFromInt(base_addr + entry.entry_point);
        if (dll_main(@ptrCast(base_h), DLL_PROCESS_ATTACH, null) == 0) {
            // Addon refused attach. Treat like a failed LoadLibrary — fall
            // back to the tempfile path rather than surfacing a half-bound
            // module.
            return error.DllMainFalse;
        }
    }

    return .{
        .napi_register_module_v1 = if (entry.export_register != 0) base + entry.export_register else null,
        .node_api_module_get_api_version_v1 = if (entry.export_api_version != 0) base + entry.export_api_version else null,
        .bun_plugin_name = if (entry.export_plugin_name != 0) base + entry.export_plugin_name else null,
    };
}

fn applyRelocs(base: [*]u8, blocks: []const u8, delta: i64) !void {
    var off: usize = 0;
    while (off + 8 <= blocks.len) {
        const page_rva = std.mem.readInt(u32, blocks[off..][0..4], .little);
        const block_size = std.mem.readInt(u32, blocks[off + 4 ..][0..4], .little);
        if (block_size < 8 or off + block_size > blocks.len) return error.BadReloc;
        const n = (block_size - 8) / 2;
        var i: usize = 0;
        while (i < n) : (i += 1) {
            const e = std.mem.readInt(u16, blocks[off + 8 + i * 2 ..][0..2], .little);
            const typ = e >> 12;
            if (typ == 0) continue; // IMAGE_REL_BASED_ABSOLUTE padding
            if (typ != 10) return error.BadReloc; // only DIR64 on PE32+
            const slot: *align(1) u64 = @ptrCast(base + page_rva + (e & 0x0FFF));
            slot.* = @bitCast(@as(i64, @bitCast(slot.*)) + delta);
        }
        off += block_size;
    }
}

fn bindImports(base: [*]u8, entry: *const Entry, self_h: w.HMODULE) !void {
    const blob = (Bun__getLinkedAddonsPEData() orelse return error.NoBlob)[0..Bun__getLinkedAddonsPELength()];
    var r = Reader{ .bytes = blob, .pos = entry.imports_pos };
    const nlib = try r.u32_();
    var name_buf: [512:0]u8 = undefined;
    var j: u32 = 0;
    while (j < nlib) : (j += 1) {
        const dll_name = try r.str();
        const is_host = (try r.u8_()) != 0;
        const nent = try r.u32_();

        const module: w.HMODULE = if (is_host)
            self_h
        else blk: {
            if (dll_name.len >= name_buf.len) return error.ImportNameTooLong;
            @memcpy(name_buf[0..dll_name.len], dll_name);
            name_buf[dll_name.len] = 0;
            // Dependencies an addon declares are ones LoadLibrary would
            // have pulled in for it; doing so here has the same effect and
            // the same lifetime (process).
            break :blk LoadLibraryA(name_buf[0..dll_name.len :0]) orelse return error.ImportDllMissing;
        };

        var k: u32 = 0;
        while (k < nent) : (k += 1) {
            const iat_rva = try r.u32_();
            const ordinal = try r.u16_();
            const sym = try r.str();
            const addr: ?w.FARPROC = if (sym.len == 0)
                k32.GetProcAddress(module, @ptrFromInt(@as(usize, ordinal)))
            else blk: {
                if (sym.len >= name_buf.len) return error.ImportNameTooLong;
                @memcpy(name_buf[0..sym.len], sym);
                name_buf[sym.len] = 0;
                break :blk k32.GetProcAddress(module, name_buf[0..sym.len :0]);
            };
            if (addr == null) return error.ImportSymbolMissing;
            const slot: *align(1) usize = @ptrCast(base + iat_rva);
            slot.* = @intFromPtr(addr.?);
        }
    }
}

/// C ABI entry for `BunProcess.cpp`. `path_ptr[0..path_len]` is the
/// WTF-string the user passed to `process.dlopen`, already stripped of any
/// `file://` prefix.
pub fn Bun__initLinkedNodeModule(
    path_ptr: [*]const u8,
    path_len: usize,
    out: *Resolved,
) callconv(.c) bool {
    if (!enabled) return false;
    out.* = .{};
    return init(path_ptr[0..path_len], out);
}

comptime {
    if (enabled) {
        @export(&Bun__initLinkedNodeModule, .{ .name = "Bun__initLinkedNodeModule" });
    }
}

const DLL_PROCESS_ATTACH: w.DWORD = 1;

const RUNTIME_FUNCTION = extern struct {
    BeginAddress: u32,
    EndAddress: u32,
    UnwindInfoAddress: u32,
};

extern "kernel32" fn LoadLibraryA(name: [*:0]const u8) callconv(.winapi) ?w.HMODULE;
extern "kernel32" fn VirtualProtect(
    lpAddress: *anyopaque,
    dwSize: usize,
    flNewProtect: w.DWORD,
    lpflOldProtect: *w.DWORD,
) callconv(.winapi) w.BOOL;
extern "kernel32" fn FlushInstructionCache(
    hProcess: w.HANDLE,
    lpBaseAddress: ?*const anyopaque,
    dwSize: usize,
) callconv(.winapi) w.BOOL;
extern "kernel32" fn RtlAddFunctionTable(
    FunctionTable: [*]RUNTIME_FUNCTION,
    EntryCount: w.DWORD,
    BaseAddress: u64,
) callconv(.winapi) w.BOOLEAN;

const std = @import("std");
const bun = @import("bun");
const Environment = bun.Environment;
const w = std.os.windows;
const k32 = w.kernel32;
