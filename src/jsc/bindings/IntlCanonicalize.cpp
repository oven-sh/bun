// C wrapper around ICU's CLDR-aware locale canonicalization, called from
// JSC's canonicalizeLocaleIDWithoutNullTerminator (IntlObject.cpp). ICU's
// uloc_canonicalize is documented as "does NOT map aliased names in any way",
// so without this Intl.Locale("fre") stays "fre" instead of "fr", "en-UK"
// stays "en-UK" instead of "en-GB", etc. (ICU-21506).
//
// WebKit compiles with U_SHOW_CPLUSPLUS_API=0 (wtf/Platform.h), and the ICU C
// headers JSC already pulls in lock out the C++-only dependencies locid.h
// needs, so this cannot live in WebKit. It is compiled standalone (noUnify)
// and without the PCH so that root.h never sets U_SHOW_CPLUSPLUS_API before
// the ICU headers are seen.
//
// Signature matches uloc_canonicalize so JSC's callBufferProducingFunction
// can drive buffer growth.

#if defined(__APPLE__)

#include <unicode/utypes.h>

// Apple's libicucore exports this on every macOS version Bun supports (the
// symbol is present in the MacOSX 12.3/13.3/15.4/26.4 SDK .tbd files; Bun's
// minimum is 13.0). The declaration lives in Apple's internal ICU headers
// (rdar://74314220); it wraps icu::Locale::createCanonical.
extern "C" int32_t ualoc_canonicalForm(const char*, char*, int32_t, UErrorCode*);

extern "C" int32_t Bun__canonicalizeLocaleID(const char* localeID, char* name, int32_t nameCapacity, UErrorCode* err)
{
    return ualoc_canonicalForm(localeID, name, nameCapacity, err);
}

#else

#include <unicode/locid.h>
#include <cstring>

// icu::Locale::createCanonical runs ICU's CLDR AliasReplacer since ICU 68.
// ICU is statically linked on every non-Darwin target, so the C++ ABI is
// fixed at build time.
extern "C" int32_t Bun__canonicalizeLocaleID(const char* localeID, char* name, int32_t nameCapacity, UErrorCode* err)
{
    if (err == nullptr || U_FAILURE(*err))
        return 0;
    icu::Locale locale = icu::Locale::createCanonical(localeID);
    if (locale.isBogus()) {
        *err = U_ILLEGAL_ARGUMENT_ERROR;
        return 0;
    }
    const char* canonical = locale.getName();
    int32_t length = static_cast<int32_t>(std::strlen(canonical));
    if (length < nameCapacity) {
        std::memcpy(name, canonical, static_cast<size_t>(length));
        name[length] = 0;
    } else {
        if (nameCapacity > 0)
            std::memcpy(name, canonical, static_cast<size_t>(nameCapacity));
        *err = length == nameCapacity ? U_STRING_NOT_TERMINATED_WARNING : U_BUFFER_OVERFLOW_ERROR;
    }
    return length;
}

#endif
