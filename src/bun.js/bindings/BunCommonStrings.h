#pragma once

// clang-format off
#define BUN_COMMON_STRINGS_EACH_NAME(macro) \
    macro(require)                          \
    macro(resolve) \
    macro(mockedFunction)
// clang-format on

#define BUN_COMMON_STRINGS_ACCESSOR_DEFINITION(name)                           \
    JSC::JSString* name##String(JSC::JSGlobalObject* globalObject)             \
    {                                                                          \
        return m_commonString_##name.getInitializedOnMainThread(globalObject); \
    }

#define BUN_COMMON_STRINGS_LAZY_PROPERTY_DECLARATION(name) \
    JSC::LazyProperty<JSC::JSGlobalObject, JSC::JSString> m_commonString_##name;

namespace Bun {

class CommonStrings {
public:
    BUN_COMMON_STRINGS_EACH_NAME(BUN_COMMON_STRINGS_ACCESSOR_DEFINITION)

    void initialize();

    template<typename Visitor>
    void visit(Visitor& visitor);

private:
    BUN_COMMON_STRINGS_EACH_NAME(BUN_COMMON_STRINGS_LAZY_PROPERTY_DECLARATION)
};

} // namespace Bun

#undef BUN_COMMON_STRINGS_ACCESSOR_DEFINITION
#undef BUN_COMMON_STRINGS_LAZY_PROPERTY_DECLARATION
