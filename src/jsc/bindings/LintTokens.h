#pragma once

#include "root.h"

#include <JavaScriptCore/CustomGetterSetter.h>
#include <JavaScriptCore/GetterSetter.h>
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

// How the object for a token or a comment is laid out. It's what the parser of the real tool makes, which depends on the kind.
struct LintTokenShape {
    enum Kind : uint8_t {
        EspreeToken,
        EspreeRegex,
        EspreeTemplate,
        EspreeComment,
        TypeScriptToken,
        TypeScriptRegex,
        OxlintToken,
        OxlintComment,
    };
    static constexpr size_t kindCount = 8;

    JSC::WriteBarrier<JSC::Structure> structure;
    // What's in `loc`. With ESLint a CustomGetterSetter, which the location replaces when it's first read. oxlint has a getter.
    JSC::WriteBarrier<JSC::JSCell> loc;
    // `invalidOffset`: it has no such property.
    JSC::PropertyOffset typeOffset { JSC::invalidOffset };
    JSC::PropertyOffset valueOffset { JSC::invalidOffset };
    JSC::PropertyOffset startOffset { JSC::invalidOffset };
    JSC::PropertyOffset endOffset { JSC::invalidOffset };
    JSC::PropertyOffset locOffset { JSC::invalidOffset };
    JSC::PropertyOffset rangeOffset { JSC::invalidOffset };
    JSC::PropertyOffset regexOffset { JSC::invalidOffset };
    JSC::PropertyOffset cachedLocOffset { JSC::invalidOffset };
};

// How a `loc` is laid out.
struct LintLocShape {
    enum Kind : uint8_t {
        // acorn's `SourceLocation` of two `Position`
        EspreeToken,
        // A plain object of two `Position`: what espree makes itself, for templates and comments.
        EspreeOther,
        // `{ end: { column, line }, start: { column, line } }`
        TypeScript,
        Oxlint,
    };
    static constexpr size_t kindCount = 4;

    JSC::WriteBarrier<JSC::Structure> structure;
    JSC::WriteBarrier<JSC::Structure> positionStructure;
    // `end` before `start`, and `column` before `line`.
    bool isReversed { false };
};

// The tokens of the current file, or its comments. The three spans are Rust's memory: see src/lint/js_plugin/tokens.rs. Everything
// that searches goes through them, and keeps nothing but indices while JavaScript runs.
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
    std::array<LintTokenShape, LintTokenShape::kindCount> shapes;
    std::array<LintLocShape, LintLocShape::kindCount> locShapes;
    // `{ flags, pattern }`, and oxlint's `{ pattern, flags }`
    JSC::WriteBarrier<JSC::Structure> regexStructure;
    JSC::WriteBarrier<JSC::Structure> oxlintRegexStructure;
    std::array<JSC::WriteBarrier<JSC::JSString>, lintTokenKindCount> typeNames;
    // `comments` and `tokens` of a `Program`: what's in the property with oxlint, and with ESLint until it's read.
    struct ListOfProgram {
        JSC::Identifier name;
        JSC::WriteBarrier<JSC::GetterSetter> getter;
        JSC::WriteBarrier<JSC::CustomGetterSetter> customValue;
    };
    std::array<ListOfProgram, 2> listsOfProgram;
    // Where oxlint's getter keeps the `loc` that it has made. Plugins can't see it.
    JSC::Identifier cachedLocName;
    JSC::Identifier includeCommentsName;
    JSC::Identifier skipName;
    JSC::Identifier countName;
    JSC::Identifier filterName;

    // Of the current file.
    LintTokenList tokens;
    LintTokenList comments;
    // Whether a search finds the nearest token from any place in the text, as in oxlint. ESLint's needs the start or the end of a
    // token or a comment.
    bool searchesEverywhere { false };
    // The tokens whose `value` isn't a part of the text, by index, in ascending order.
    WTF::Vector<std::pair<uint32_t, WTF::String>> decodedValues;
    JSC::WriteBarrier<JSC::JSArray> tokensAndComments;
};

template<typename Visitor>
void LintTokenState::visit(Visitor& visitor)
{
    visitor.append(constructor);
    visitor.append(instanceStructure);
    for (auto& shape : shapes) {
        visitor.append(shape.structure);
        visitor.append(shape.loc);
    }
    for (auto& shape : locShapes) {
        visitor.append(shape.structure);
        visitor.append(shape.positionStructure);
    }
    visitor.append(regexStructure);
    visitor.append(oxlintRegexStructure);
    for (auto& name : typeNames)
        visitor.append(name);
    for (auto& list : listsOfProgram) {
        visitor.append(list.getter);
        visitor.append(list.customValue);
    }
    for (auto* list : { &tokens, &comments }) {
        for (auto& object : list->objects)
            visitor.append(object);
        visitor.append(list->all);
    }
    visitor.append(tokensAndComments);
}

// `ast.comments` and `sourceCode.tokensAndComments` of the current file. They throw if there's none.
JSC::EncodedJSValue lintComments(JSC::JSGlobalObject*);
JSC::EncodedJSValue lintTokensAndComments(JSC::JSGlobalObject*);

// `getTokenBefore(nodeOrToken, { includeComments: true })`, or the same with `getTokenAfter`
JSC::EncodedJSValue lintTokenOrCommentNextTo(JSC::JSGlobalObject*, JSC::JSValue nodeOrToken, bool isAfter);
// `getCommentsBefore(nodeOrToken)` or `getCommentsAfter(nodeOrToken)`
JSC::EncodedJSValue lintCommentsNextTo(JSC::JSGlobalObject*, JSC::JSValue nodeOrToken, bool isAfter);
// `getCommentsInside(node)`
JSC::EncodedJSValue lintCommentsInside(JSC::JSGlobalObject*, JSC::JSValue node);

// Methods of `SourceCode`. ESLint 10 only has the first.
JSC_DECLARE_HOST_FUNCTION(jsLintIsSpaceBetween);
JSC_DECLARE_HOST_FUNCTION(jsLintIsSpaceBetweenTokens);
JSC_DECLARE_HOST_FUNCTION(jsLintGetTokenOrCommentBefore);
JSC_DECLARE_HOST_FUNCTION(jsLintGetTokenOrCommentAfter);

// Adds `TokenStore`, `defineTokenLists`, `comments` and `tokensAndComments` to `native`.
void addLintTokenFunctions(JSC::JSGlobalObject*, JSC::JSObject* native);

} // namespace Bun
