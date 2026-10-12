// ESLint's `SourceCode` for JavaScript lint plugins, apart from the token methods, which are in LintTokens.cpp.
//
// Ported from ESLint's lib/languages/js/source-code/source-code.js (MIT License, see LICENSE.md).
//
// The methods don't look at `this`: see LintHost.h. Each argument and each property of it is read once.

#include "LintSourceCode.h"

#include "LintHost.h"
#include <JavaScriptCore/GetterSetter.h>
#include <JavaScriptCore/InternalFunction.h>
#include <JavaScriptCore/JSBigInt.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSWeakMapInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/ObjectInitializationScope.h>
#include <JavaScriptCore/StringObject.h>
#include <array>
#include <wtf/text/MakeString.h>

namespace Bun {
using namespace JSC;

namespace {

// Calls a function of the program.
JSValue callHook(JSGlobalObject* globalObject, const WriteBarrier<JSObject>& hook)
{
    JSObject* function = hook.get();
    return call(globalObject, function, getCallData(function), jsUndefined(), ArgList());
}

// `if (!node) throw ..`
bool requireNode(JSGlobalObject* globalObject, ThrowScope& scope, JSValue node)
{
    if (node.toBoolean(globalObject))
        return true;
    throwTypeError(globalObject, scope, "Missing required argument: node."_s);
    return false;
}

// `range[0]` and `range[1]`, if `range` is an array of small integers, as a parser makes it.
ALWAYS_INLINE bool getInt32Pair(JSValue range, int32_t& first, int32_t& second)
{
    if (!range.isCell() || !isJSArray(range.asCell())) [[unlikely]]
        return false;
    JSArray* array = asArray(range);
    if (array->indexingType() != ArrayWithInt32 || array->length() < 2) [[unlikely]]
        return false;
    JSValue start = array->getIndexQuickly(0), end = array->getIndexQuickly(1);
    // A hole.
    if (!start || !end) [[unlikely]]
        return false;
    first = start.asInt32();
    second = end.asInt32();
    return true;
}

// An index for `text.slice`.
unsigned clampToText(double index, unsigned length)
{
    if (std::isnan(index))
        return 0;
    index = std::trunc(index);
    if (index < 0)
        return static_cast<unsigned>(std::max(length + index, 0.0));
    return static_cast<unsigned>(std::min<double>(index, length));
}

JSArray* createLines(JSGlobalObject* globalObject, LintHost* host, JSString* text)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    StringView view = host->textString();
    // No line is added while this runs: nothing here calls into JavaScript.
    auto& starts = host->lineStarts();
    MarkedArgumentBuffer lines;
    lines.ensureCapacity(starts.size());
    for (size_t i = 0; i < starts.size(); ++i) {
        unsigned start = starts[i];
        unsigned end = view.length();
        if (i + 1 < starts.size()) {
            end = starts[i + 1] - 1;
            if (view[end] == '\n' && end > start && view[end - 1] == '\r')
                --end;
        }
        lines.append(jsSubstringOfResolved(vm, text, start, end - start));
    }
    if (lines.hasOverflowed()) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return nullptr;
    }
    RELEASE_AND_RETURN(scope, constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), lines));
}

JSArray* linesOf(JSGlobalObject* globalObject, LintHost* host)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    LintSourceCodeState& state = host->sourceCode;
    if (JSArray* lines = state.lines.get())
        return lines;
    JSArray* lines = createLines(globalObject, host, host->text());
    RETURN_IF_EXCEPTION(scope, nullptr);
    state.lines.set(vm, host, lines);
    return lines;
}

// `value === "text"`
bool isText(JSGlobalObject* globalObject, JSValue value, ASCIILiteral text)
{
    return value.isString() && asString(value)->view(globalObject) == text;
}

// Calls a method of `TokenStore`. None of them looks at `this`.
JSValue callTokenMethod(JSGlobalObject* globalObject, const WriteBarrier<JSObject>& method, JSValue nodeOrToken, JSValue options = {})
{
    JSObject* function = method.get();
    MarkedArgumentBuffer arguments;
    arguments.append(nodeOrToken);
    if (options)
        arguments.append(options);
    return call(globalObject, function, getCallData(function), jsUndefined(), arguments);
}

// `value.length`, which is 0 for what has none.
double lengthOf(JSGlobalObject* globalObject, JSValue value)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    if (value.isCell() && isJSArray(value.asCell())) [[likely]]
        return asArray(value)->length();
    JSValue length = value.get(globalObject, globalObject->vm().propertyNames->length);
    RETURN_IF_EXCEPTION(scope, 0);
    RELEASE_AND_RETURN(scope, length.toNumber(globalObject));
}

// ESLint's `getInlineConfigNodes()`
JSArray* inlineConfigNodesOf(JSGlobalObject* globalObject, LintHost* host)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    LintSourceCodeState& state = host->sourceCode;
    if (JSArray* nodes = state.inlineConfigNodes.get())
        return nodes;
    JSValue comments = callHook(globalObject, state.comments);
    RETURN_IF_EXCEPTION(scope, nullptr);
    // `ask::CONFIG_COMMENTS` in src/lint/js_plugin/wire.rs
    constexpr uint32_t configComments = 13;
    LintSpan answer = host->isLinting() ? Bun__Lint__ask(globalObject, configComments, nullptr, 0) : LintSpan {};
    state.configComments = { reinterpret_cast<const LintSourceCodeState::ConfigComment*>(answer.ptr), answer.len / sizeof(LintSourceCodeState::ConfigComment) };
    MarkedArgumentBuffer nodes;
    for (auto& it : state.configComments) {
        JSValue comment = lintGetIndex(globalObject, comments, it.comment);
        RETURN_IF_EXCEPTION(scope, nullptr);
        nodes.append(comment);
    }
    if (nodes.hasOverflowed()) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return nullptr;
    }
    JSArray* result = constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), nodes);
    RETURN_IF_EXCEPTION(scope, nullptr);
    state.inlineConfigNodes.set(vm, host, result);
    return result;
}

const Vector<uint32_t>& lastDescendantsOf(LintSourceCodeState& state)
{
    auto& last = state.lastDescendants;
    size_t count = state.parents.size();
    if (last.size() == count)
        return last;
    last.fill(0, count);
    // What is in a node has a higher number.
    for (size_t id = count; id-- > 1;) {
        if (!last[id])
            last[id] = static_cast<uint32_t>(id);
        uint32_t parent = state.parents[id];
        if (parent < id && last[parent] < last[id])
            last[parent] = last[id];
    }
    return last;
}

} // namespace

// ───────────── properties ─────────────

JSC_DEFINE_HOST_FUNCTION(jsLintSourceCodeText, (JSGlobalObject * globalObject, CallFrame*))
{
    return JSValue::encode(LintHost::from(globalObject)->text());
}

