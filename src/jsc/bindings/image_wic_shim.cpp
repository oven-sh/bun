// Thin C wrapper around the one WIC interaction whose ABI is too fiddly to
// hand-roll from Zig: IPropertyBag2::Write with a VARIANT. The rest of the
// WIC backend (vtable-shaped COM calls) lives in src/image/backend_wic.zig
// because those are plain function-pointer tables and have been stable; this
// file exists so the SDK's own <oaidl.h> definition of VARIANT (with its
// union/BRECORD/DECIMAL padding) is the source of truth instead of an extern
// struct guess.
//
// Kept header-light: only the option name + a float go in, so if we later
// need more knobs (CompressionQuality, HeifCompressionMethod) they're one
// branch each rather than a Zig-side VARIANT for every type.

#if defined(_WIN32)

#include <windows.h>
#include <ocidl.h> // IPropertyBag2, PROPBAG2

static int32_t write1(void* props, const wchar_t* name, VARTYPE vt, void (*set)(VARIANT&))
{
    if (!props) return 0;
    auto* bag = static_cast<IPropertyBag2*>(props);
    PROPBAG2 opt {};
    opt.pstrName = const_cast<LPOLESTR>(name);
    VARIANT v;
    VariantInit(&v);
    v.vt = vt;
    set(v);
    auto hr = bag->Write(1, &opt, &v);
    VariantClear(&v);
    return SUCCEEDED(hr) ? 1 : 0;
}

extern "C" int32_t bun_wic_propbag_write_f32(void* props, const wchar_t* name, float value)
{
    // Ignore failure — a missing "ImageQuality" knob (older codec) should
    // fall through to the encoder's default, not fail the whole encode.
    static thread_local float v;
    v = value;
    return write1(props, name, VT_R4, [](VARIANT& var) { var.fltVal = v; });
}

// VT_UI1 — used for `HeifCompressionMethod` (WICHeifCompressionOption enum,
// stored as UCHAR per the SDK). Unlike ImageQuality this one IS load-bearing:
// without it the HEIF encoder defaults to `DontCare` and picks whichever
// codec extension is installed, so `.avif()` could silently emit HEIC bytes
// on a machine with only the HEVC extension. Caller treats 0 (Write failed /
// codec doesn't recognise the option) as "extension missing" and surfaces
// BackendUnavailable.
extern "C" int32_t bun_wic_propbag_write_u8(void* props, const wchar_t* name, uint8_t value)
{
    static thread_local uint8_t v;
    v = value;
    return write1(props, name, VT_UI1, [](VARIANT& var) { var.bVal = v; });
}

#else
// Stubs so the symbols exist everywhere; backend_wic.zig is Windows-only so
// these are never called, but the linker wants them.
extern "C" int bun_wic_propbag_write_f32(void*, const void*, float) { return 0; }
extern "C" int bun_wic_propbag_write_u8(void*, const void*, unsigned char) { return 0; }
#endif
