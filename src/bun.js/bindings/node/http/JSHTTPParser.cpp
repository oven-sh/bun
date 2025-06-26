#include "JSHTTPParser.h"
#include "DOMIsoSubspaces.h"
#include "JSHTTPParserPrototype.h"
#include "JSHTTPParserConstructor.h"
#include <JavaScriptCore/FunctionPrototype.h>

namespace Bun {

using namespace JSC;

const ClassInfo JSHTTPParser::s_info = { "HTTPParser"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSHTTPParser) };

void JSHTTPParser::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));

    // llhttp callbacks need JSHTTParser for the connections list.
    // The pointer does not need to be kept alive with WriteBarrier because
    // this is basically a self-reference.
    m_impl.m_thisParser = this;
}

template<typename Visitor>
void JSHTTPParser::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSHTTPParser* thisObject = jsCast<JSHTTPParser*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_impl.m_connectionsList);
}

DEFINE_VISIT_CHILDREN(JSHTTPParser);

void setupHTTPParserClassStructure(LazyClassStructure::Initializer& init)
{
    VM& vm = init.vm;
    JSGlobalObject* globalObject = init.global;

    auto* prototypeStructure = JSHTTPParserPrototype::createStructure(vm, globalObject, globalObject->objectPrototype());
    auto* prototype = JSHTTPParserPrototype::create(vm, globalObject, prototypeStructure);

    auto* constructorStructure = JSHTTPParserConstructor::createStructure(vm, globalObject, globalObject->functionPrototype());
    auto* constructor = JSHTTPParserConstructor::create(vm, constructorStructure, prototype);

    auto* structure = JSHTTPParser::createStructure(vm, globalObject, prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

} // namespace Bun
