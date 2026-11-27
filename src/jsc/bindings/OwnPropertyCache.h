#pragma once
#include "root.h"

namespace Bun {

// Remembers where one object keeps one own property, for as long as its structure stays the same.
class OwnPropertyCache {
public:
    using NameGetter = const JSC::Identifier& (*)(JSC::VM&);

    // As JSObject::getDirect: an accessor is returned and not called, and an absent property is the empty value.
    ALWAYS_INLINE JSC::JSValue get(const JSC::JSCell* cacheOwner, JSC::JSObject* object, NameGetter name)
    {
        if (object->structure() != m_structure.get()) [[unlikely]]
            return getSlow(cacheOwner, object, name);
        return JSC::isValidOffset(m_offset) ? object->getDirect(m_offset) : JSC::JSValue();
    }

    template<typename Visitor>
    void visit(Visitor& visitor) { visitor.append(m_structure); }

private:
    NEVER_INLINE JSC::JSValue getSlow(const JSC::JSCell* cacheOwner, JSC::JSObject* object, NameGetter nameGetter)
    {
        auto& vm = object->vm();
        auto& name = nameGetter(vm);
        auto* structure = object->structure();
        // An uncacheable dictionary moves properties without a transition, and compiled code has its own layout.
        if (structure->isUncacheableDictionary() || structure->isCompiledStructure())
            return object->getDirect(vm, name);
        auto offset = structure->get(vm, name);
        bool hasProperty = JSC::isValidOffset(offset);
        // A dictionary adds properties without a transition.
        if (hasProperty || !structure->isDictionary()) {
            m_offset = offset;
            m_structure.set(vm, cacheOwner, structure);
        }
        return hasProperty ? object->getDirect(offset) : JSC::JSValue();
    }

    JSC::WriteBarrier<JSC::Structure> m_structure;
    JSC::PropertyOffset m_offset { JSC::invalidOffset };
};

} // namespace Bun
