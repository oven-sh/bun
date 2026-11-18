#pragma once

// Maps, sets and weak references.

#include "engine/api/GlobalObject.h"

namespace JSC {

enum class IterationKind : uint8_t {
    Keys = Engine::IterationKind::Keys,
    Values = Engine::IterationKind::Values,
    Entries = Engine::IterationKind::Entries,
};

class JSOrderedCollection : public JSNonFinalObject {
public:
    uint32_t size() const { return Engine::fieldAt<uint32_t>(Engine::fieldAt<void*>(this, Engine::Layout::OrderedCollection_table), Engine::Layout::OrderedTable_live); }
};

class JSMap final : public JSOrderedCollection {
public:
    ENGINE_DECLARE_CLASS(Map)

    static JSMap* create(VM& vm, Structure* structure) { return Engine::map_create(vm, structure); }

    JSValue get(JSGlobalObject* globalObject, JSValue key) { return Engine::map_get(this, globalObject, key); }
    bool has(JSGlobalObject* globalObject, JSValue key) { return Engine::map_has(this, globalObject, key); }
    void set(JSGlobalObject* globalObject, JSValue key, JSValue value) { Engine::map_set(this, globalObject, key, value); }
    bool remove(JSGlobalObject* globalObject, JSValue key) { return Engine::map_remove(this, globalObject, key); }
    void clear(JSGlobalObject* globalObject) { Engine::map_clear(this, globalObject->vm()); }
};
ENGINE_CLASS_HAS_TYPE(JSMap, JSMapType);

class JSSet final : public JSOrderedCollection {
public:
    ENGINE_DECLARE_CLASS(Set)

    static JSSet* create(VM& vm, Structure* structure) { return Engine::set_create(vm, structure); }

    bool has(JSGlobalObject* globalObject, JSValue key) { return Engine::set_has(this, globalObject, key); }
    void add(JSGlobalObject* globalObject, JSValue key) { Engine::set_add(this, globalObject, key); }
    bool remove(JSGlobalObject* globalObject, JSValue key) { return Engine::set_remove(this, globalObject, key); }
};
ENGINE_CLASS_HAS_TYPE(JSSet, JSSetType);

class JSCollectionIterator : public JSInternalFieldObjectImpl<4> {
public:
    IterationKind kind() const { return static_cast<IterationKind>(internalField(Engine::Layout::collectionIteratorKindField).get().asInt32()); }

protected:
    JSValue valueFor(JSGlobalObject* globalObject, JSValue key, JSValue value) const
    {
        if (kind() == IterationKind::Entries)
            return constructArrayPair(globalObject, key, value);
        return kind() == IterationKind::Keys ? key : value;
    }
};

class JSMapIterator final : public JSCollectionIterator {
public:
    ENGINE_DECLARE_CLASS(MapIterator)

    // Empty at the end.
    struct NextResult {
        JSValue key;
        JSValue value;
    };

    static JSMapIterator* create(VM& vm, Structure* structure, JSMap* map, IterationKind kind) { return Engine::map_iterator_create(vm, structure, map, kind); }

    NextResult nextWithAdvance(VM& vm)
    {
        JSValue value;
        JSValue key = Engine::map_iterator_next(this, vm, value);
        return { key, value };
    }
    bool nextKeyValue(JSGlobalObject* globalObject, JSValue& key, JSValue& value)
    {
        auto result = nextWithAdvance(globalObject->vm());
        if (!result.key)
            return false;
        key = result.key;
        value = result.value;
        return true;
    }
    bool next(JSGlobalObject* globalObject, JSValue& value)
    {
        auto result = nextWithAdvance(globalObject->vm());
        if (!result.key)
            return false;
        value = valueFor(globalObject, result.key, result.value);
        return true;
    }
};
ENGINE_CLASS_HAS_TYPE(JSMapIterator, JSMapIteratorType);

class JSSetIterator final : public JSCollectionIterator {
public:
    ENGINE_DECLARE_CLASS(SetIterator)

    static JSSetIterator* create(VM& vm, Structure* structure, JSSet* set, IterationKind kind) { return Engine::set_iterator_create(vm, structure, set, kind); }

    bool next(JSGlobalObject* globalObject, JSValue& value)
    {
        JSValue key = Engine::set_iterator_next(this, globalObject->vm());
        if (!key)
            return false;
        value = valueFor(globalObject, key, key);
        return true;
    }
};
ENGINE_CLASS_HAS_TYPE(JSSetIterator, JSSetIteratorType);

inline bool canBeHeldWeakly(JSValue value) { return value.isObject() || (value.isSymbol() && !asSymbol(value)->uid().isRegistered()); }

class JSWeakMap final : public JSDestructibleObject {
public:
    ENGINE_DECLARE_CLASS(WeakMap)

    static JSWeakMap* create(VM& vm, Structure* structure) { return Engine::weak_map_create(vm, structure); }

    uint32_t size() const { return Engine::weak_map_size(this); }
    JSValue get(JSCell* key) { return Engine::weak_map_get(this, key); }
    bool has(JSCell* key) { return Engine::weak_map_has(this, key); }
    void set(VM&, JSCell* key, JSValue value) { Engine::weak_map_set(this, key, value); }
};
ENGINE_CLASS_HAS_TYPE(JSWeakMap, JSWeakMapType);

class JSWeakSet final : public JSDestructibleObject {
public:
    ENGINE_DECLARE_CLASS(WeakSet)

    static JSWeakSet* create(VM& vm, Structure* structure) { return Engine::weak_set_create(vm, structure); }

    bool has(JSCell* key) { return Engine::weak_set_has(this, key); }
    void add(VM&, JSCell* key) { Engine::weak_set_add(this, key); }
    void takeSnapshot(JSGlobalObject* globalObject, MarkedArgumentBuffer& keys)
    {
        Engine::weak_set_for_each(this, globalObject, [](void* keys, EncodedJSValue key) { static_cast<MarkedArgumentBuffer*>(keys)->append(JSValue::decode(key)); }, &keys);
    }
};
ENGINE_CLASS_HAS_TYPE(JSWeakSet, JSWeakSetType);

class JSFinalizationRegistry final : public JSDestructibleObject {
public:
    ENGINE_DECLARE_CLASS(FinalizationRegistry)

    JSObject* callback() const { return Engine::finalization_registry_callback(this); }
};

} // namespace JSC
