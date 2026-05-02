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

extern "C" int32_t bun_wic_propbag_write_f32(void* props, const wchar_t* name, float value)
{
    if (!props) return 0;
    auto* bag = static_cast<IPropertyBag2*>(props);
    PROPBAG2 opt {};
    opt.pstrName = const_cast<LPOLESTR>(name);
    VARIANT v;
    VariantInit(&v);
    v.vt = VT_R4;
    v.fltVal = value;
    // Ignore failure — a missing knob (older codec) should fall through to
    // the encoder's default, not fail the whole encode.
    bag->Write(1, &opt, &v);
    VariantClear(&v);
    return 1;
}

#else
// Stub so the symbol exists everywhere; backend_wic.zig is Windows-only so
// this is never called, but the linker wants it.
extern "C" int bun_wic_propbag_write_f32(void*, const void*, float) { return 0; }
#endif
