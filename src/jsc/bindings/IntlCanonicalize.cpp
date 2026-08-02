// CLDR-aware locale canonicalization for JSC (IntlObject.cpp, ICU-21506).
// uloc_canonicalize skips alias mappings (fre->fr, en-UK->en-GB); this wraps
// the ICU paths that don't. Built no-PCH/no-unify so wtf/Platform.h's
// U_SHOW_CPLUSPLUS_API=0 never reaches <unicode/locid.h>. Signature matches
// uloc_canonicalize for callBufferProducingFunction.

#if defined(__APPLE__)

#include <unicode/utypes.h>

// Apple libicucore SPI (rdar://74314220); present on macOS 13+ per SDK .tbd.
extern "C" int32_t ualoc_canonicalForm(const char*, char*, int32_t, UErrorCode*);

extern "C" int32_t Bun__canonicalizeLocaleID(const char* localeID, char* name, int32_t nameCapacity, UErrorCode* err)
{
    // uloc_forLanguageTag("und") yields "", and on macOS 13/14 libicucore
    // canonicalizes "" to the process default locale; keep the root locale as-is.
    if (localeID != nullptr && localeID[0] == '\0') {
        if (nameCapacity > 0)
            name[0] = '\0';
        return 0;
    }
    return ualoc_canonicalForm(localeID, name, nameCapacity, err);
}

#else

#include <unicode/locid.h>
#include <cstring>

extern "C" int32_t Bun__canonicalizeLocaleID(const char* localeID, char* name, int32_t nameCapacity, UErrorCode* err)
{
    if (err == nullptr || U_FAILURE(*err))
        return 0;
    // Runs ICU's CLDR AliasReplacer since ICU 68; static link, so C++ ABI is fixed.
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
