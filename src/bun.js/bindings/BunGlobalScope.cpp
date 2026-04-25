
#include "root.h"
#include "ZigGlobalObject.h"
#include "BunGlobalScope.h"
#include "JavaScriptCore/FunctionPrototype.h"
#include "JavaScriptCore/JSCJSValueInlines.h"
#include "JavaScriptCore/Symbol.h"
#include "JavaScriptCore/TopExceptionScope.h"
#include "JavaScriptCore/VM.h"
#include "JavaScriptCore/VMTraps.h"
#include "JavaScriptCore/VMTrapsInlines.h"
#include "JavaScriptCore/LazyClassStructure.h"
#include "JavaScriptCore/LazyClassStructureInlines.h"
#include "BunClientData.h"
#include <wtf/text/SymbolImpl.h>

namespace Bun {

using namespace JSC;

// TC39 Decorator Metadata well-known symbol. Process-wide StaticSymbolImpl so
// that every realm in the same VM (main global, ShadowRealm, bun test
// --isolate, node:vm contexts) sees the same `Symbol.metadata` value via JSC's
// per-VM symbolImplToSymbolMap cache — ECMA-262 §6.1.5.1 requires well-known
// symbols to be shared by all realms. When Bun's WebKit fork gains `metadata`
// in JSC_COMMON_PRIVATE_IDENTIFIERS_EACH_WELL_KNOWN_SYMBOL, the hasOwnProperty
// guard below will skip the install and JSC's native symbol wins.
// https://github.com/oven-sh/bun/issues/29724
static WTF::SymbolImpl::StaticSymbolImpl metadataSymbolImpl { "Symbol.metadata" };

static void installSymbolMetadata(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    // Matches addBuiltinGlobals: this runs during finishCreation and has no way
    // to propagate an exception. Top exception scope swallows unexpected
    // exceptions instead of tripping debug asserts downstream.
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSC::JSObject* symbolConstructor = globalObject->get(globalObject, vm.propertyNames->Symbol).getObject();
    scope.assertNoExceptionExceptTermination();
    if (!symbolConstructor)
        return;

    JSC::Identifier metadataIdentifier = JSC::Identifier::fromString(vm, "metadata"_s);
    if (symbolConstructor->hasOwnProperty(globalObject, metadataIdentifier)) {
        scope.assertNoExceptionExceptTermination();
        return;
    }
    scope.assertNoExceptionExceptTermination();

    // Symbol::create(vm, impl) is cached per-VM in vm.symbolImplToSymbolMap, so
    // every realm in this VM gets the same Symbol cell for this SymbolImpl —
    // the spec requires well-known symbols to be shared across realms
    // (ECMA-262 §6.1.5.1).
    JSC::Symbol* metadataSymbol = JSC::Symbol::create(vm, static_cast<SymbolImpl&>(metadataSymbolImpl));
    unsigned attributes = PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly;
    symbolConstructor->putDirectWithoutTransition(vm, metadataIdentifier, metadataSymbol, attributes);

    // Per the Decorator Metadata proposal, Function.prototype[@@metadata] is
    // null so undecorated classes resolve `Foo[Symbol.metadata]` to null
    // (rather than undefined) via the prototype chain.
    JSC::JSObject* functionPrototype = globalObject->functionPrototype();
    JSC::Identifier metadataSymbolIdentifier = JSC::Identifier::fromUid(vm, &static_cast<SymbolImpl&>(metadataSymbolImpl));
    functionPrototype->putDirectWithoutTransition(vm, metadataSymbolIdentifier, JSC::jsNull(), attributes);
}

void GlobalScope::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));

    installSymbolMetadata(vm, this);

    m_encodeIntoObjectStructure.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::Structure>::Initializer& init) {
            auto& vm = init.vm;
            auto& globalObject = *init.owner;
            Structure* structure = globalObject.structureCache().emptyObjectStructureForPrototype(&globalObject, globalObject.objectPrototype(), 2);
            PropertyOffset offset;
            auto clientData = WebCore::clientData(vm);
            structure = Structure::addPropertyTransition(vm, structure, clientData->builtinNames().readPublicName(), 0, offset);
            RELEASE_ASSERT(offset == 0);
            structure = Structure::addPropertyTransition(vm, structure, clientData->builtinNames().writtenPublicName(), 0, offset);
            RELEASE_ASSERT(offset == 1);
            init.set(structure);
        });
}

DEFINE_VISIT_CHILDREN(GlobalScope);

template<typename Visitor>
void GlobalScope::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    GlobalScope* thisObject = uncheckedDowncast<GlobalScope>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);

    thisObject->m_encodeIntoObjectStructure.visit(visitor);
}

const JSC::ClassInfo GlobalScope::s_info = { "GlobalScope"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(GlobalScope) };

}