JSC_DEFINE_HOST_FUNCTION(jsLintSourceCodeHasBOM, (JSGlobalObject * globalObject, CallFrame*))
{
    return JSValue::encode(jsBoolean(LintHost::from(globalObject)->hasBOM()));
}

JSC_DEFINE_HOST_FUNCTION(jsLintSourceCodeAst, (JSGlobalObject * globalObject, CallFrame*))
{
    return JSValue::encode(callHook(globalObject, LintHost::from(globalObject)->sourceCode.program));
}

JSC_DEFINE_HOST_FUNCTION(jsLintSourceCodeLines, (JSGlobalObject * globalObject, CallFrame*))
{
    return JSValue::encode(linesOf(globalObject, LintHost::from(globalObject)));
}

JSC_DEFINE_HOST_FUNCTION(jsLintSourceCodeLineStartIndices, (JSGlobalObject * globalObject, CallFrame*))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    LintHost* host = LintHost::from(globalObject);
    LintSourceCodeState& state = host->sourceCode;
    if (JSArray* indices = state.lineStartIndices.get())
        return JSValue::encode(indices);
    auto& starts = host->lineStarts();
    JSArray* indices;
    {
        ObjectInitializationScope initializationScope(vm);
        indices = JSArray::tryCreateUninitializedRestricted(initializationScope, globalObject->arrayStructureForIndexingTypeDuringAllocation(ArrayWithInt32), starts.size());
        if (!indices) [[unlikely]] {
            throwOutOfMemoryError(globalObject, scope);
            return {};
        }
        // A text is shorter than 2^31.
        for (unsigned i = 0; i < starts.size(); ++i)
            indices->initializeIndex(initializationScope, i, jsNumber(static_cast<int32_t>(starts[i])));
    }
    state.lineStartIndices.set(vm, host, indices);
    return JSValue::encode(indices);
}

JSC_DEFINE_HOST_FUNCTION(jsLintSourceCodeTokensAndComments, (JSGlobalObject * globalObject, CallFrame*))
{
    return JSValue::encode(callHook(globalObject, LintHost::from(globalObject)->sourceCode.tokensAndComments));
}

JSC_DEFINE_HOST_FUNCTION(jsLintSourceCodeVisitorKeys, (JSGlobalObject * globalObject, CallFrame*))
{
    LintHost* host = LintHost::from(globalObject);
    return JSValue::encode(host->sourceCode.visitorKeys->getIndex(globalObject, host->isEspree() ? 1 : 0));
}

// What typescript-eslint's parser gives without type information. Rules take the maps for a sign of TypeScript. There are no
// nodes of TypeScript's own tree to put in them.
JSC_DEFINE_HOST_FUNCTION(jsLintSourceCodeParserServices, (JSGlobalObject * globalObject, CallFrame*))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    LintHost* host = LintHost::from(globalObject);
    LintSourceCodeState& state = host->sourceCode;
    if (JSObject* services = state.parserServices.get())
        return JSValue::encode(services);
    JSObject* services;
    if (host->isEspree())
        services = constructEmptyObject(globalObject);
    else {
        JSValue options = callHook(globalObject, state.parserOptions);
        RETURN_IF_EXCEPTION(scope, {});
        services = constructEmptyObject(vm, state.servicesStructure.get());
        PropertyOffset offset = 0;
        for (auto* name : { &state.emitDecoratorMetadata, &state.experimentalDecorators, &state.isolatedDeclarations }) {
            JSValue option = options.get(globalObject, *name);
            RETURN_IF_EXCEPTION(scope, {});
            services->putDirectOffset(vm, offset++, jsBoolean(option.isTrue()));
        }
        services->putDirectOffset(vm, offset++, jsNull());
        services->putDirectOffset(vm, offset++, JSWeakMap::create(vm, globalObject->weakMapStructure()));
        services->putDirectOffset(vm, offset++, JSWeakMap::create(vm, globalObject->weakMapStructure()));
    }
    state.parserServices.set(vm, host, services);
    return JSValue::encode(services);
}

JSC_DEFINE_HOST_FUNCTION(jsLintSourceCodeScopeManager, (JSGlobalObject * globalObject, CallFrame*))
{
    return JSValue::encode(callHook(globalObject, LintHost::from(globalObject)->sourceCode.scopeManager));
}

JSC_DEFINE_HOST_FUNCTION(jsLintSourceCodeIsESTree, (JSGlobalObject*, CallFrame*))
{
    return JSValue::encode(jsBoolean(true));
}

// ───────────── methods ─────────────

// `SourceCode.splitLines(text)`
JSC_DEFINE_HOST_FUNCTION(jsLintSplitLines, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue text = callFrame->argument(0);
    if (auto* object = dynamicDowncast<StringObject>(text))
        text = object->internalValue();
    if (!text.isString()) {
        // `text.split` of something else.
        text.get(globalObject, Identifier::fromString(vm, "split"_s));
        RETURN_IF_EXCEPTION(scope, {});
        return throwVMTypeError(globalObject, scope, "text.split is not a function"_s);
    }
    String string = asString(text)->value(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    MarkedArgumentBuffer lines;
    StringView view = string;
    unsigned start = 0, length = view.length();
    for (unsigned i = 0; i < length; ++i) {
        char16_t character = view[i];
        if (character != '\n' && character != '\r' && (character | 1) != 0x2029)
            continue;
        lines.append(jsSubstringOfResolved(vm, asString(text), start, i - start));
        if (character == '\r' && i + 1 < length && view[i + 1] == '\n')
            ++i;
        start = i + 1;
    }
    lines.append(jsSubstringOfResolved(vm, asString(text), start, length - start));
    if (lines.hasOverflowed()) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    RELEASE_AND_RETURN(scope, JSValue::encode(constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), lines)));
}

namespace {

// `getText` for everything but a node or a token as it was made, with small numbers or nothing beside it.
NEVER_INLINE EncodedJSValue getTextSlow(JSGlobalObject* globalObject, CallFrame* callFrame, LintHost* host)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue node = callFrame->argument(0);
    if (!node.toBoolean(globalObject))
        return JSValue::encode(host->text());
    JSValue range = host->sourceCode.range.get(globalObject, host, node);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue before = callFrame->argument(1), after = callFrame->argument(2);

