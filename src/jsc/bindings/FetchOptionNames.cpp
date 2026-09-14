#include "root.h"
#include "FetchOptionNames.h"
#include "BunClientData.h"
#include "ObjectBindings.h"
#include <JavaScriptCore/Identifier.h>
#include <JavaScriptCore/JSObject.h>

// Same return convention as JSC__JSValue__fastGet: empty for an exception,
// the deleted value when the property does not exist.
extern "C" JSC::EncodedJSValue JSC__JSValue__getFetchOption(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* globalObject, uint8_t name)
{
    static constexpr ASCIILiteral names[] = {
#define BUN_FETCH_OPTION_LITERAL(enumerator, name) name ""_s,
        BUN_FETCH_OPTION_NAMES(BUN_FETCH_OPTION_LITERAL)
#undef BUN_FETCH_OPTION_LITERAL
    };
    static_assert(std::size(names) == static_cast<size_t>(Bun::FetchOptionName::Count));
    RELEASE_ASSERT(name < std::size(names));

    JSC::JSObject* object = JSC::JSValue::decode(JSValue0).getObject();
    ASSERT(object);
    auto& vm = JSC::getVM(globalObject);
    auto& identifier = WebCore::clientData(vm)->fetchOptionIdentifiers[name];
    if (identifier.isNull()) [[unlikely]]
        identifier = JSC::Identifier::fromString(vm, names[name]);
    return JSC::JSValue::encode(Bun::getIfPropertyExistsPrototypePollutionMitigationUnsafe(vm, globalObject, object, JSC::PropertyName(identifier)));
}

extern "C" uint8_t Bun__FetchOptionName__count()
{
    return static_cast<uint8_t>(Bun::FetchOptionName::Count);
}
