#pragma once

// The iteration protocol.

#include "engine/api/Collections.h"

namespace Engine {

// Goes through an iterable. It makes no iterator where nothing can tell.
class IteratorRecord {
public:
    // Empty at the end and after an exception.
    ALWAYS_INLINE JSC::JSValue stepValue(JSC::JSGlobalObject* globalObject)
    {
        if (m_next == Layout::arrayIterationMarker) {
            uint32_t index = m_position.asInt32();
            if (JSC::JSValue value = JSC::asObject(m_subject)->tryGetIndexQuickly(index)) {
                m_position = JSC::jsNumber(static_cast<int32_t>(index + 1));
                return value;
            }
        }
        return iterator_record_step_value(*this, globalObject);
    }

    // Closes the iterator if the callback throws.
    template<typename Callback> ALWAYS_INLINE void forEach(JSC::JSGlobalObject* globalObject, const Callback& callback)
    {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        while (true) {
            JSC::JSValue value = stepValue(globalObject);
            RETURN_IF_EXCEPTION(scope, void());
            if (!value)
                return;
            callback(value);
            if (scope.exception()) [[unlikely]]
                RELEASE_AND_RETURN(scope, iterator_record_close_on_throw(*this, globalObject));
        }
    }

private:
    static void checkLayout();

    JSC::JSValue m_position;
    JSC::EncodedJSValue m_next;
    JSC::JSValue m_subject;
};

inline void IteratorRecord::checkLayout()
{
    ENGINE_CHECK_SIZE(IteratorRecord, sizeOfIteratorRecord);
    ENGINE_CHECK_OFFSET(IteratorRecord, m_position, IteratorRecord_position);
    ENGINE_CHECK_OFFSET(IteratorRecord, m_next, IteratorRecord_next);
    ENGINE_CHECK_OFFSET(IteratorRecord, m_subject, IteratorRecord_subject);
}

} // namespace Engine

namespace JSC {

struct IterationRecord {
    JSValue iterator;
    JSValue nextMethod;
};

inline constexpr PropertyOffset iteratorResultObjectValuePropertyOffset = Engine::Layout::iteratorResultValueOffset;
inline constexpr PropertyOffset iteratorResultObjectDonePropertyOffset = Engine::Layout::iteratorResultDoneOffset;

inline JSObject* createIteratorResultObject(JSGlobalObject* globalObject, JSValue value, bool done) { return Engine::iterator_result_create(globalObject, value, done); }
inline JSValue iteratorMethod(JSGlobalObject* globalObject, JSObject* object) { return Engine::iterator_method_or_undefined(globalObject, object); }
inline bool hasIteratorMethod(JSGlobalObject* globalObject, JSValue value) { return value.isObject() && Engine::object_has_iterator_method(globalObject, value); }
inline IterationRecord iteratorDirect(JSGlobalObject* globalObject, JSValue iterator) { return { iterator, iterator.get(globalObject, globalObject->vm().propertyNames->next) }; }
inline JSValue iteratorNextExported(JSGlobalObject* globalObject, IterationRecord record, JSValue argument = {}) { return Engine::iterator_call_next(globalObject, record.iterator, record.nextMethod, argument); }

void forEachInIterable(JSGlobalObject* globalObject, JSValue iterable, const Invocable<void(VM&, JSGlobalObject*, JSValue)> auto& callback)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    Engine::IteratorRecord record;
    Engine::iterator_record_for_iterable(&record, globalObject, iterable);
    RETURN_IF_EXCEPTION(scope, void());
    RELEASE_AND_RETURN(scope, record.forEach(globalObject, [&](JSValue value) { callback(vm, globalObject, value); }));
}

void forEachInIterable(JSGlobalObject& globalObject, JSObject* iterable, JSValue iteratorMethod, const Invocable<void(VM&, JSGlobalObject&, JSValue)> auto& callback)
{
    auto& vm = getVM(&globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    Engine::IteratorRecord record;
    Engine::iterator_record_from_method(&record, &globalObject, iterable, iteratorMethod);
    RETURN_IF_EXCEPTION(scope, void());
    RELEASE_AND_RETURN(scope, record.forEach(&globalObject, [&](JSValue value) { callback(vm, globalObject, value); }));
}

class JSAsyncFromSyncIterator final : public JSNonFinalObject {
public:
    ENGINE_DECLARE_CLASS(AsyncFromSyncIterator)

    static JSAsyncFromSyncIterator* create(JSGlobalObject* globalObject, JSObject* syncIterator, JSValue nextMethod) { return Engine::async_from_sync_iterator_create(globalObject, syncIterator, nextMethod); }
};
ENGINE_CLASS_HAS_TYPE(JSAsyncFromSyncIterator, JSAsyncFromSyncIteratorType);

} // namespace JSC