    // `Math.max(node.range[0] - (beforeCount || 0), 0)`
    JSValue first = lintGetIndex(globalObject, range, 0);
    RETURN_IF_EXCEPTION(scope, {});
    double start = first.toNumber(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (before.toBoolean(globalObject)) {
        start -= before.toNumber(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    }
    start = std::isnan(start) ? start : std::max(start, 0.0);

    // `node.range[1] + (afterCount || 0)`
    JSValue end = lintGetIndex(globalObject, range, 1);
    RETURN_IF_EXCEPTION(scope, {});
    if (!end.isNumber() || after.toBoolean(globalObject)) [[unlikely]] {
        end = jsAdd(globalObject, end, after.toBoolean(globalObject) ? after : jsNumber(0));
        RETURN_IF_EXCEPTION(scope, {});
    }
    // `slice(start, undefined)` goes to the end, but a sum is never undefined.
    double endNumber = end.toNumber(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    // After the conversions, which can run anything.
    JSString* text = host->text();
    unsigned length = text->length();
    unsigned from = clampToText(start, length), to = clampToText(endNumber, length);
    return JSValue::encode(from < to ? jsSubstringOfResolved(vm, text, from, to - from) : jsEmptyString(vm));
}

} // namespace

// `getText(node, beforeCount, afterCount)`
JSC_DEFINE_HOST_FUNCTION(jsLintGetText, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    LintHost* host = LintHost::from(globalObject);
    JSValue before = callFrame->argument(1), after = callFrame->argument(2);
    auto isSmall = [](JSValue count) { return count.isUndefined() || count.isInt32(); };
    // Reading an own data property runs nothing, so the slow path can read it again.
    JSValue range = host->sourceCode.range.getOwnData(vm, host, callFrame->argument(0));
    if (int32_t first, second; range && isSmall(before) && isSmall(after) && getInt32Pair(range, first, second)) [[likely]] {
        JSString* text = host->text();
        int64_t length = text->length();
        int64_t from = std::min<int64_t>(std::max<int64_t>(int64_t(first) - (before.isInt32() ? before.asInt32() : 0), 0), length);
        int64_t to = int64_t(second) + (after.isInt32() ? after.asInt32() : 0);
        // `slice` counts a negative end from the end of the text.
        to = to < 0 ? std::max<int64_t>(length + to, 0) : std::min(to, length);
        return JSValue::encode(from < to ? jsSubstringOfResolved(vm, text, static_cast<unsigned>(from), static_cast<unsigned>(to - from)) : jsEmptyString(vm));
    }
    return getTextSlow(globalObject, callFrame, host);
}

JSC_DEFINE_HOST_FUNCTION(jsLintGetAllComments, (JSGlobalObject * globalObject, CallFrame*))
{
    return JSValue::encode(callHook(globalObject, LintHost::from(globalObject)->sourceCode.comments));
}

JSC_DEFINE_HOST_FUNCTION(jsLintGetInlineConfigNodes, (JSGlobalObject * globalObject, CallFrame*))
{
    return JSValue::encode(inlineConfigNodesOf(globalObject, LintHost::from(globalObject)));
}

// `getDisableDirectives()`
JSC_DEFINE_HOST_FUNCTION(jsLintGetDisableDirectives, (JSGlobalObject * globalObject, CallFrame*))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    LintHost* host = LintHost::from(globalObject);
    LintSourceCodeState& state = host->sourceCode;
    if (JSObject* result = state.disableDirectives.get())
        return JSValue::encode(result);
    JSArray* nodes = inlineConfigNodesOf(globalObject, host);
    RETURN_IF_EXCEPTION(scope, {});

    // In the order of `number_of` in src/lint/js_plugin/directives.rs.
    static constexpr std::array<ASCIILiteral, 5> types { ""_s, "enable"_s, "disable"_s, "disable-line"_s, "disable-next-line"_s };
    constexpr uint32_t disableLine = 3;
    JSString* text = host->text();
    unsigned length = text->length();
    auto slice = [&](uint32_t start, uint32_t end) {
        end = std::min(end, length);
        start = std::min(start, end);
        return jsSubstringOfResolved(vm, text, start, end - start);
    };
    MarkedArgumentBuffer problems, directives;
    // A getter of a comment can ask for the directives again, which doesn't change the list.
    for (unsigned i = 0; i < state.configComments.size(); ++i) {
        auto it = state.configComments[i];
        if (!it.label || it.label >= types.size())
            continue;
        JSValue node = nodes->getIndex(globalObject, i);
        RETURN_IF_EXCEPTION(scope, {});
        if (it.label == disableLine) {
            JSValue loc = lintLocOf(globalObject, host, node);
            RETURN_IF_EXCEPTION(scope, {});
            std::array<JSValue, 2> lines;
            for (unsigned end = 0; end < 2; ++end) {
                JSValue position = lintGet(globalObject, loc, end ? state.end : state.start);
                RETURN_IF_EXCEPTION(scope, {});
                lines[end] = lintGet(globalObject, position, state.line);
                RETURN_IF_EXCEPTION(scope, {});
            }
            bool isOneLine = JSValue::strictEqual(globalObject, lines[0], lines[1]);
            RETURN_IF_EXCEPTION(scope, {});
            if (!isOneLine) {
                JSObject* problem = constructEmptyObject(vm, state.problemStructure.get());
                problem->putDirectOffset(vm, 0, jsNull());
                problem->putDirectOffset(vm, 1, jsNontrivialString(vm, "eslint-disable-line comment should not span multiple lines."_s));
                problem->putDirectOffset(vm, 2, loc);
                problems.append(problem);
                continue;
            }
        }
        JSObject* directive = constructEmptyObject(vm, state.directiveStructure.get());
        directives.append(directive);
        directive->putDirectOffset(vm, 0, jsNontrivialString(vm, types[it.label]));
        directive->putDirectOffset(vm, 1, node);
        directive->putDirectOffset(vm, 2, slice(it.valueStart, it.valueEnd));
        directive->putDirectOffset(vm, 3, slice(it.justificationStart, it.justificationEnd));
    }
    if (problems.hasOverflowed() || directives.hasOverflowed()) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    JSObject* result = constructEmptyObject(vm, state.directivesStructure.get());
    JSArray* list = constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), problems);
    RETURN_IF_EXCEPTION(scope, {});
    result->putDirectOffset(vm, 0, list);
    list = constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), directives);
    RETURN_IF_EXCEPTION(scope, {});
    result->putDirectOffset(vm, 1, list);
    state.disableDirectives.set(vm, host, result);
    return JSValue::encode(result);
}

