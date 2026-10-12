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
// src/lint/js_plugin/layouts.rs says what there is. A Structure is made when the first node needs it: a project uses a part of the
// types.
struct LintNodeState {
    // In the order of `Layout` in layouts.rs.
    enum LayoutKind : uint8_t {
        OldTypeScript,
        OldEspree,
        TypeScript,
        Espree,
        Oxlint,
    };
    static constexpr size_t layoutKinds = 5;
    // What is in a property, if it isn't the field with that number.
    enum What : uint32_t {
        Type = 0xF0,
        Start,
        End,
        Range,
        Parent,
        Loc,
        Undefined,
        Comments,
        Tokens,
        Deprecated,
    };

    // The nodes of a type.
    struct Layout {
        // How many words the tree has for a node.
        uint32_t fieldCount { 0 };
        // A bit for each field.
        uint32_t visitorKeys { 0 };
        uint32_t leftOut { 0 };
        // A name and a `What` for each.
        std::span<const uint32_t> properties;
        // The same in the other order, for the nodes that the tree names. Empty: there's no other.
        std::span<const uint32_t> alternate;
        // In the templates: the first of one for each set of the fields in `leftOut` that are there, then the same for `alternate`.
        uint32_t firstTemplate { 0 };
    };

    bool isLoaded() const { return !m_words.isEmpty(); }
    // Asks Rust. Something has to be handled at the time. Returns false if the answer isn't as expected.
    bool load(JSC::JSGlobalObject*, LintHost*);

    // The nodes are laid out as the parser of the real tool lays them out.
    bool isExact { false };
    // `loc` is made with the node, and not when it's first read.
    bool hasEagerLoc { false };
    LayoutKind kindFor(bool isEspree, bool isOxlint) const
    {
        // oxlint has one tree for all files. There's no layout of it for the tree of espree.
        if (!isExact || (isOxlint && isEspree))
            return isEspree ? OldEspree : OldTypeScript;
        return isOxlint ? Oxlint : isEspree ? Espree
                                            : TypeScript;
    }

    size_t typeCount() const { return m_typeNames.size(); }
    const Layout& layout(LayoutKind kind, uint8_t type) const { return m_layouts[kind][type]; }
    // An object with the Structure of the nodes, and with what is the same in all of them. `which`: a bit for each of the fields in
    // `leftOut`, the first being the lowest: whether it's there.
    JSC::JSObject* templateFor(JSC::JSGlobalObject* globalObject, LintHost* host, LayoutKind kind, uint8_t type, unsigned which, bool isAlternate)
    {
        const Layout& layout = m_layouts[kind][type];
        unsigned index = layout.firstTemplate + which + (isAlternate ? 1u << std::popcount(layout.leftOut) : 0);
        JSC::JSObject* made = m_templates[index].get();
        return made ? made : makeTemplate(globalObject, host, kind, type, which, isAlternate, index);
    }
    // `node.type`
    JSC::JSString* typeName(JSC::VM&, LintHost*, uint8_t type);
    // One of `STRINGS` in src/lint/js_plugin/ast.rs. Null: there's no such string.
    JSC::JSString* knownString(JSC::VM&, LintHost*, uint32_t index);
    // What the nodes of a type inherit from.
    JSC::JSObject* prototype(JSC::VM&, JSC::JSGlobalObject*, LintHost*, LayoutKind, uint8_t type);
    // ESLint's `visitorKeys`
    JSC::JSObject* visitorKeys(JSC::JSGlobalObject*, LintHost*, bool isEspree);
    std::optional<uint8_t> typeNamed(const WTF::String&) const;

    // The caller holds the host's cell lock: `load` changes the sizes.
    template<typename Visitor>
    void visit(Visitor& visitor)
    {
        visitor.append(nodePrototype);
        visitor.append(deprecated);
        for (auto& it : m_visitorKeys)
            visitor.append(it);
        for (auto& it : m_sharedPrototypes)
            visitor.append(it);
        for (auto& it : m_templates)
            visitor.append(it);
        for (auto& it : m_typeNames)
            visitor.append(it);
        for (auto& it : m_knownStrings)
            visitor.append(it);
        for (auto& it : m_prototypes)
            visitor.append(it);
    }

    // With the old layouts all nodes inherit from it.
    JSC::WriteBarrier<JSC::JSObject> nodePrototype;
    // By `Type.property`: a getter and a setter.
    JSC::WriteBarrier<JSC::JSObject> deprecated;

private:
    JSC::JSObject* makeTemplate(JSC::JSGlobalObject*, LintHost*, LayoutKind, uint8_t type, unsigned which, bool isAlternate, unsigned index);
    std::span<const Latin1Character> name(uint32_t reference) const { return m_names.subspan(reference >> 8, reference & 255); }

    // A copy of the answer. The spans point into it.
    WTF::Vector<uint32_t> m_words;
    std::span<const Latin1Character> m_names;
    std::span<const uint32_t> m_knownStringNames;
    WTF::Vector<uint32_t> m_typeNameReferences;
    std::array<WTF::Vector<Layout>, layoutKinds> m_layouts;
    // The types in the order of `visitorKeys`, for typescript-estree and for espree: a name and the number of the type for each, or
    // `noType` for a type of old that nothing makes, whose only key is `argument`.
    std::array<std::span<const uint32_t>, 2> m_visitorKeyOrders;
    static constexpr uint32_t noType = UINT32_MAX;
    // Empty until they are needed.
    WTF::Vector<JSC::WriteBarrier<JSC::JSObject>> m_templates;
    WTF::Vector<JSC::WriteBarrier<JSC::JSString>> m_typeNames;
    WTF::Vector<JSC::WriteBarrier<JSC::JSString>> m_knownStrings;
    // With the old layouts: of each type, for typescript-estree and for espree.
    WTF::Vector<JSC::WriteBarrier<JSC::JSObject>> m_prototypes;
    // By `LayoutKind`
    std::array<JSC::WriteBarrier<JSC::JSObject>, layoutKinds> m_sharedPrototypes;
    std::array<JSC::WriteBarrier<JSC::JSObject>, 2> m_visitorKeys;
};

} // namespace Bun
