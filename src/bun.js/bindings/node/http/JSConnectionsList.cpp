#include "JSConnectionsList.h"
#include "JSConnectionsListPrototype.h"
#include "JSConnectionsListConstructor.h"
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/JSSet.h>
#include <JavaScriptCore/JSSetIterator.h>
#include "JSHTTPParser.h"

namespace Bun {

using namespace JSC;

const ClassInfo JSConnectionsList::s_info = { "ConnectionsList"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSConnectionsList) };

void JSConnectionsList::finishCreation(VM& vm, JSGlobalObject* globalObject, JSSet* allConnections, JSSet* activeConnections)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));

    m_allConnections.set(vm, this, allConnections);
    m_activeConnections.set(vm, this, activeConnections);
}

template<typename Visitor>
void JSConnectionsList::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSConnectionsList* thisObject = jsCast<JSConnectionsList*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_allConnections);
    visitor.append(thisObject->m_activeConnections);
}

DEFINE_VISIT_CHILDREN(JSConnectionsList);

void setupConnectionsListClassStructure(LazyClassStructure::Initializer& init)
{
    VM& vm = init.vm;
    JSGlobalObject* globalObject = init.global;

    auto* prototypeStructure = JSConnectionsListPrototype::createStructure(vm, globalObject, globalObject->objectPrototype());
    auto* prototype = JSConnectionsListPrototype::create(vm, globalObject, prototypeStructure);

    auto* constructorStructure = JSConnectionsListConstructor::createStructure(vm, globalObject, globalObject->functionPrototype());
    auto* constructor = JSConnectionsListConstructor::create(vm, constructorStructure, prototype);

    auto* structure = JSConnectionsList::createStructure(vm, globalObject, prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

JSArray* JSConnectionsList::all(JSGlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* all = allConnections();
    JSArray* result = constructEmptyArray(globalObject, nullptr, all->size());
    RETURN_IF_EXCEPTION(scope, {});

    auto iter = JSSetIterator::create(globalObject, globalObject->setIteratorStructure(), all, IterationKind::Keys);
    RETURN_IF_EXCEPTION(scope, nullptr);

    JSValue item;
    size_t i = 0;
    while (iter->next(globalObject, item)) {
        JSHTTPParser* parser = jsDynamicCast<JSHTTPParser*>(item);
        if (!parser) {
            continue;
        }

        result->putDirectIndex(globalObject, i++, parser);
    }

    return result;
}

JSArray* JSConnectionsList::idle(JSGlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* all = allConnections();
    JSArray* result = constructEmptyArray(globalObject, nullptr);
    RETURN_IF_EXCEPTION(scope, {});

    auto iter = JSSetIterator::create(globalObject, globalObject->setIteratorStructure(), all, IterationKind::Keys);
    RETURN_IF_EXCEPTION(scope, nullptr);

    JSValue item;
    size_t i = 0;
    while (iter->next(globalObject, item)) {
        JSHTTPParser* parser = jsDynamicCast<JSHTTPParser*>(item);
        if (!parser) {
            continue;
        }

        if (parser->impl()->lastMessageStart() == 0) {
            result->putDirectIndex(globalObject, i++, parser);
        }
    }

    return result;
}

JSArray* JSConnectionsList::active(JSGlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* active = activeConnections();
    JSArray* result = constructEmptyArray(globalObject, nullptr, active->size());
    RETURN_IF_EXCEPTION(scope, {});

    auto iter = JSSetIterator::create(globalObject, globalObject->setIteratorStructure(), active, IterationKind::Keys);
    RETURN_IF_EXCEPTION(scope, nullptr);

    JSValue item;
    size_t i = 0;
    while (iter->next(globalObject, item)) {
        JSHTTPParser* parser = jsDynamicCast<JSHTTPParser*>(item);
        if (!parser) {
            continue;
        }

        result->putDirectIndex(globalObject, i++, parser);
    }

    return result;
}

JSArray* JSConnectionsList::expired(JSGlobalObject* globalObject, uint64_t headersDeadline, uint64_t requestDeadline)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* active = activeConnections();
    JSArray* result = constructEmptyArray(globalObject, nullptr);
    RETURN_IF_EXCEPTION(scope, {});

    auto iter = JSSetIterator::create(globalObject, globalObject->setIteratorStructure(), active, IterationKind::Keys);
    RETURN_IF_EXCEPTION(scope, nullptr);

    JSValue item = iter->next(vm);
    size_t i = 0;
    while (!item.isEmpty()) {
        JSHTTPParser* parser = jsDynamicCast<JSHTTPParser*>(item);
        if (!parser) {
            item = iter->next(vm);
            continue;
        }

        if ((!parser->impl()->headersCompleted() && headersDeadline > 0 && parser->impl()->lastMessageStart() < headersDeadline) || (requestDeadline > 0 && parser->impl()->lastMessageStart() < requestDeadline)) {
            result->putDirectIndex(globalObject, i++, item);
            active->remove(globalObject, item);
        }
    }

    return result;
}

void JSConnectionsList::push(JSGlobalObject* globalObject, JSCell* parser)
{
    allConnections()->add(globalObject, parser);
}

void JSConnectionsList::pop(JSGlobalObject* globalObject, JSCell* parser)
{
    allConnections()->remove(globalObject, parser);
}

void JSConnectionsList::pushActive(JSGlobalObject* globalObject, JSCell* parser)
{
    activeConnections()->add(globalObject, parser);
}

void JSConnectionsList::popActive(JSGlobalObject* globalObject, JSCell* parser)
{
    activeConnections()->remove(globalObject, parser);
}

} // namespace Bun