// `getComments(node)`, which ESLint had until version 9.
JSC_DEFINE_HOST_FUNCTION(jsLintGetComments, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    LintHost* host = LintHost::from(globalObject);
    LintSourceCodeState& state = host->sourceCode;
    JSValue node = callFrame->argument(0);
    JSObject* result = constructEmptyObject(vm, state.commentsStructure.get());
    auto finish = [&](JSValue leading, JSValue trailing) {
        result->putDirectOffset(vm, 0, leading);
        result->putDirectOffset(vm, 1, trailing);
        return JSValue::encode(result);
    };
    auto emptyArray = [&] { return constructEmptyArray(globalObject, nullptr); };
    JSValue type = state.type.get(globalObject, host, node);
    RETURN_IF_EXCEPTION(scope, {});
    // Whether `node[list]` is empty.
    auto hasNone = [&](const Identifier& list) {
        auto scope = DECLARE_THROW_SCOPE(vm);
        JSValue items = lintGet(globalObject, node, list);
        RETURN_IF_EXCEPTION(scope, false);
        double length = lengthOf(globalObject, items);
        RETURN_IF_EXCEPTION(scope, false);
        return length == 0;
    };
    bool isProgram = isText(globalObject, type, "Program"_s);
    RETURN_IF_EXCEPTION(scope, {});
    if (isProgram) {
        JSValue leading;
        bool isEmpty = hasNone(state.body);
        RETURN_IF_EXCEPTION(scope, {});
        if (isEmpty)
            leading = node.get(globalObject, state.commentsName);
        else
            leading = emptyArray();
        RETURN_IF_EXCEPTION(scope, {});
        JSValue trailing = emptyArray();
        RETURN_IF_EXCEPTION(scope, {});
        return finish(leading, trailing);
    }

    // What is in a node that is empty but for comments comes after it.
    const Identifier* list = nullptr;
    for (auto [name, items] : std::initializer_list<std::pair<ASCIILiteral, const Identifier*>> { { "BlockStatement"_s, &state.body }, { "ClassBody"_s, &state.body }, { "ObjectExpression"_s, &state.properties }, { "ArrayExpression"_s, &state.elements }, { "SwitchStatement"_s, &state.cases } }) {
        bool isIt = isText(globalObject, type, name);
        RETURN_IF_EXCEPTION(scope, {});
        if (isIt)
            list = items;
    }
    MarkedArgumentBuffer leading, trailing;
    if (list) {
        bool isEmpty = hasNone(*list);
        RETURN_IF_EXCEPTION(scope, {});
        if (isEmpty) {
            JSValue inside = callTokenMethod(globalObject, state.getCommentsInside, node);
            RETURN_IF_EXCEPTION(scope, {});
            double count = lengthOf(globalObject, inside);
            RETURN_IF_EXCEPTION(scope, {});
            for (unsigned i = 0; i < count; ++i) {
                JSValue comment = lintGetIndex(globalObject, inside, i);
                RETURN_IF_EXCEPTION(scope, {});
                trailing.append(comment);
            }
        }
    }

    JSValue parent = state.parent.get(globalObject, host, node);
    RETURN_IF_EXCEPTION(scope, {});
    bool isInner = parent.toBoolean(globalObject);
    if (isInner) {
        JSValue parentType = state.type.get(globalObject, host, parent);
        RETURN_IF_EXCEPTION(scope, {});
        isInner = !isText(globalObject, parentType, "Program"_s);
        RETURN_IF_EXCEPTION(scope, {});
    }
    // The comments next to the node, as far as they are in its parent.
    auto collect = [&](bool isBefore, MarkedArgumentBuffer& found) {
        auto scope = DECLARE_THROW_SCOPE(vm);
        auto& next = isBefore ? state.getTokenBefore : state.getTokenAfter;
        auto& edge = isBefore ? state.start : state.end;
        JSValue token = node;
        while (true) {
            token = callTokenMethod(globalObject, next, token, state.includeComments.get());
            RETURN_IF_EXCEPTION(scope, );
            if (!token.toBoolean(globalObject))
                return;
            JSValue tokenType = state.type.get(globalObject, host, token);
            RETURN_IF_EXCEPTION(scope, );
            bool isComment = isText(globalObject, tokenType, "Line"_s) || isText(globalObject, tokenType, "Block"_s) || isText(globalObject, tokenType, "Shebang"_s);
            RETURN_IF_EXCEPTION(scope, );
            if (!isComment)
                return;
            if (isInner) {
                JSValue ofToken = lintGet(globalObject, token, edge);
                RETURN_IF_EXCEPTION(scope, );
                JSValue ofParent = lintGet(globalObject, parent, edge);
                RETURN_IF_EXCEPTION(scope, );
                double inner = ofToken.toNumber(globalObject);
                RETURN_IF_EXCEPTION(scope, );
                double outer = ofParent.toNumber(globalObject);
                RETURN_IF_EXCEPTION(scope, );
                if (isBefore ? inner < outer : inner > outer)
                    return;
            }
            found.append(token);
            if (found.hasOverflowed()) [[unlikely]] {
                throwOutOfMemoryError(globalObject, scope);
                return;
            }
        }
    };
    collect(true, leading);
    RETURN_IF_EXCEPTION(scope, {});
    collect(false, trailing);
    RETURN_IF_EXCEPTION(scope, {});
    MarkedArgumentBuffer inOrder;
    for (unsigned i = leading.size(); i--;)
        inOrder.append(leading.at(i));
    JSArray* before = constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), inOrder);
    RETURN_IF_EXCEPTION(scope, {});
    JSArray* after = constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), trailing);
    RETURN_IF_EXCEPTION(scope, {});
    return finish(before, after);
}

