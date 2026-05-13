// Thin C wrapper around the WIC interactions whose ABI is too fiddly to
// hand-roll from Zig: IPropertyBag2::Write with a VARIANT, and
// IWICMetadataQueryReader::GetMetadataByName with a PROPVARIANT. The rest of
// the WIC backend (vtable-shaped COM calls) lives in
// src/runtime/image/backend_wic.zig because those are plain function-pointer
// tables and have been stable; this file exists so the SDK's own <oaidl.h>/
// <propidl.h> definitions of VARIANT/PROPVARIANT (with their union/BRECORD/
// DECIMAL padding) are the source of truth instead of an extern-struct guess.
//
// Kept header-light: only the option name + a scalar go in, so if we later
// need more knobs (CompressionQuality, HeifCompressionMethod) they're one
// branch each rather than a Zig-side VARIANT for every type.

#if defined(_WIN32)

#include <windows.h>
#include <ocidl.h> // IPropertyBag2, PROPBAG2
#include <wincodec.h> // IWICBitmapFrameDecode, IWICMetadataQueryReader

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

// EXIF/TIFF Orientation (tag 0x0112) for the frame. Returns 1..8 per the EXIF
// spec; 1 (identity) for missing/out-of-range/any-failure to match Sharp's
// "advisory, never fail decode" treatment. PROPVARIANT lives here for the same
// reason VARIANT does — the SDK's own union layout is the source of truth.
//
// WIC's metadata-query root differs by container, so we try in order:
//  - /{ushort=274}            TIFF — frame reader's root *is* IFD0
//  - /ifd/{ushort=274}        HEIF — EXIF item is mounted under /ifd
//  - System.Photo.Orientation WIC photo-metadata policy; container-agnostic
// First path that yields a valid 1..8 wins; a SUCCEEDED-but-wrong-vt read
// falls through to the next path rather than short-circuiting to identity.
// (#30235)
extern "C" int32_t bun_wic_read_orientation(void* frame)
{
    if (!frame) return 1;
    IWICMetadataQueryReader* reader = nullptr;
    if (FAILED(static_cast<IWICBitmapFrameDecode*>(frame)->GetMetadataQueryReader(&reader)) || !reader)
        return 1;
    int32_t result = 1;
    static const wchar_t* const paths[] = {
        L"/{ushort=274}",
        L"/ifd/{ushort=274}",
        L"System.Photo.Orientation",
    };
    for (auto path : paths) {
        PROPVARIANT pv;
        PropVariantInit(&pv);
        if (SUCCEEDED(reader->GetMetadataByName(path, &pv)) && pv.vt == VT_UI2 && pv.uiVal >= 1 && pv.uiVal <= 8) {
            result = pv.uiVal;
            PropVariantClear(&pv);
            break;
        }
        PropVariantClear(&pv);
    }
    reader->Release();
    return result;
}

#else
// Stubs so the symbols exist everywhere; backend_wic.zig is Windows-only so
// these are never called, but the linker wants them.
extern "C" int bun_wic_propbag_write_f32(void*, const void*, float) { return 0; }
extern "C" int bun_wic_propbag_write_u8(void*, const void*, unsigned char) { return 0; }
extern "C" int bun_wic_read_orientation(void*) { return 1; }
#endif
