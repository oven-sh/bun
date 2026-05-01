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
    /// A per-addon identity for the C++ side's `DLHandleMap` /
    /// `napiDlopenHandle` bookkeeping. There is no real `HMODULE` for a
    /// merged addon (it is not in the loader's module list), so we use
    /// the address where its RVA 0 landed — unique per addon, stable for
    /// the process, and a valid in-image pointer. Never passed to a
    /// Win32 API that expects an actual module handle.
    handle_token: ?*anyopaque = null,
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
    tls_dir_rva: u32,
    export_register: u32,
    export_api_version: u32,
    export_plugin_name: u32,
    sections: []align(1) const SectionInfo,
    relocs: []const u8,
    /// Offset into the blob where this addon's import list begins, so we
    /// can stream it during bind instead of materialising a nested array.
    imports_pos: usize,
    /// `bind()` irreversibly mutates the merged section (relocs, IAT,
    /// page protections, `RtlAddFunctionTable`, `DllMain`). It must run
    /// at most once: a second attempt would double-apply the ASLR delta
    /// or fault writing to a page that has already been flipped to RX.
    /// `.failed` is therefore terminal — later calls go straight to the
    /// tempfile fallback.
    state: union(enum) { unbound, bound: Resolved, failed } = .unbound,
};

var table: bun.StringHashMapUnmanaged(Entry) = .{};
var loaded = false;