// `getJSDocComment(node)`, which ESLint had until version 10.
JSC_DEFINE_HOST_FUNCTION(jsLintGetJSDocComment, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    LintHost* host = LintHost::from(globalObject);
    LintSourceCodeState& state = host->sourceCode;
    JSValue node = callFrame->argument(0);
    JSValue parent = state.parent.get(globalObject, host, node);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue typeValue = state.type.get(globalObject, host, node);
    RETURN_IF_EXCEPTION(scope, {});
    if (!typeValue.isString())
        return JSValue::encode(jsNull());
    String type = asString(typeValue)->value(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    // `String(node.type)`
    auto typeOf = [&](JSValue node) -> String {
        auto scope = DECLARE_THROW_SCOPE(vm);
        JSValue type = state.type.get(globalObject, host, node);
        RETURN_IF_EXCEPTION(scope, {});
        RELEASE_AND_RETURN(scope, type.toWTFString(globalObject));
    };
    // `node.loc[edge].line`
    auto lineOf = [&](JSValue node, const Identifier& edge) -> double {
        auto scope = DECLARE_THROW_SCOPE(vm);
        JSValue loc = lintLocOf(globalObject, host, node);
        RETURN_IF_EXCEPTION(scope, 0);
        JSValue position = lintGet(globalObject, loc, edge);
        RETURN_IF_EXCEPTION(scope, 0);
        JSValue line = lintGet(globalObject, position, state.line);
        RETURN_IF_EXCEPTION(scope, 0);
        RELEASE_AND_RETURN(scope, line.toNumber(globalObject));
    };
    // The block comment that starts with `*` right before `astNode`, or null.
    auto before = [&](JSValue astNode) -> EncodedJSValue {
        auto scope = DECLARE_THROW_SCOPE(vm);
        JSValue token = callTokenMethod(globalObject, state.getTokenBefore, astNode, state.includeComments.get());
        RETURN_IF_EXCEPTION(scope, {});
        if (!token.toBoolean(globalObject))
            return JSValue::encode(jsNull());
        double line = lineOf(astNode, state.start);
        RETURN_IF_EXCEPTION(scope, {});
        double tokenLine = lineOf(token, state.end);
        RETURN_IF_EXCEPTION(scope, {});
        if (!(line - tokenLine <= 1))
            return JSValue::encode(jsNull());
        JSValue tokenType = state.type.get(globalObject, host, token);
        RETURN_IF_EXCEPTION(scope, {});
        bool isBlock = isText(globalObject, tokenType, "Block"_s);
        RETURN_IF_EXCEPTION(scope, {});
        if (!isBlock)
            return JSValue::encode(jsNull());
        JSValue value = lintGet(globalObject, token, state.value);
        RETURN_IF_EXCEPTION(scope, {});
        String text = value.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        return JSValue::encode(text.startsWith('*') ? token : jsNull());
    };

    if (type == "ClassDeclaration"_s || type == "FunctionDeclaration"_s) {
        String parentType = typeOf(parent);
        RETURN_IF_EXCEPTION(scope, {});
        bool isExported = parentType == "ExportDefaultDeclaration"_s || parentType == "ExportNamedDeclaration"_s || parentType == "ExportAllDeclaration"_s || parentType == "ExportSpecifier"_s;
        RELEASE_AND_RETURN(scope, before(isExported ? parent : node));
    }
    if (type == "ClassExpression"_s) {
        JSValue outer = state.parent.get(globalObject, host, parent);
        RETURN_IF_EXCEPTION(scope, {});
        RELEASE_AND_RETURN(scope, before(outer));
    }
    if (type != "ArrowFunctionExpression"_s && type != "FunctionExpression"_s)
        return JSValue::encode(jsNull());
    String parentType = typeOf(parent);
    RETURN_IF_EXCEPTION(scope, {});
    if (parentType != "CallExpression"_s && parentType != "NewExpression"_s) {
        while (parent.toBoolean(globalObject)) {
            JSValue comments = callTokenMethod(globalObject, state.getCommentsBefore, parent);
            RETURN_IF_EXCEPTION(scope, {});
            double count = lengthOf(globalObject, comments);
            RETURN_IF_EXCEPTION(scope, {});
            // `!comments.length`
            if (count && !std::isnan(count))
                break;
            parentType = typeOf(parent);
            RETURN_IF_EXCEPTION(scope, {});
            if (parentType.contains("Function"_s) || parentType == "MethodDefinition"_s || parentType == "Property"_s)
                break;
            parent = state.parent.get(globalObject, host, parent);
            RETURN_IF_EXCEPTION(scope, {});
        }
        if (parent.toBoolean(globalObject)) {
            parentType = typeOf(parent);
            RETURN_IF_EXCEPTION(scope, {});
            if (parentType != "FunctionDeclaration"_s && parentType != "Program"_s)
                RELEASE_AND_RETURN(scope, before(parent));
        }
    }
    RELEASE_AND_RETURN(scope, before(node));
}

// `getNodeByRangeIndex(index)`
JSC_DEFINE_HOST_FUNCTION(jsLintGetNodeByRangeIndex, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    LintHost* host = LintHost::from(globalObject);
    LintSourceCodeState& state = host->sourceCode;
    callHook(globalObject, state.program);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue argument = callFrame->argument(0);
    // A BigInt can be compared with a number.
    if (argument.isBigInt())
        argument = JSBigInt::toNumber(argument);
    double index = argument.toNumber(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    // After the conversion, which can run anything.
    JSArray* nodes = state.nodes.get();
    if (!nodes)
        return JSValue::encode(jsNull());
    auto& last = lastDescendantsOf(state);
    size_t count = std::min<size_t>(state.starts.size(), nodes->length());
    JSValue result = jsNull();
    for (size_t id = 0; id < count;) {
        if (state.starts[id] <= index && index < state.ends[id])
            result = nodes->getIndexQuickly(static_cast<unsigned>(id++));
        else
            id = std::max<size_t>(last[id], id) + 1;
    }
    return JSValue::encode(result);
}

// `getLocFromIndex(index)`
JSC_DEFINE_HOST_FUNCTION(jsLintGetLocFromIndex, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    LintHost* host = LintHost::from(globalObject);
    JSValue argument = callFrame->argument(0);
    if (!argument.isNumber())
        return throwVMTypeError(globalObject, scope, "Expected `index` to be a number."_s);
    double index = argument.asNumber();
    unsigned length = host->text()->length();
    if (index < 0 || index > length)
        return throwVMRangeError(globalObject, scope, makeString("Index out of range (requested index "_s, String::number(index), ", but source text has length "_s, length, ")."_s));
    return JSValue::encode(host->createPosition(vm, index));
}

// `getIndexFromLoc(loc)`
JSC_DEFINE_HOST_FUNCTION(jsLintGetIndexFromLoc, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    LintHost* host = LintHost::from(globalObject);
    LintSourceCodeState& state = host->sourceCode;
    JSValue loc = callFrame->argument(0);
    JSValue lineValue, columnValue;
    if (host->isPosition(loc)) [[likely]] {
        lineValue = asObject(loc)->getDirect(0);
        columnValue = asObject(loc)->getDirect(1);
        if (!lineValue.isNumber())
            columnValue = {};
    } else if (loc.isObject() && !loc.isCallable()) {
        // `typeof loc === "object"`
        lineValue = loc.get(globalObject, state.line);
        RETURN_IF_EXCEPTION(scope, {});
        if (lineValue.isNumber()) {
            columnValue = loc.get(globalObject, state.column);
            RETURN_IF_EXCEPTION(scope, {});
        }
    }
    if (!columnValue || !columnValue.isNumber())
        return throwVMTypeError(globalObject, scope, "Expected `loc` to be an object with numeric `line` and `column` properties."_s);

    // After the getters, which can run anything.
    auto& starts = host->lineStarts();
    double line = lineValue.asNumber(), column = columnValue.asNumber();
    if (line <= 0)
        return throwVMRangeError(globalObject, scope, makeString("Line number out of range (line "_s, String::number(line), " requested). Line numbers should be 1-based."_s));
    if (line > starts.size())
        return throwVMRangeError(globalObject, scope, makeString("Line number out of range (line "_s, String::number(line), " requested, but only "_s, starts.size(), " lines present)."_s));
    if (column < 0)
        return throwVMRangeError(globalObject, scope, makeString("Invalid column number (column "_s, String::number(column), " requested)."_s));
    // `starts[1.5]` is undefined.
    if (line != std::trunc(line))
        return JSValue::encode(jsNaN());
    size_t number = static_cast<size_t>(line);
    bool isLast = number == starts.size();
    unsigned start = starts[number - 1];
    unsigned end = isLast ? host->text()->length() : starts[number];
    double index = start + column;
    if (isLast ? index > end : index >= end)
        return throwVMRangeError(globalObject, scope, makeString("Column number out of range (column "_s, String::number(column), " requested, but the length of line "_s, String::number(line), " is "_s, end - start, ")."_s));
    return JSValue::encode(jsNumber(index));
}

JSC_DEFINE_HOST_FUNCTION(jsLintGetLoc, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return JSValue::encode(lintLocOf(globalObject, LintHost::from(globalObject), callFrame->argument(0)));
}

JSC_DEFINE_HOST_FUNCTION(jsLintGetRange, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    LintHost* host = LintHost::from(globalObject);
    return JSValue::encode(host->sourceCode.range.get(globalObject, host, callFrame->argument(0)));
}

JSC_DEFINE_HOST_FUNCTION(jsLintGetParent, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    LintHost* host = LintHost::from(globalObject);
    return JSValue::encode(host->sourceCode.parent.get(globalObject, host, callFrame->argument(0)));
}

// `getAncestors(node)`
JSC_DEFINE_HOST_FUNCTION(jsLintGetAncestors, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    LintHost* host = LintHost::from(globalObject);
    LintSourceCodeState& state = host->sourceCode;
    JSValue node = callFrame->argument(0);
    if (!requireNode(globalObject, scope, node))
        return {};
    // Nearly always every `parent` is a plain property. Then nothing runs while they are counted, and they are the same when the
    // array is filled.
    unsigned depth = 0;
    bool isPlain = true;
    for (JSValue ancestor = node;;) {
        ancestor = state.parent.getOwnData(vm, host, ancestor);
        if (!ancestor) [[unlikely]] {
            isPlain = false;
            break;
        }
        if (!ancestor.isCell()) {
            isPlain = !ancestor.toBoolean(globalObject);
            break;
        }
        // A `parent` that leads back to the node.
        if (++depth == std::numeric_limits<int32_t>::max()) [[unlikely]] {
            throwOutOfMemoryError(globalObject, scope);
            return {};
        }
    }
    if (isPlain) [[likely]] {
        JSArray* result = JSArray::tryCreate(vm, globalObject->arrayStructureForIndexingTypeDuringAllocation(ArrayWithContiguous), depth);
        if (!result) [[unlikely]] {
            throwOutOfMemoryError(globalObject, scope);
            return {};
        }
        for (JSValue ancestor = node; depth--;) {
            ancestor = state.parent.getOwnData(vm, host, ancestor);
            result->setIndexQuickly(vm, depth, ancestor);
        }
        return JSValue::encode(result);
    }

    MarkedArgumentBuffer ancestors;
    while (true) {
        node = state.parent.get(globalObject, host, node);
        RETURN_IF_EXCEPTION(scope, {});
        if (!node.toBoolean(globalObject))
            break;
        ancestors.append(node);
        // A `parent` that leads back to the node.
        if (ancestors.hasOverflowed()) [[unlikely]] {
            throwOutOfMemoryError(globalObject, scope);
            return {};
        }
    }
    unsigned count = ancestors.size();
    JSArray* result;
    {
        ObjectInitializationScope initializationScope(vm);
        result = JSArray::tryCreateUninitializedRestricted(initializationScope, globalObject->arrayStructureForIndexingTypeDuringAllocation(ArrayWithContiguous), count);
        if (!result) [[unlikely]] {
            throwOutOfMemoryError(globalObject, scope);
            return {};
        }
        for (unsigned i = 0; i < count; ++i)
            result->initializeIndex(initializationScope, i, ancestors.at(count - 1 - i));
    }
    return JSValue::encode(result);
}

// ───────────── `loc` of nodes and tokens ─────────────

namespace {

// `Object.defineProperty(object, "loc", { value, writable: true, enumerable: true, configurable: true })`
void defineLoc(JSGlobalObject* globalObject, LintHost* host, JSValue target, JSValue value)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!target.isObject()) {
        throwTypeError(globalObject, scope, "Object.defineProperty requires an object as the first argument."_s);
        return;
    }
    JSObject* object = asObject(target);
    const Identifier& name = host->sourceCode.loc.name();
    Structure* structure = object->structure();
    // A node or a token that hasn't got one.
    if (object->type() == FinalObjectType && structure->isStructureExtensible() && structure->get(vm, name) == invalidOffset) [[likely]] {
        object->putDirect(vm, name, value);
        return;
    }
    scope.release();
    object->methodTable()->defineOwnProperty(object, globalObject, name, PropertyDescriptor(value, 0), true);
}

// What the getter of `loc` does. It's computed when it's asked for. From then on it's an own property, as a parser makes it.
JSValue computeLoc(JSGlobalObject* globalObject, LintHost* host, JSValue nodeOrToken)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue range = host->sourceCode.range.get(globalObject, host, nodeOrToken);
    RETURN_IF_EXCEPTION(scope, {});
    std::array<double, 2> indices;
    if (int32_t start, end; getInt32Pair(range, start, end)) [[likely]]
        indices = { static_cast<double>(start), static_cast<double>(end) };
    else {
        for (unsigned i = 0; i < 2; ++i) {
            JSValue index = lintGetIndex(globalObject, range, i);
            RETURN_IF_EXCEPTION(scope, {});
            indices[i] = index.toNumber(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
        }
    }
    JSObject* loc = host->createLoc(vm, indices[0], indices[1]);
    defineLoc(globalObject, host, nodeOrToken, loc);
    RETURN_IF_EXCEPTION(scope, {});
    return loc;
}

} // namespace

