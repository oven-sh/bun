#pragma once

// clang-format off
// The items in this list must also be present in BunBuiltinNames.h
// If we use it as an identifier name in hot code, we should put it in this list.
#define BUN_COMMON_STRINGS_EACH_NAME(macro) \
    macro(require)                          \
    macro(resolve) \
    macro(mockedFunction)

// These ones don't need to be in BunBuiltinNames.h
// If we don't use it as an identifier name, but we want to avoid allocating the string frequently, put it in this list.
#define BUN_COMMON_STRINGS_EACH_NAME_NOT_BUILTIN_NAMES(macro) \
    macro(systemError, "SystemError") \
    macro(s3Error, "S3Error") \
    macro(utf8, "utf8") \
    macro(ucs2, "ucs2") \
    macro(utf16le, "utf16le") \
    macro(latin1, "latin1") \
    macro(ascii, "ascii") \
    macro(base64, "base64") \
    macro(base64url, "base64url") \
    macro(hex, "hex") \
    macro(buffer, "buffer") \
    macro(rsa, "rsa") \
    macro(rsaPss, "rsa-pss") \
    macro(ec, "ec") \
    macro(x25519, "x25519") \
    macro(ed25519, "ed25519")

// clang-format on

#define BUN_COMMON_STRINGS_ACCESSOR_DEFINITION(name)                           \
    JSC::JSString* name##String(JSC::JSGlobalObject* globalObject)             \
    {                                                                          \
        return m_commonString_##name.getInitializedOnMainThread(globalObject); \
    }

#define BUN_COMMON_STRINGS_ACCESSOR_DEFINITION_NOT_BUILTIN_NAMES(name, literal) \
    BUN_COMMON_STRINGS_ACCESSOR_DEFINITION(name)

#define BUN_COMMON_STRINGS_LAZY_PROPERTY_DECLARATION(name) \
    JSC::LazyProperty<JSC::JSGlobalObject, JSC::JSString> m_commonString_##name;

#define BUN_COMMON_STRINGS_LAZY_PROPERTY_DECLARATION_NOT_BUILTIN_NAMES(name, literal) \
    BUN_COMMON_STRINGS_LAZY_PROPERTY_DECLARATION(name)

namespace Bun {

class CommonStrings {
public:
    BUN_COMMON_STRINGS_EACH_NAME(BUN_COMMON_STRINGS_ACCESSOR_DEFINITION)
    BUN_COMMON_STRINGS_EACH_NAME_NOT_BUILTIN_NAMES(BUN_COMMON_STRINGS_ACCESSOR_DEFINITION_NOT_BUILTIN_NAMES)
    void initialize();

    template<typename Visitor>
    void visit(Visitor& visitor);

private:
    BUN_COMMON_STRINGS_EACH_NAME(BUN_COMMON_STRINGS_LAZY_PROPERTY_DECLARATION)
    BUN_COMMON_STRINGS_EACH_NAME_NOT_BUILTIN_NAMES(BUN_COMMON_STRINGS_LAZY_PROPERTY_DECLARATION_NOT_BUILTIN_NAMES)
};

} // namespace Bun

#undef BUN_COMMON_STRINGS_ACCESSOR_DEFINITION
#undef BUN_COMMON_STRINGS_LAZY_PROPERTY_DECLARATION
#undef BUN_COMMON_STRINGS_ACCESSOR_DEFINITION_NOT_BUILTIN_NAMES
#undef BUN_COMMON_STRINGS_LAZY_PROPERTY_DECLARATION_NOT_BUILTIN_NAMES
