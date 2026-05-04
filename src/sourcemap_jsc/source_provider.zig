//! `BakeSourceProvider` — the only `*SourceProvider` variant whose external
//! sourcemap lookup needs the live `Bake::GlobalObject`. The opaque + its
//! `getExternalData` live here so `src/sourcemap/` has no JSC types;
//! `getSourceMapImpl` calls it via `@hasDecl(SourceProviderKind, "getExternalData")`.

extern "c" fn BakeGlobalObject__isBakeGlobalObject(global: *bun.jsc.JSGlobalObject) bool;
extern "c" fn BakeGlobalObject__getPerThreadData(global: *bun.jsc.JSGlobalObject) *bun.bake.production.PerThread;

pub const BakeSourceProvider = opaque {
    extern fn BakeSourceProvider__getSourceSlice(*BakeSourceProvider) bun.String;
    pub const getSourceSlice = BakeSourceProvider__getSourceSlice;

    pub fn toSourceContentPtr(this: *BakeSourceProvider) SourceMap.ParsedSourceMap.SourceContentPtr {
        return SourceMap.ParsedSourceMap.SourceContentPtr.fromBakeProvider(this);
    }

    /// Returns the pre-bundled sourcemap JSON for `source_filename` if the
    /// current global is a `Bake::GlobalObject`; null otherwise (caller falls
    /// back to reading `<source>.map` from disk).
    pub fn getExternalData(_: *BakeSourceProvider, source_filename: []const u8) ?[]const u8 {
        const global = bun.jsc.VirtualMachine.get().global;
        if (!BakeGlobalObject__isBakeGlobalObject(global)) return null;
        const pt = BakeGlobalObject__getPerThreadData(global);
        if (pt.source_maps.get(source_filename)) |value| {
            return pt.bundled_outputs[value.get()].value.asSlice();
        }
        return "";
    }

    /// The last two arguments to this specify loading hints
    pub fn getSourceMap(
        provider: *BakeSourceProvider,
        source_filename: []const u8,
        load_hint: SourceMap.SourceMapLoadHint,
        result: SourceMap.ParseUrlResultHint,
    ) ?SourceMap.ParseUrl {
        return SourceMap.getSourceMapImpl(
            BakeSourceProvider,
            provider,
            source_filename,
            load_hint,
            result,
        );
    }
};

const bun = @import("bun");
const SourceMap = bun.SourceMap;