JSValue lintLocOf(JSGlobalObject* globalObject, LintHost* host, JSValue nodeOrToken)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    LintSourceCodeState& state = host->sourceCode;
    if (JSValue loc = state.loc.getOwnData(vm, host, nodeOrToken)) [[likely]]
        return loc;
    if (!nodeOrToken.isObject()) [[unlikely]]
        RELEASE_AND_RETURN(scope, nodeOrToken.get(globalObject, state.loc.name()));
    PropertySlot slot(nodeOrToken, PropertySlot::InternalMethodType::Get);
    bool exists = asObject(nodeOrToken)->getPropertySlot(globalObject, state.loc.name(), slot);
    RETURN_IF_EXCEPTION(scope, {});
    if (!exists)
        return jsUndefined();
    // No need to go through a call.
    if (slot.isAccessor() && slot.getterSetter()->getter() == state.locGetter.get()) [[likely]]
        RELEASE_AND_RETURN(scope, computeLoc(globalObject, host, nodeOrToken));
    RELEASE_AND_RETURN(scope, slot.getValue(globalObject, state.loc.name()));
}

JSC_DEFINE_HOST_FUNCTION(jsLintLocGetter, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return JSValue::encode(computeLoc(globalObject, LintHost::from(globalObject), callFrame->thisValue()));
}

