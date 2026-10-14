#pragma once

#include "root.h"

#include <JavaScriptCore/JSCInlines.h>
#include <array>

namespace Bun {

// Reads one property, always the same one, from whatever a plugin passes in. It remembers where the property is in the objects of
// a Structure, so that reading `range` from a node or a token is no lookup by name.
class LintPropertyCache {
public:
    void initialize(JSC::VM& vm, ASCIILiteral name) { m_name = JSC::Identifier::fromString(vm, name); }
    const JSC::Identifier& name() const { return m_name; }

    // The property if it's an own data property of an ordinary object, and nothing if not. Runs no JavaScript.
    // `owner` is the cell that visits this.
    ALWAYS_INLINE JSC::JSValue getOwnData(JSC::VM& vm, JSC::JSCell* owner, JSC::JSValue target)
    {
        if (!target.isCell()) [[unlikely]]
            return {};
        JSC::JSCell* cell = target.asCell();
        JSC::Structure* structure = cell->structure();
        auto bits = reinterpret_cast<uintptr_t>(structure);
        Entry& entry = m_entries[((bits >> 7) ^ (bits >> 13)) % m_entries.size()];
        if (entry.structure.get() == structure) [[likely]]
            return asObject(cell)->getDirect(entry.offset);
        return getOwnDataSlow(vm, owner, cell, entry);
    }

    // `target[name]`
    ALWAYS_INLINE JSC::JSValue get(JSC::JSGlobalObject* globalObject, JSC::JSCell* owner, JSC::JSValue target)
    {
        if (JSC::JSValue value = getOwnData(globalObject->vm(), owner, target)) [[likely]]
            return value;
        return target.get(globalObject, m_name);
    }

    template<typename Visitor>
    void visit(Visitor& visitor)
    {
        for (auto& entry : m_entries)
            visitor.append(entry.structure);
    }

private:
    struct Entry {
        JSC::WriteBarrier<JSC::Structure> structure;
        JSC::PropertyOffset offset { JSC::invalidOffset };
    };

    NEVER_INLINE JSC::JSValue getOwnDataSlow(JSC::VM& vm, JSC::JSCell* owner, JSC::JSCell* cell, Entry& entry)
    {
        JSC::Structure* structure = cell->structure();
        if (!cell->isObject() || structure->typeInfo().overridesGetOwnPropertySlot())
            return {};
        unsigned attributes;
        JSC::PropertyOffset offset = structure->get(vm, m_name, attributes);
        if (offset == JSC::invalidOffset || (attributes & (JSC::PropertyAttribute::Accessor | JSC::PropertyAttribute::CustomAccessorOrValue)))
            return {};
        // The offsets of a dictionary change.
        if (!structure->isDictionary()) {
            entry.structure.set(vm, owner, structure);
            entry.offset = offset;
        }
        return asObject(cell)->getDirect(offset);
    }

    JSC::Identifier m_name;
    std::array<Entry, 64> m_entries;
};

} // namespace Bun
