#pragma once

#include "root.h"

#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSString.h>
#include <JavaScriptCore/Structure.h>
#include <JavaScriptCore/WriteBarrier.h>
#include <array>
#include <span>
#include <utility>
#include <wtf/Vector.h>

namespace Bun {

class LintHost;

// Which properties the nodes of each type have, and the Structures for them. A member of LintHost. It's the same for all files.
// src/lint/js_plugin/layouts.rs says what there is. A Structure is made when the first node needs it: a project uses a part of the
// types.
struct LintNodeState {
    // In the order of `Layout` in layouts.rs.
    enum LayoutKind : uint8_t {
        TypeScript,
        Espree,
        Oxlint,
        OxlintJavaScript,
    };
    static constexpr size_t layoutKinds = 4;
    // The last has those of `Oxlint`.
    static constexpr size_t visitorKeyKinds = 3;
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
        False,
        EmptyList,
        Value,
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

    // How a node is filled in from its template. It's made with the template.
    struct Plan {
        // The offsets of what is the same in all the nodes. The template has it.
        WTF::Vector<uint8_t> same;
        // The others: an offset, and a `What` or the number of a field.
        WTF::Vector<std::pair<uint8_t, uint8_t>> own;
        // The offset of `parent`, which is one of `same` until the parent is made.
        uint8_t parent { 0 };
    };
    struct Template {
        JSC::JSObject* like;
        const Plan* plan;
    };

    bool isLoaded() const { return !m_words.isEmpty(); }
    // Asks Rust. Something has to be handled at the time. Returns false if the answer isn't as expected.
    bool load(JSC::JSGlobalObject*, LintHost*);

    LayoutKind kindFor(bool isEspree, bool isOxlint, bool shortensNodes) const
    {
        if (isOxlint)
            return shortensNodes ? OxlintJavaScript : Oxlint;
        return isEspree ? Espree : TypeScript;
    }

    size_t typeCount() const { return m_typeNames.size(); }
    const Layout& layout(LayoutKind kind, uint8_t type) const { return m_layouts[kind][type]; }
    // An object with the Structure of the nodes, and with what is the same in all of them. `which`: a bit for each of the fields in
    // `leftOut`, the first being the lowest: whether it's there. The object is null if an exception was thrown.
    Template templateFor(JSC::JSGlobalObject* globalObject, LintHost* host, LayoutKind kind, uint8_t type, unsigned which, bool isAlternate)
    {
        const Layout& layout = m_layouts[kind][type];
        unsigned index = layout.firstTemplate + which + (isAlternate ? 1u << std::popcount(layout.leftOut) : 0);
        JSC::JSObject* made = m_templates[index].get();
        if (!made) [[unlikely]]
            made = makeTemplate(globalObject, host, kind, type, which, isAlternate, index);
        return { made, &m_plans[index] };
    }
    // `node.type`
    JSC::JSString* typeName(JSC::VM&, LintHost*, uint8_t type);
    // One of `STRINGS` in src/lint/js_plugin/ast.rs. Null: there's no such string.
    JSC::JSString* knownString(JSC::VM&, LintHost*, uint32_t index);
    // What the nodes inherit from.
    JSC::JSObject* prototype(JSC::VM&, JSC::JSGlobalObject*, LintHost*, LayoutKind);
    // `sourceCode.visitorKeys`
    JSC::JSObject* visitorKeys(JSC::JSGlobalObject*, LintHost*, LayoutKind);
    std::optional<uint8_t> typeNamed(const WTF::String&) const;

    // The caller holds the host's cell lock: `load` changes the sizes.
    template<typename Visitor>
    void visit(Visitor& visitor)
    {
        visitor.append(deprecated);
        visitor.append(m_lazyEmptyList);
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
    }

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
    // By `LayoutKind`: the types in the order of `visitorKeys`, a name and the number of the type for each. For a type that nothing makes
    // it's `UINT32_MAX` less an index in `keysOfOtherTypes`.
    std::array<std::span<const uint32_t>, visitorKeyKinds> m_visitorKeyOrders;
    static constexpr std::array<ASCIILiteral, 5> keysOfOtherTypes { "argument"_s, ""_s, "expression"_s, "typeAnnotation"_s, "name arguments"_s };
    // Empty until they are needed.
    WTF::Vector<JSC::WriteBarrier<JSC::JSObject>> m_templates;
    // One for each of the templates.
    WTF::Vector<Plan> m_plans;
    // What a template has for `What::EmptyList`.
    JSC::WriteBarrier<JSC::JSCell> m_lazyEmptyList;
    WTF::Vector<JSC::WriteBarrier<JSC::JSString>> m_typeNames;
    WTF::Vector<JSC::WriteBarrier<JSC::JSString>> m_knownStrings;
    // By `LayoutKind`
    std::array<JSC::WriteBarrier<JSC::JSObject>, layoutKinds> m_sharedPrototypes;
    std::array<JSC::WriteBarrier<JSC::JSObject>, visitorKeyKinds> m_visitorKeys;
};

// An array of `length` times `undefined`, or null if there's no memory. `setIndexQuickly` is safe for all its indices.
// It isn't after `JSArray::tryCreate`, which makes room for a few items only once a plugin has put an accessor with an index for
// a name on `Array.prototype`. So never use `JSArray::tryCreate` in the plugin host.
JSC::JSArray* tryCreateFilledLintArray(JSC::VM&, JSC::JSGlobalObject*, unsigned length);

} // namespace Bun