JSC_DEFINE_HOST_FUNCTION(jsLintLocSetter, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    defineLoc(globalObject, LintHost::from(globalObject), callFrame->thisValue(), callFrame->argument(0));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

// ───────────── the class ─────────────

namespace {

JSC_DECLARE_HOST_FUNCTION(callSourceCode);
JSC_DECLARE_HOST_FUNCTION(constructSourceCode);

// `class SourceCode extends TokenStore`
class LintSourceCodeConstructor final : public InternalFunction {
public:
    using Base = InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    DECLARE_INFO;

    static LintSourceCodeConstructor* create(VM& vm, JSGlobalObject* globalObject, JSObject* tokenStore, JSObject* prototype)
    {
        Structure* structure = Structure::create(vm, globalObject, tokenStore, TypeInfo(InternalFunctionType, StructureFlags), info());
        auto* constructor = new (NotNull, allocateCell<LintSourceCodeConstructor>(vm)) LintSourceCodeConstructor(vm, structure);
        constructor->finishCreation(vm, 0, "SourceCode"_s, PropertyAdditionMode::WithoutStructureTransition);
        constructor->putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
        return constructor;
    }

private:
    LintSourceCodeConstructor(VM& vm, Structure* structure)
        : Base(vm, structure, callSourceCode, constructSourceCode)
    {
    }
};

const ClassInfo LintSourceCodeConstructor::s_info = { "Function"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(LintSourceCodeConstructor) };

JSC_DEFINE_HOST_FUNCTION(callSourceCode, (JSGlobalObject * globalObject, CallFrame*))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    return throwVMTypeError(globalObject, scope, "Cannot call a class constructor SourceCode without |new|"_s);
}

JSC_DEFINE_HOST_FUNCTION(constructSourceCode, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    LintHost* host = LintHost::from(globalObject);
    LintSourceCodeState& state = host->sourceCode;
    Structure* structure = state.instanceStructure.get();
    JSObject* newTarget = asObject(callFrame->newTarget());
    if (newTarget != state.constructor.get()) {
        structure = InternalFunction::createSubclassStructure(globalObject, newTarget, structure);
        RETURN_IF_EXCEPTION(scope, {});
    }
    return JSValue::encode(constructEmptyObject(vm, structure));
}

struct Member {
    ASCIILiteral name;
    // Of a method. A getter has none.
    int length;
    // Null: the program still has it.
    NativeFunction function;
};

constexpr int getter = -1;

const Member members[] = {
    { "text"_s, getter, jsLintSourceCodeText },
    { "hasBOM"_s, getter, jsLintSourceCodeHasBOM },
    { "ast"_s, getter, jsLintSourceCodeAst },
    { "lines"_s, getter, jsLintSourceCodeLines },
    { "lineStartIndices"_s, getter, jsLintSourceCodeLineStartIndices },
    { "tokensAndComments"_s, getter, jsLintSourceCodeTokensAndComments },
    { "visitorKeys"_s, getter, jsLintSourceCodeVisitorKeys },
    { "parserServices"_s, getter, jsLintSourceCodeParserServices },
    { "scopeManager"_s, getter, jsLintSourceCodeScopeManager },
    { "isESTree"_s, getter, jsLintSourceCodeIsESTree },
    { "getText"_s, 3, jsLintGetText },
    { "getLines"_s, 0, jsLintSourceCodeLines },
    { "getAllComments"_s, 0, jsLintGetAllComments },
    { "getInlineConfigNodes"_s, 0, jsLintGetInlineConfigNodes },
    { "getDisableDirectives"_s, 0, jsLintGetDisableDirectives },
    { "getNodeByRangeIndex"_s, 1, jsLintGetNodeByRangeIndex },
    { "getComments"_s, 1, jsLintGetComments },
    { "getJSDocComment"_s, 1, jsLintGetJSDocComment },
    { "getLocFromIndex"_s, 1, jsLintGetLocFromIndex },
    { "getIndexFromLoc"_s, 1, jsLintGetIndexFromLoc },
    { "getLoc"_s, 1, jsLintGetLoc },
    { "getRange"_s, 1, jsLintGetRange },
    { "getParent"_s, 1, jsLintGetParent },
    { "getAncestors"_s, 1, jsLintGetAncestors },
    { "getScope"_s, 1, nullptr },
    { "getDeclaredVariables"_s, 1, nullptr },
    { "isGlobalReference"_s, 1, nullptr },
    { "markVariableAsUsed"_s, 1, nullptr },
};

} // namespace

