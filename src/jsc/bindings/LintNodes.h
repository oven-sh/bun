#pragma once

#include "root.h"

#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSString.h>
#include <JavaScriptCore/Structure.h>
#include <JavaScriptCore/WriteBarrier.h>
#include <array>
#include <span>
#include <wtf/Vector.h>

namespace Bun {

class LintHost;

// Which properties the nodes of each type have, and the Structures for them. A member of LintHost. It's the same for all files.
// src/lint/js_plugin/schema.rs (`write_layouts`) says what there is. A Structure is made when the first node needs it: a project uses
// a part of the types.
struct LintNodeState {
    // typescript-estree and espree
    static constexpr size_t dialects = 2;
    // What is in a property, if it isn't the field with that number.
    enum What : uint32_t {
        Type = 0xF0,
        Start,
        End,
        Range,
        Parent,
    };

    // The nodes of a type in a dialect.
    struct Layout {
        // How many words the tree has for a node.
        uint32_t fieldCount { 0 };
        // A bit for each field.
        uint32_t visitorKeys { 0 };
        uint32_t leftOut { 0 };
        // A name and a `What` for each.
        std::span<const uint32_t> properties;
        // In `structures`: the first of one for each set of the fields in `leftOut` that are there.
        uint32_t firstStructure { 0 };
    };

    bool isLoaded() const { return !m_words.isEmpty(); }
    // Asks Rust. Something has to be handled at the time. Returns false if the answer isn't as expected.
    bool load(JSC::JSGlobalObject*, LintHost*);

    size_t typeCount() const { return m_typeNames.size(); }
    const Layout& layout(bool isEspree, uint8_t type) const { return m_layouts[isEspree][type]; }
    // `which`: a bit for each of the fields in `leftOut`, the first being the lowest: whether it's there.
    JSC::Structure* structure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, LintHost* host, bool isEspree, uint8_t type, unsigned which)
    {
        JSC::Structure* made = m_structures[m_layouts[isEspree][type].firstStructure + which].get();
        return made ? made : makeStructure(vm, globalObject, host, isEspree, type, which);
    }
    // `node.type`
    JSC::JSString* typeName(JSC::VM&, LintHost*, uint8_t type);
    // One of `STRINGS` in src/lint/js_plugin/ast.rs. Null: there's no such string.
    JSC::JSString* knownString(JSC::VM&, LintHost*, uint32_t index);
    // What the nodes of a type inherit from, which inherits from `nodePrototype`.
    JSC::JSObject* prototype(JSC::VM&, JSC::JSGlobalObject*, LintHost*, bool isEspree, uint8_t type);
    // ESLint's `visitorKeys`
    JSC::JSObject* visitorKeys(JSC::JSGlobalObject*, LintHost*, bool isEspree);
    std::optional<uint8_t> typeNamed(const WTF::String&) const;

    // The caller holds the host's cell lock: `load` changes the sizes.
    template<typename Visitor>
    void visit(Visitor& visitor)
    {
        visitor.append(nodePrototype);
        for (auto& it : m_visitorKeys)
            visitor.append(it);
        for (auto& it : m_structures)
            visitor.append(it);
        for (auto& it : m_typeNames)
            visitor.append(it);
        for (auto& it : m_knownStrings)
            visitor.append(it);
        for (auto& it : m_prototypes)
            visitor.append(it);
    }

    JSC::WriteBarrier<JSC::JSObject> nodePrototype;

private:
    JSC::Structure* makeStructure(JSC::VM&, JSC::JSGlobalObject*, LintHost*, bool isEspree, uint8_t type, unsigned which);
    std::span<const Latin1Character> name(uint32_t reference) const { return m_names.subspan(reference >> 8, reference & 255); }

    // A copy of the answer. The spans point into it.
    WTF::Vector<uint32_t> m_words;
    std::span<const Latin1Character> m_names;
    std::span<const uint32_t> m_knownStringNames;
    WTF::Vector<uint32_t> m_typeNameReferences;
    std::array<WTF::Vector<Layout>, dialects> m_layouts;
    // Empty until they are needed.
    WTF::Vector<JSC::WriteBarrier<JSC::Structure>> m_structures;
    WTF::Vector<JSC::WriteBarrier<JSC::JSString>> m_typeNames;
    WTF::Vector<JSC::WriteBarrier<JSC::JSString>> m_knownStrings;
    WTF::Vector<JSC::WriteBarrier<JSC::JSObject>> m_prototypes;
    std::array<JSC::WriteBarrier<JSC::JSObject>, dialects> m_visitorKeys;
};

} // namespace Bun