/// `process.dlopen` is reachable from Workers on separate OS threads.
/// The previous tempfile path serialised on the Windows loader lock; this
/// path has no such lock, so we take our own around the lazy blob parse
/// and the check-and-bind. Uncontended after first load.
var lock: bun.Mutex = .{};

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
            .tls_dir_rva = try r.u32_(),
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

    lock.lock();
    defer lock.unlock();

    ensureLoaded();

    const entry = lookup(path) orelse return false;
    switch (entry.state) {
        .bound => |r| {
            out.* = r;
            return true;
        },
        // A previous attempt already mutated the section; do not touch
        // it again. The tempfile fallback uses the pristine raw bytes
        // from `.bun`, so behaviour is exactly as if the merge had
        // never happened.
        .failed => return false,
        .unbound => {},
    }
    const resolved = bind(entry) catch |err| {
        log("linked-addon bind failed for {s}: {s}; falling back to temp-file LoadLibrary", .{ path, @errorName(err) });
        entry.state = .failed;
        return false;
    };
    entry.state = .{ .bound = resolved };
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

    // Register the addon's exception tables with its *own* image base.
    // RUNTIME_FUNCTION and the UNWIND_INFO structures they reference keep
    // the addon-relative RVAs they were built with, so BaseAddress has to
    // be where the addon's RVA 0 actually landed — not the exe's base —
    // or chained unwinds and language-specific handlers resolve to the
    // wrong place.
    if (entry.pdata_count > 0) {
        const rfn: [*]RUNTIME_FUNCTION = @ptrCast(@alignCast(base + entry.pdata_rva));
        if (RtlAddFunctionTable(rfn, entry.pdata_count, base_addr + entry.rva_base) == 0) {
            // Without .pdata registered, any SEH / C++ exception inside
            // the addon would unwind through frames the OS cannot
            // describe. The tempfile path gets it via the loader, so
            // fall back rather than run with broken unwinding.
            return error.RtlAddFunctionTableFailed;
        }
    }

    // Implicit (__declspec(thread)) TLS. The loader's LdrpHandleTlsData
    // never saw this addon, so we do its job: pick a free implicit-TLS
    // index, publish it at *AddressOfIndex, install a per-thread copy
    // of the template in TEB->ThreadLocalStoragePointer[index], and run
    // the addon's TLS callbacks. The CRT TLS callback we register at
    // link time (Bun__linkedAddonTlsCallback) repeats the per-thread
    // part for every future DLL_THREAD_ATTACH so addon-spawned threads
    // work too.
    if (entry.tls_dir_rva != 0) {
        try tls.registerForProcess(base_addr, entry);
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
        .handle_token = base + entry.rva_base,
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

/// Implicit-TLS (`__declspec(thread)` / Rust `thread_local!`) support
/// for merged addons.
///
/// A loaded module's TLS variables live at
/// `TEB->ThreadLocalStoragePointer[*AddressOfIndex] + var_offset`. The
/// Windows loader assigns the index and, for every thread, allocates a
/// copy of the module's TLS template and stores its address in that
/// per-thread array slot. Our addon is not in the loader's module list,
/// so we do that work ourselves:
///
///   - pick a free index (max over every loaded module's index, +1,
///     then one more per merged addon so multiple addons each get
///     their own) and write it to the addon's `*AddressOfIndex`
///   - for the binding thread, and again from the CRT TLS callback
///     that c-bindings.cpp registers in `.CRT$XLB` for every future
///     `DLL_THREAD_ATTACH`: grow the thread's `ThreadLocalStoragePointer`
///     array out to `index+1`, heap-allocate a copy of the addon's
///     template (RawData span + SizeOfZeroFill), store it in
///     `[index]`, and walk the addon's TLS callback array
///
/// The addon's compiled code computes the TLS address as
/// `gs:[0x58][index*8] + var_offset` with `var_offset` baked in at
/// addon compile time, so as long as `[index]` points at a correctly-
/// laid-out copy of that addon's own template the accesses are right.
///
/// We intentionally leak the per-thread template copies and any grown
/// `ThreadLocalStoragePointer` arrays on `DLL_THREAD_DETACH`: bounded
/// per thread, and freeing the TLS block while `atexit`-registered
/// destructors may still touch it (the MSVCRT calls them *after* TLS
/// callbacks on some paths) is the wrong trade.
const tls = struct {
    /// `IMAGE_TLS_DIRECTORY64` — VA fields, not RVAs. These are covered
    /// by the addon's `.reloc` so by the time we read them (after
    /// `applyRelocs`) they are valid absolute pointers into the merged
    /// section.
    const Dir = extern struct {
        start_of_raw_data: u64,
        end_of_raw_data: u64,
        address_of_index: u64,
        address_of_callbacks: u64,
        size_of_zero_fill: u32,
        characteristics: u32,
    };

    const Callback = *const fn (?*anyopaque, w.DWORD, ?*anyopaque) callconv(.winapi) void;

    /// What `Bun__linkedAddonTlsCallback` needs to set up TLS on a new
    /// thread. Populated once per addon at bind time; read under
    /// `LinkedNodeModule.lock` from the callback.
    const Bound = struct {
        index: u32,
        template: []const u8,
        zero_fill: u32,
        /// Null-terminated. Points into the merged section so stable
        /// for the process lifetime.
        callbacks: ?[*]const ?Callback,
        /// Passed as the `hinstDLL` argument to the callbacks (and
        /// matches what `DllMain` gets).
        module: w.HINSTANCE,
    };

    var bound: std.ArrayListUnmanaged(Bound) = .{};
    /// First index we hand out. Computed lazily as max(loader-assigned
    /// indices) + 1 so a real DLL loaded later cannot collide: the
    /// loader only reuses an index after the owning module unloads,
    /// and it never goes above the count of loaded TLS modules.
    var first_index: ?u32 = null;

    // TEB fields we need. Only offsets are stable; the full struct is
    // enormous and version-dependent so we touch just these two.
    const TEB_TLS_PTR_OFF: usize = 0x58; // PVOID* ThreadLocalStoragePointer
    const TEB_PEB_OFF: usize = 0x60; // PPEB ProcessEnvironmentBlock

    inline fn teb() [*]u8 {
        return @ptrCast(w.teb());
    }
    inline fn tlsArrayPtr() *?[*]?*anyopaque {
        return @ptrCast(@alignCast(teb() + TEB_TLS_PTR_OFF));
    }

    /// Max implicit-TLS index currently in use by any module the
    /// loader knows about. Walks `PEB->Ldr->InLoadOrderModuleList`,
    /// reads each module's `IMAGE_TLS_DIRECTORY64.AddressOfIndex`.
    fn loaderMaxTlsIndex() u32 {
        const peb: [*]u8 = @ptrFromInt(
            @as(*align(1) const usize, @ptrCast(teb() + TEB_PEB_OFF)).*,
        );
        // PEB->Ldr at 0x18, PEB_LDR_DATA.InLoadOrderModuleList at 0x10.
        const ldr: [*]u8 = @ptrFromInt(@as(*align(1) const usize, @ptrCast(peb + 0x18)).*);
        const head: *align(1) const w.LIST_ENTRY = @ptrCast(ldr + 0x10);

        var max: u32 = 0;
        var it = head.Flink;
        while (@intFromPtr(it) != @intFromPtr(head)) : (it = it.Flink) {
            // LDR_DATA_TABLE_ENTRY: InLoadOrderLinks at +0, DllBase at +0x30.
            const dll_base: usize = @as(*align(1) const usize, @ptrCast(@as([*]const u8, @ptrCast(it)) + 0x30)).*;
            if (dll_base == 0) continue;
            const idx = readModuleTlsIndex(dll_base) orelse continue;
            if (idx > max) max = idx;
        }
        return max;
    }

    fn readModuleTlsIndex(dll_base: usize) ?u32 {
        const base: [*]const u8 = @ptrFromInt(dll_base);
        if (@as(*align(1) const u16, @ptrCast(base)).* != 0x5A4D) return null;
        const lfanew = @as(*align(1) const u32, @ptrCast(base + 0x3C)).*;
        const nt = base + lfanew;
        if (@as(*align(1) const u32, @ptrCast(nt)).* != 0x4550) return null;
        // OptionalHeader at nt+24; NumberOfRvaAndSizes at +108; dirs at +112.
        const opt = nt + 24;
        if (@as(*align(1) const u16, @ptrCast(opt)).* != 0x020B) return null; // PE32+
        const ndirs = @as(*align(1) const u32, @ptrCast(opt + 108)).*;
        if (ndirs <= 9) return null;
        const tls_rva = @as(*align(1) const u32, @ptrCast(opt + 112 + 9 * 8)).*;
        const tls_sz = @as(*align(1) const u32, @ptrCast(opt + 112 + 9 * 8 + 4)).*;
        if (tls_rva == 0 or tls_sz < @sizeOf(Dir)) return null;
        const dir: *align(1) const Dir = @ptrCast(base + tls_rva);
        if (dir.address_of_index == 0) return null;
        return @as(*align(1) const u32, @ptrFromInt(dir.address_of_index)).*;
    }

    /// Install the addon's TLS block for the *current* thread at
    /// `index`, growing `ThreadLocalStoragePointer` if necessary.
    fn installForCurrentThread(b: *const Bound) !void {
        const heap = k32.GetProcessHeap() orelse return error.NoProcessHeap;

        // Per-thread template copy. Zero-initialise so SizeOfZeroFill
        // bytes past the template are already clear, then copy the
        // initialised prefix over it.
        const total = b.template.len + b.zero_fill;
        const block: [*]u8 = @ptrCast(k32.HeapAlloc(heap, HEAP_ZERO_MEMORY, total) orelse
            return error.OutOfMemory);
        if (b.template.len > 0) @memcpy(block[0..b.template.len], b.template);

        const slot_ptr = tlsArrayPtr();
        const need = b.index + 1;
        // The loader-allocated array is exactly as long as it needed
        // for the modules it knows about. Our index is past that, so
        // grow it. We have no reliable way to learn the current length,
        // so allocate `need` pointers and copy as many old entries as
        // the loader must have produced (first_index of them — one per
        // module with TLS that the loader saw). Anything between
        // first_index and our indices is for other merged addons and
        // carried forward on subsequent calls (they all share the
        // largest array any one of them produced).
        const old = slot_ptr.*;
        const new: [*]?*anyopaque = @ptrCast(@alignCast(
            k32.HeapAlloc(heap, HEAP_ZERO_MEMORY, need * @sizeOf(?*anyopaque)) orelse {
                _ = k32.HeapFree(heap, 0, block);
                return error.OutOfMemory;
            },
        ));
        if (old) |o| {
            // Copy loader-owned entries plus any earlier merged-addon
            // entries that a previous installForCurrentThread on this
            // same thread already placed. `b.index` is the *highest*
            // index being written now, so everything below it that was
            // set is worth preserving.
            var i: u32 = 0;
            while (i < b.index) : (i += 1) new[i] = o[i];
        }
        new[b.index] = block;
        // Publish. The old array is deliberately leaked: the loader
        // owns it (or we allocated it on an earlier call) and freeing
        // would race with any code that captured the pointer. This is
        // at most one small array per (addon, thread), same as what
        // the loader itself does when a late-loaded DLL forces a grow.
        slot_ptr.* = new;
    }

    /// Bind-time: compute an index, publish it to `*AddressOfIndex`,
    /// install for the binding thread, run the addon's TLS callbacks
    /// with `DLL_PROCESS_ATTACH`, and register the addon so the CRT
    /// TLS callback can repeat the per-thread work for future threads.
    /// Caller holds `LinkedNodeModule.lock`.
    fn registerForProcess(base_addr: usize, entry: *const Entry) !void {
        const dir: *align(1) const Dir = @ptrFromInt(base_addr + entry.tls_dir_rva);

        // All four VA fields must resolve into the merged addon (they
        // are relocated absolutes, so compare against the addon span).
        const lo = base_addr + entry.rva_base;
        const hi = lo + entry.image_size;
        inline for (.{ dir.start_of_raw_data, dir.end_of_raw_data, dir.address_of_index }) |va| {
            if (va < lo or va > hi) return error.TlsDirectoryOutOfRange;
        }
        if (dir.end_of_raw_data < dir.start_of_raw_data) return error.TlsDirectoryOutOfRange;
        if (dir.address_of_callbacks != 0 and
            (dir.address_of_callbacks < lo or dir.address_of_callbacks >= hi))
        {
            return error.TlsDirectoryOutOfRange;
        }

        if (first_index == null) first_index = loaderMaxTlsIndex() + 1;
        const index: u32 = first_index.? + @as(u32, @intCast(bound.items.len));

        // Publish the index where the addon's compiled code will read
        // it. This slot is in the merged RW section and has already had
        // the build-time + ASLR reloc deltas applied.
        @as(*align(1) u32, @ptrFromInt(dir.address_of_index)).* = index;

        const b = Bound{
            .index = index,
            .template = @as([*]const u8, @ptrFromInt(dir.start_of_raw_data))[0..@intCast(dir.end_of_raw_data - dir.start_of_raw_data)],
            .zero_fill = dir.size_of_zero_fill,
            .callbacks = if (dir.address_of_callbacks != 0)
                @ptrFromInt(dir.address_of_callbacks)
            else
                null,
            .module = @ptrFromInt(base_addr),
        };

        try installForCurrentThread(&b);
        runCallbacks(&b, DLL_PROCESS_ATTACH);

        // Only now make it visible to the per-thread callback: a
        // thread starting concurrently must not see a half-initialised
        // entry (the lock already serialises, this is belt-and-braces
        // for the ordering relative to installForCurrentThread).
        try bound.append(bun.default_allocator, b);
    }

    fn runCallbacks(b: *const Bound, reason: w.DWORD) void {
        const cbs = b.callbacks orelse return;
        var i: usize = 0;
        while (cbs[i]) |cb| : (i += 1) {
            cb(@ptrCast(b.module), reason, null);
        }
    }

    /// Invoked by the loader via the `.CRT$XLB` TLS callback registered
    /// in c-bindings.cpp, once per thread per reason. Cheap no-op in
    /// the common case (no merged addons / not a compiled exe).
    fn onThread(reason: w.DWORD) void {
        // DLL_PROCESS_ATTACH arrives here too (for the startup thread),
        // but bind() handles that case explicitly so we only act on
        // per-thread events.
        if (reason != DLL_THREAD_ATTACH and reason != DLL_THREAD_DETACH) return;
        if (bound.items.len == 0) return;

        lock.lock();
        defer lock.unlock();

        for (bound.items) |*b| {
            if (reason == DLL_THREAD_ATTACH) {
                installForCurrentThread(b) catch |err| {
                    log("linked-addon TLS attach failed (index {d}): {s}", .{ b.index, @errorName(err) });
                    continue;
                };
            }
            runCallbacks(b, reason);
        }
    }

    const HEAP_ZERO_MEMORY: w.DWORD = 0x00000008;
};

/// C ABI entry for the CRT TLS callback registered in c-bindings.cpp.
/// The loader calls this for every thread in the process, which is how
/// merged addons get their implicit-TLS block on addon-spawned and
/// Worker threads without us having to hook thread creation.
pub fn Bun__linkedAddonTlsCallback(
    _: ?*anyopaque,
    reason: w.DWORD,
    _: ?*anyopaque,
) callconv(.winapi) void {
    if (!enabled) return;
    tls.onThread(reason);
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
        @export(&Bun__linkedAddonTlsCallback, .{ .name = "Bun__linkedAddonTlsCallback" });
    }
}

const DLL_PROCESS_ATTACH: w.DWORD = 1;
const DLL_THREAD_ATTACH: w.DWORD = 2;
const DLL_THREAD_DETACH: w.DWORD = 3;

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
const SectionInfo = bun.pe.PEFile.LinkedAddon.SectionInfo;

const w = std.os.windows;
const k32 = w.kernel32;