// `sourceCode(TokenStore, scripted, hooks)` returns the class. `scripted` is the prototype of the class that the program has, for
// the methods that aren't here yet. `hooks` is `[program, scopeManager, comments, tokensAndComments, parserOptions, visitorKeys]`.
JSC_DEFINE_HOST_FUNCTION(jsLintSourceCode, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    LintHost* host = LintHost::from(globalObject);
    LintSourceCodeState& state = host->sourceCode;
    JSObject* tokenStore = callFrame->argument(0).getObject();
    JSObject* scripted = callFrame->argument(1).getObject();
    JSArray* hooks = dynamicDowncast<JSArray>(callFrame->argument(2));
    if (!tokenStore || !scripted || !hooks)
        return throwVMTypeError(globalObject, scope, "Expected a class, a prototype and hooks"_s);
    unsigned at = 0;
    for (auto* hook : { &state.program, &state.scopeManager, &state.comments, &state.tokensAndComments, &state.parserOptions }) {
        JSValue function = hooks->getIndex(globalObject, at++);
        RETURN_IF_EXCEPTION(scope, {});
        if (!function.isCallable())
            return throwVMTypeError(globalObject, scope, "Expected a function"_s);
        hook->set(vm, host, asObject(function));
    }
    JSValue keys = hooks->getIndex(globalObject, at);
    RETURN_IF_EXCEPTION(scope, {});
    if (!isJSArray(keys))
        return throwVMTypeError(globalObject, scope, "Expected visitor keys"_s);
    state.visitorKeys.set(vm, host, asArray(keys));

    JSValue parent = tokenStore->get(globalObject, vm.propertyNames->prototype);
    RETURN_IF_EXCEPTION(scope, {});
    if (!parent.isObject())
        return throwVMTypeError(globalObject, scope, "Expected a class"_s);
    for (auto [name, method] : std::initializer_list<std::pair<ASCIILiteral, WriteBarrier<JSObject>*>> { { "getTokenBefore"_s, &state.getTokenBefore }, { "getTokenAfter"_s, &state.getTokenAfter }, { "getCommentsBefore"_s, &state.getCommentsBefore }, { "getCommentsInside"_s, &state.getCommentsInside } }) {
        JSValue function = parent.get(globalObject, Identifier::fromString(vm, name));
        RETURN_IF_EXCEPTION(scope, {});
        if (!function.isCallable())
            return throwVMTypeError(globalObject, scope, "Expected a method"_s);
        method->set(vm, host, asObject(function));
    }
    JSObject* prototype = constructEmptyObject(globalObject, asObject(parent));
    auto* constructor = LintSourceCodeConstructor::create(vm, globalObject, tokenStore, prototype);
    constructor->putDirect(vm, Identifier::fromString(vm, "splitLines"_s), JSFunction::create(vm, globalObject, 1, "splitLines"_s, jsLintSplitLines, ImplementationVisibility::Public), static_cast<unsigned>(PropertyAttribute::DontEnum));
    prototype->putDirect(vm, vm.propertyNames->constructor, constructor, static_cast<unsigned>(PropertyAttribute::DontEnum));
    for (auto& member : members) {
        Identifier name = Identifier::fromString(vm, member.name);
        if (!member.function) {
            JSValue method = scripted->get(globalObject, name);
            RETURN_IF_EXCEPTION(scope, {});
            prototype->putDirect(vm, name, method, static_cast<unsigned>(PropertyAttribute::DontEnum));
        } else if (member.length == getter) {
            JSFunction* function = JSFunction::create(vm, globalObject, 0, makeString("get "_s, member.name), member.function, ImplementationVisibility::Public);
            prototype->putDirectAccessor(globalObject, name, GetterSetter::create(vm, globalObject, function, nullptr), PropertyAttribute::Accessor | PropertyAttribute::DontEnum);
        } else
            prototype->putDirect(vm, name, JSFunction::create(vm, globalObject, member.length, member.name, member.function, ImplementationVisibility::Public), static_cast<unsigned>(PropertyAttribute::DontEnum));
    }
    state.constructor.set(vm, host, constructor);
    state.instanceStructure.set(vm, host, globalObject->structureCache().emptyObjectStructureForPrototype(globalObject, prototype, JSFinalObject::defaultInlineCapacity));
    return JSValue::encode(constructor);
}

void LintSourceCodeState::finishCreation(VM& vm, JSGlobalObject* globalObject, LintHost* host)
{
    auto set = [&](Identifier& name, ASCIILiteral text) { name = Identifier::fromString(vm, text); };
    range.initialize(vm, "range"_s);
    loc.initialize(vm, "loc"_s);
    parent.initialize(vm, "parent"_s);
    set(line, "line"_s);
    set(column, "column"_s);
    set(start, "start"_s);
    set(end, "end"_s);
    type.initialize(vm, "type"_s);
    set(value, "value"_s);
    set(body, "body"_s);
    set(properties, "properties"_s);
    set(elements, "elements"_s);
    set(cases, "cases"_s);
    set(commentsName, "comments"_s);
    set(emitDecoratorMetadata, "emitDecoratorMetadata"_s);
    set(experimentalDecorators, "experimentalDecorators"_s);
    set(isolatedDeclarations, "isolatedDeclarations"_s);
    JSObject* objectPrototype = globalObject->objectPrototype();
    problemStructure.set(vm, host, LintHost::createShape(vm, globalObject, objectPrototype, std::to_array<ASCIILiteral>({ "ruleId"_s, "message"_s, "loc"_s })));
    directiveStructure.set(vm, host, LintHost::createShape(vm, globalObject, objectPrototype, std::to_array<ASCIILiteral>({ "type"_s, "node"_s, "value"_s, "justification"_s })));
    directivesStructure.set(vm, host, LintHost::createShape(vm, globalObject, objectPrototype, std::to_array<ASCIILiteral>({ "problems"_s, "directives"_s })));
    commentsStructure.set(vm, host, LintHost::createShape(vm, globalObject, objectPrototype, std::to_array<ASCIILiteral>({ "leading"_s, "trailing"_s })));
    JSObject* options = constructEmptyObject(globalObject);
    options->putDirect(vm, Identifier::fromString(vm, "includeComments"_s), jsBoolean(true));
    includeComments.set(vm, host, options);
    servicesStructure.set(vm, host, LintHost::createShape(vm, globalObject, globalObject->objectPrototype(), std::to_array<ASCIILiteral>({ "emitDecoratorMetadata"_s, "experimentalDecorators"_s, "isolatedDeclarations"_s, "program"_s, "esTreeNodeToTSNodeMap"_s, "tsNodeToESTreeNodeMap"_s })));
}

void LintSourceCodeState::setTree(VM& vm, LintHost* host, JSArrayBuffer* buffer, JSArray* nodesOfFile, std::span<const uint32_t> startsOfNodes, std::span<const uint32_t> endsOfNodes, std::span<const uint32_t> parentsOfNodes)
{
    treeBuffer.set(vm, host, buffer);
    nodes.set(vm, host, nodesOfFile);
    starts = startsOfNodes;
    ends = endsOfNodes;
    parents = parentsOfNodes;
    lastDescendants.clear();
}

void LintSourceCodeState::endFile()
{
    lines.clear();
    lineStartIndices.clear();
    parserServices.clear();
    inlineConfigNodes.clear();
    disableDirectives.clear();
    configComments = {};
    treeBuffer.clear();
    nodes.clear();
    starts = {};
    ends = {};
    parents = {};
    lastDescendants.clear();
}

void addLintSourceCodeFunctions(JSGlobalObject* globalObject, JSObject* native)
{
    VM& vm = globalObject->vm();
    native->putDirect(vm, Identifier::fromString(vm, "sourceCode"_s), JSFunction::create(vm, globalObject, 3, "sourceCode"_s, jsLintSourceCode, ImplementationVisibility::Public));
    LintHost* host = LintHost::from(globalObject);
    host->sourceCode.locGetter.set(vm, host, JSFunction::create(vm, globalObject, 0, "get loc"_s, jsLintLocGetter, ImplementationVisibility::Public));
    native->putDirect(vm, Identifier::fromString(vm, "locGetter"_s), host->sourceCode.locGetter.get());
    native->putDirect(vm, Identifier::fromString(vm, "locSetter"_s), JSFunction::create(vm, globalObject, 1, "set loc"_s, jsLintLocSetter, ImplementationVisibility::Public));
}

} // namespace Bun
