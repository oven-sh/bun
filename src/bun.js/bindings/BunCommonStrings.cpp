#include "root.h"
#include "BunBuiltinNames.h"
#include "BunCommonStrings.h"
#include <JavaScriptCore/JSString.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/LazyProperty.h>
#include <JavaScriptCore/LazyPropertyInlines.h>
#include "ZigGlobalObject.h"
#include <JavaScriptCore/SlotVisitorInlines.h>
#include <JavaScriptCore/VMTrapsInlines.h>

namespace Bun {
using namespace JSC;

#define BUN_COMMON_STRINGS_LAZY_PROPERTY_DEFINITION(jsName)                        \
    this->m_commonString_##jsName.initLater(                                       \
        [](const JSC::LazyProperty<JSGlobalObject, JSString>::Initializer& init) { \
            auto& names = WebCore::builtinNames(init.vm);                          \
            auto name = names.jsName##PublicName();                                \
            init.set(jsOwnedString(init.vm, name.string()));                       \
        });

#define BUN_COMMON_STRINGS_LAZY_PROPERTY_DEFINITION_NOT_BUILTIN_NAMES(jsName)      \
    this->m_commonString_##jsName.initLater(                                       \
        [](const JSC::LazyProperty<JSGlobalObject, JSString>::Initializer& init) { \
            init.set(jsOwnedString(init.vm, #jsName##_s));                         \
        });

#define BUN_COMMON_STRINGS_LAZY_PROPERTY_VISITOR(name) this->m_commonString_##name.visit(visitor);

void CommonStrings::initialize()
{
    BUN_COMMON_STRINGS_EACH_NAME(BUN_COMMON_STRINGS_LAZY_PROPERTY_DEFINITION)
    BUN_COMMON_STRINGS_EACH_NAME_NOT_BUILTIN_NAMES(BUN_COMMON_STRINGS_LAZY_PROPERTY_DEFINITION_NOT_BUILTIN_NAMES)
}

template<typename Visitor>
void CommonStrings::visit(Visitor& visitor)
{
    BUN_COMMON_STRINGS_EACH_NAME(BUN_COMMON_STRINGS_LAZY_PROPERTY_VISITOR)
    BUN_COMMON_STRINGS_EACH_NAME_NOT_BUILTIN_NAMES(BUN_COMMON_STRINGS_LAZY_PROPERTY_VISITOR)
}

template void CommonStrings::visit(JSC::AbstractSlotVisitor&);
template void CommonStrings::visit(JSC::SlotVisitor&);

} // namespace Bun
