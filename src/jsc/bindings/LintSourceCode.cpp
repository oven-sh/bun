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

// An own data property of a plain object without a lookup through the prototype chain, or `object[name]`.
JSValue getFast(JSGlobalObject* globalObject, JSValue target, const Identifier& name)
{
    if (target.isObject()) [[likely]] {
        JSObject* object = asObject(target);
        Structure* structure = object->structure();
        if (!structure->typeInfo().overridesGetOwnPropertySlot()) [[likely]] {
            unsigned attributes;
            PropertyOffset offset = structure->get(globalObject->vm(), name, attributes);
            if (offset != invalidOffset && !(attributes & (PropertyAttribute::Accessor | PropertyAttribute::CustomAccessorOrValue))) [[likely]]
                return object->getDirect(offset);
        }
    }
    return target.get(globalObject, name);
}

// `array[index]`
JSValue getIndexFast(JSGlobalObject* globalObject, JSValue target, unsigned index)
{
    if (target.isCell() && isJSArray(target.asCell())) [[likely]] {
        JSArray* array = asArray(target);
        if (array->canGetIndexQuickly(index)) [[likely]]
            return array->getIndexQuickly(index);
    }
    return target.get(globalObject, index);
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
        if (text.isUndefinedOrNull())
            throwException(globalObject, scope, createNotAnObjectError(globalObject, text));
        else
            throwTypeError(globalObject, scope, "text.split is not a function"_s);
        return {};
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

// `getText(node, beforeCount, afterCount)`
JSC_DEFINE_HOST_FUNCTION(jsLintGetText, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    LintHost* host = LintHost::from(globalObject);
    LintSourceCodeState& state = host->sourceCode;
    JSValue node = callFrame->argument(0);
    if (!node.toBoolean(globalObject))
        return JSValue::encode(host->text());
    JSValue range = getFast(globalObject, node, state.range);
    RETURN_IF_EXCEPTION(scope, {});

    // `Math.max(node.range[0] - (beforeCount || 0), 0)`
    JSValue first = getIndexFast(globalObject, range, 0);
    RETURN_IF_EXCEPTION(scope, {});
    double start = first.toNumber(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue before = callFrame->argument(1);
    if (before.toBoolean(globalObject)) {
        start -= before.toNumber(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    }
    start = std::isnan(start) ? start : std::max(start, 0.0);

    // `node.range[1] + (afterCount || 0)`
    JSValue end = getIndexFast(globalObject, range, 1);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue after = callFrame->argument(2);
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

JSC_DEFINE_HOST_FUNCTION(jsLintGetAllComments, (JSGlobalObject * globalObject, CallFrame*))
{
    return JSValue::encode(callHook(globalObject, LintHost::from(globalObject)->sourceCode.comments));
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
    // `typeof loc === "object"`
    if (loc.isObject() && !loc.isCallable()) {
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
    return JSValue::encode(callFrame->argument(0).get(globalObject, LintHost::from(globalObject)->sourceCode.loc));
}

JSC_DEFINE_HOST_FUNCTION(jsLintGetRange, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return JSValue::encode(getFast(globalObject, callFrame->argument(0), LintHost::from(globalObject)->sourceCode.range));
}

JSC_DEFINE_HOST_FUNCTION(jsLintGetParent, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return JSValue::encode(getFast(globalObject, callFrame->argument(0), LintHost::from(globalObject)->sourceCode.parent));
}

// `getAncestors(node)`
JSC_DEFINE_HOST_FUNCTION(jsLintGetAncestors, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    LintSourceCodeState& state = LintHost::from(globalObject)->sourceCode;
    JSValue node = callFrame->argument(0);
    if (!requireNode(globalObject, scope, node))
        return {};
    MarkedArgumentBuffer ancestors;
    while (true) {
        node = getFast(globalObject, node, state.parent);
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
void defineLoc(JSGlobalObject* globalObject, JSValue target, JSValue value)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    if (!target.isObject()) {
        throwTypeError(globalObject, scope, "Object.defineProperty requires an object as the first argument."_s);
        return;
    }
    JSObject* object = asObject(target);
    scope.release();
    object->methodTable()->defineOwnProperty(object, globalObject, LintHost::from(globalObject)->sourceCode.loc, PropertyDescriptor(value, 0), true);
}

} // namespace

// It's computed when it's asked for. From then on it's an own property, as a parser makes it.
JSC_DEFINE_HOST_FUNCTION(jsLintLocGetter, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    LintHost* host = LintHost::from(globalObject);
    JSValue thisValue = callFrame->thisValue();
    JSValue range = getFast(globalObject, thisValue, host->sourceCode.range);
    RETURN_IF_EXCEPTION(scope, {});
    std::array<double, 2> indices;
    for (unsigned i = 0; i < 2; ++i) {
        JSValue index = getIndexFast(globalObject, range, i);
        RETURN_IF_EXCEPTION(scope, {});
        indices[i] = index.toNumber(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    }
    JSObject* loc = host->createLoc(vm, indices[0], indices[1]);
    defineLoc(globalObject, thisValue, loc);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(loc);
}

JSC_DEFINE_HOST_FUNCTION(jsLintLocSetter, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    defineLoc(globalObject, callFrame->thisValue(), callFrame->argument(0));
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
    LintSourceCodeState& state = LintHost::from(globalObject)->sourceCode;
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
    { "getInlineConfigNodes"_s, 0, nullptr },
    { "getDisableDirectives"_s, 0, nullptr },
    { "getNodeByRangeIndex"_s, 1, jsLintGetNodeByRangeIndex },
    { "getComments"_s, 1, nullptr },
    { "getJSDocComment"_s, 1, nullptr },
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
    set(range, "range"_s);
    set(loc, "loc"_s);
    set(parent, "parent"_s);
    set(line, "line"_s);
    set(column, "column"_s);
    set(emitDecoratorMetadata, "emitDecoratorMetadata"_s);
    set(experimentalDecorators, "experimentalDecorators"_s);
    set(isolatedDeclarations, "isolatedDeclarations"_s);
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
    native->putDirect(vm, Identifier::fromString(vm, "locGetter"_s), JSFunction::create(vm, globalObject, 0, "get loc"_s, jsLintLocGetter, ImplementationVisibility::Public));
    native->putDirect(vm, Identifier::fromString(vm, "locSetter"_s), JSFunction::create(vm, globalObject, 1, "set loc"_s, jsLintLocSetter, ImplementationVisibility::Public));
}

} // namespace Bun
