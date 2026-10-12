#pragma once

#include "root.h"

#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSString.h>
#include <JavaScriptCore/Structure.h>
#include <array>
#include <span>
#include <wtf/Vector.h>
#include <wtf/text/WTFString.h>

namespace Bun {

class LintHost;

// `TokenKind` in src/lint/tokens/mod.rs
enum class LintTokenKind : uint8_t {
    Boolean,
    Identifier,
    JSXIdentifier,
    JSXText,
    Keyword,
    Null,
    Numeric,
    PrivateIdentifier,
    Punctuator,
    RegularExpression,
    String,
    Template,
    Line,
    Block,
    Shebang,
};
static constexpr size_t lintTokenKindCount = 15;

// The tokens of the current file, or its comments. Everything that searches goes through the three spans and keeps nothing but
// indices while JavaScript runs.
struct LintTokenList {
    uint32_t count() const { return static_cast<uint32_t>(starts.size()); }

    bool isLoaded { false };
    std::span<const uint32_t> starts;
    std::span<const uint32_t> ends;
    // `LintTokenKind`, not checked
    std::span<const uint8_t> kinds;
    // The object for each token, empty until a plugin gets it. The host's cell lock guards its size.
    WTF::Vector<JSC::WriteBarrier<JSC::JSObject>> objects;
    // `ast.tokens` or `ast.comments`
    JSC::WriteBarrier<JSC::JSArray> all;
};

// The part of LintHost that ESLint's `TokenStore` needs.
struct LintTokenState {
    void finishCreation(JSC::VM&, JSC::JSGlobalObject*, LintHost*);
    template<typename Visitor> void visit(Visitor&);
    // Forgets the file. The caller holds the host's cell lock.
    void reset();

    // Built once.
    JSC::WriteBarrier<JSC::JSObject> constructor;
    JSC::WriteBarrier<JSC::Structure> instanceStructure;
    JSC::WriteBarrier<JSC::Structure> tokenStructure;
    JSC::WriteBarrier<JSC::Structure> regexTokenStructure;
    JSC::WriteBarrier<JSC::Structure> regexStructure;
    std::array<JSC::WriteBarrier<JSC::JSString>, lintTokenKindCount> typeNames;
    JSC::Identifier rangeName;
    JSC::Identifier includeCommentsName;
    JSC::Identifier skipName;
    JSC::Identifier countName;
    JSC::Identifier filterName;

    // Where `range` is in the objects of a Structure, so that reading it from a node or a token is no lookup by name.
    struct RangeOffset {
        JSC::WriteBarrier<JSC::Structure> structure;
        JSC::PropertyOffset offset { JSC::invalidOffset };
    };
    std::array<RangeOffset, 64> rangeOffsets;

    // Of the current file.
    LintTokenList tokens;
    LintTokenList comments;
    // What the spans point into: the messages of src/lint/js_plugin/tokens.rs.
    WTF::Vector<uint32_t> tokenMessage;
    WTF::Vector<uint32_t> commentMessage;
    // The tokens whose `value` isn't a part of the text, by index, in ascending order.
    WTF::Vector<std::pair<uint32_t, WTF::String>> decodedValues;
    JSC::WriteBarrier<JSC::JSArray> tokensAndComments;
};

template<typename Visitor>
void LintTokenState::visit(Visitor& visitor)
{
    visitor.append(constructor);
    visitor.append(instanceStructure);
    visitor.append(tokenStructure);
    visitor.append(regexTokenStructure);
    visitor.append(regexStructure);
    for (auto& name : typeNames)
        visitor.append(name);
    for (auto& entry : rangeOffsets)
        visitor.append(entry.structure);
    for (auto* list : { &tokens, &comments }) {
        for (auto& object : list->objects)
            visitor.append(object);
        visitor.append(list->all);
    }
    visitor.append(tokensAndComments);
}

// Adds `TokenStore` and the functions for `ast.tokens`, `ast.comments` and `tokensAndComments` to `native`.
void addLintTokenFunctions(JSC::JSGlobalObject*, JSC::JSObject* native);

} // namespace Bun
