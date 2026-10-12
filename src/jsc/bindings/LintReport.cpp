// `context.report()` and the `fixer` of JavaScript lint plugins.
//
// Ported from ESLint's lib/linter/file-report.js, rule-fixer.js and interpolate.js (MIT License, see LICENSE.md).
//
// A rule can pass anything. Every property is read once, where ESLint reads it first, so getters and Proxies see the same
// order of reads and exceptions come in the same order.

#include "LintReport.h"

#include "LintHost.h"
#include <JavaScriptCore/ArrayConstructor.h>
#include <JavaScriptCore/IteratorOperations.h>
#include <JavaScriptCore/JSBoundFunction.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSONObject.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/ObjectInitializationScope.h>
#include <JavaScriptCore/ParseInt.h>
#include <JavaScriptCore/PropertyNameArray.h>
#include <JavaScriptCore/StableSort.h>
#include <JavaScriptCore/StringObject.h>
#include <wtf/text/MakeString.h>
#include <wtf/text/StringBuilder.h>

namespace Bun {
using namespace JSC;

namespace {

void throwError(JSGlobalObject* globalObject, ThrowScope& scope, const String& message)
{
    throwException(globalObject, scope, createError(globalObject, message));
}

// `${JSON.stringify(value, null, 2)}`
String stringify(JSGlobalObject* globalObject, JSValue value)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    String json = JSONStringify(globalObject, value, 2);
    RETURN_IF_EXCEPTION(scope, {});
    return json.isNull() ? String("undefined"_s) : json;
}

// `String(value)`
JSString* toStringOrDescription(JSGlobalObject* globalObject, JSValue value)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!value.isSymbol())
        RELEASE_AND_RETURN(scope, value.toString(globalObject));
    auto description = asSymbol(value)->tryGetDescriptiveString();
    if (!description) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return nullptr;
    }
    return jsString(vm, *description);
}

JSArray* createArray(JSGlobalObject* globalObject, std::initializer_list<JSValue> values)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    MarkedArgumentBuffer items;
    for (JSValue value : values)
        items.append(value);
    RELEASE_AND_RETURN(scope, constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), items));
}

// `text.slice(from, to)`
StringView slice(StringView text, double from, double to)
{
    double length = text.length();
    auto clamp = [&](double index) {
        if (std::isnan(index))
            return 0.0;
        index = std::trunc(index);
        return index < 0 ? std::max(length + index, 0.0) : std::min(index, length);
    };
    double start = clamp(from), end = clamp(to);
    return start < end ? text.substring(static_cast<unsigned>(start), static_cast<unsigned>(end - start)) : StringView();
}

// `Math.max(0, a, b)`
double maxWithZero(double a, double b)
{
    return std::isnan(a) || std::isnan(b) ? PNaN : std::max({ 0.0, a, b });
}

// ESLint's `interpolate`. `message` is truthy.
JSValue interpolate(JSGlobalObject* globalObject, const LintReportState& names, JSValue message, JSValue data)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!data.toBoolean(globalObject))
        return message;

    JSString* string = nullptr;
    if (message.isString())
        string = asString(message);
    else if (auto* object = dynamicDowncast<StringObject>(message))
        string = object->internalValue();
    if (!string) [[unlikely]] {
        // `message.includes("{{")`
        JSValue includes = message.get(globalObject, names.includes);
        RETURN_IF_EXCEPTION(scope, {});
        auto callData = getCallData(includes);
        if (callData.type == CallData::Type::None) {
            throwException(globalObject, scope, createNotAFunctionError(globalObject, includes));
            return {};
        }
        MarkedArgumentBuffer arguments;
        arguments.append(jsNontrivialString(vm, "{{"_s));
        JSValue has = call(globalObject, includes, callData, message, arguments);
        RETURN_IF_EXCEPTION(scope, {});
        if (!has.toBoolean(globalObject))
            return message;
        // Only a string has `replace` too.
        throwTypeError(globalObject, scope, "message.replace is not a function"_s);
        return {};
    }

    // Keeps the characters alive while getters and `toString` run.
    String text = string->value(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    size_t open = text.find("{{"_s);
    if (open == notFound)
        return message;

    // `/\{\{([^{}]+)\}\}/gu`
    StringView view = text;
    unsigned length = view.length();
    StringBuilder result;
    unsigned copied = 0;
    while (open != notFound) {
        unsigned close = open + 2;
        while (close < length && view[close] != '{' && view[close] != '}')
            ++close;
        if (close == open + 2 || close + 1 >= length || view[close] != '}' || view[close + 1] != '}') {
            open = view.find("{{"_s, open + 1);
            continue;
        }
        StringView term = view.substring(open + 2, close - open - 2).trim(isStrWhiteSpace<char16_t>);
        if (!data.isObject()) {
            throwException(globalObject, scope, createInvalidInParameterError(globalObject, data));
            return {};
        }
        Identifier key = Identifier::fromString(vm, term.toString());
        bool has = asObject(data)->hasProperty(globalObject, key);
        RETURN_IF_EXCEPTION(scope, {});
        if (has) {
            JSValue value = asObject(data)->get(globalObject, key);
            RETURN_IF_EXCEPTION(scope, {});
            String replacement = value.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            result.append(view.substring(copied, open - copied), replacement);
            copied = close + 2;
        }
        open = view.find("{{"_s, close + 2);
    }
    if (!copied)
        return string;
    result.append(view.substring(copied));
    if (result.hasOverflowed()) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    return jsString(vm, result.toString());
}

// A fix that has passed ESLint's `assertValidFix`.
struct Edit {
    double start;
    double end;
    // Among the fixes of the report.
    unsigned index;
};

// ESLint's `assertValidFix`. `fix` is truthy.
Edit readEdit(JSGlobalObject* globalObject, const LintReportState& names, JSValue fix, unsigned index)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    JSValue range = fix.get(globalObject, names.range);
    RETURN_IF_EXCEPTION(scope, {});
    if (range.toBoolean(globalObject)) {
        JSValue start = range.get(globalObject, 0u);
        RETURN_IF_EXCEPTION(scope, {});
        if (start.isNumber()) {
            JSValue end = range.get(globalObject, 1u);
            RETURN_IF_EXCEPTION(scope, {});
            if (end.isNumber())
                return { start.asNumber(), end.asNumber(), index };
        }
    }
    String json = stringify(globalObject, fix);
    RETURN_IF_EXCEPTION(scope, {});
    throwError(globalObject, scope, makeString("Fix has invalid range: "_s, json));
    return {};
}

// `[start, end, text]` for one fix.
JSValue cloneFix(JSGlobalObject* globalObject, const LintReportState& names, JSValue fix, const Edit& edit)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    JSValue text = fix.get(globalObject, names.text);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, createArray(globalObject, { jsNumber(edit.start), jsNumber(edit.end), text }));
}

// `Array.from(iterable)`
void collect(JSGlobalObject* globalObject, JSObject* iterable, MarkedArgumentBuffer& items)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue method = iterable->get(globalObject, vm.propertyNames->iteratorSymbol);
    RETURN_IF_EXCEPTION(scope, );
    if (!method.isUndefinedOrNull()) {
        scope.release();
        forEachInIterable(*globalObject, iterable, method, [&](VM&, JSGlobalObject&, JSValue item) { items.append(item); });
        return;
    }
    JSValue lengthValue = iterable->get(globalObject, vm.propertyNames->length);
    RETURN_IF_EXCEPTION(scope, );
    uint64_t length = lengthValue.toLength(globalObject);
    RETURN_IF_EXCEPTION(scope, );
    if (length > std::numeric_limits<uint32_t>::max()) {
        throwRangeError(globalObject, scope, "Array size is not a small enough positive integer."_s);
        return;
    }
    for (uint32_t i = 0; i < length; ++i) {
        JSValue item = iterable->get(globalObject, i);
        RETURN_IF_EXCEPTION(scope, );
        items.append(item);
    }
}

// ESLint's `mergeFixes`: `[start, end, text]`, or null.
JSValue mergeFixes(JSGlobalObject* globalObject, LintHost* host, JSObject* iterable)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    const LintReportState& names = host->report;

    MarkedArgumentBuffer fixes;
    collect(globalObject, iterable, fixes);
    RETURN_IF_EXCEPTION(scope, {});
    if (fixes.hasOverflowed()) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }

    unsigned count = fixes.size();
    Vector<Edit, 8> edits;
    edits.reserveInitialCapacity(count);
    JSValue notAFix;
    for (unsigned i = 0; i < count; ++i) {
        JSValue fix = fixes.at(i);
        if (!fix.toBoolean(globalObject)) {
            if (!notAFix)
                notAFix = fix;
            continue;
        }
        edits.append(readEdit(globalObject, names, fix, i));
        RETURN_IF_EXCEPTION(scope, {});
    }
    if (!count)
        return jsNull();
    if (count == 1) {
        if (notAFix)
            return jsNull();
        RELEASE_AND_RETURN(scope, cloneFix(globalObject, names, fixes.at(0), edits[0]));
    }
    // ESLint reads the `range` of each.
    if (notAFix) {
        throwException(globalObject, scope, createNotAnObjectError(globalObject, notAFix.isNull() ? notAFix : jsUndefined()));
        return {};
    }

    // `fixes.sort((a, b) => a.range[0] - b.range[0] || a.range[1] - b.range[1])`, with the sort that JavaScript has.
    Vector<Edit, 8> workingSet(count);
    std::span<Edit> sorted = arrayStableSort<MergeStrategy::Galloping>(vm, edits.mutableSpan(), workingSet.mutableSpan(), [](const Edit& left, const Edit& right) {
        double byStart = left.start - right.start;
        return (byStart && !std::isnan(byStart) ? byStart : left.end - right.end) < 0;
    });
    RETURN_IF_EXCEPTION(scope, {});

    String original = host->textString();
    double start = sorted.front().start, end = sorted.back().end;
    double last = minSafeInteger();
    StringBuilder merged;
    for (const Edit& edit : sorted) {
        if (!(edit.start >= last)) {
            throwError(globalObject, scope, "Fix objects must not be overlapped in a report."_s);
            return {};
        }
        if (edit.start >= 0)
            merged.append(slice(original, maxWithZero(start, last), edit.start));
        JSValue text = fixes.at(edit.index).get(globalObject, names.text);
        RETURN_IF_EXCEPTION(scope, {});
        // `merged += text`
        if (!text.isString()) {
            text = text.toPrimitive(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
        }
        String added = text.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        merged.append(added);
        last = edit.end;
    }
    merged.append(slice(original, maxWithZero(start, last), end));
    if (merged.hasOverflowed()) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    RELEASE_AND_RETURN(scope, createArray(globalObject, { jsNumber(start), jsNumber(end), jsString(vm, merged.toString()) }));
}

JSObject* createFixer(JSGlobalObject*, LintReportState&, LintHost*);

// ESLint's `normalizeFixes`: `[start, end, text]`, or null. `function` is the `fix` of `owner`.
JSValue normalizeFixes(JSGlobalObject* globalObject, LintHost* host, JSValue owner, JSValue function)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    LintReportState& state = host->report;
    auto callData = getCallData(function);
    if (callData.type == CallData::Type::None)
        return jsNull();
    JSObject* fixer = state.fixer.get();
    if (!fixer)
        fixer = createFixer(globalObject, state, host);
    MarkedArgumentBuffer arguments;
    arguments.append(fixer);
    JSValue fix = call(globalObject, function, callData, owner, arguments);
    RETURN_IF_EXCEPTION(scope, {});
    if (!fix.toBoolean(globalObject))
        return jsNull();
    // `Symbol.iterator in fix`
    if (!fix.isObject()) {
        throwException(globalObject, scope, createInvalidInParameterError(globalObject, fix));
        return {};
    }
    bool isIterable = asObject(fix)->hasProperty(globalObject, vm.propertyNames->iteratorSymbol);
    RETURN_IF_EXCEPTION(scope, {});
    if (isIterable)
        RELEASE_AND_RETURN(scope, mergeFixes(globalObject, host, asObject(fix)));
    Edit edit = readEdit(globalObject, state, fix, 0);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, cloneFix(globalObject, state, fix, edit));
}

// ESLint's `computeMessageFromDescriptor`. Sets `messageId`.
JSValue messageOf(JSGlobalObject* globalObject, const LintReportState& names, JSValue descriptor, JSValue messages, JSValue& messageId)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    messageId = descriptor.get(globalObject, names.messageId);
    RETURN_IF_EXCEPTION(scope, {});
    bool hasId = messageId.toBoolean(globalObject);
    if (hasId && !messages.toBoolean(globalObject)) {
        throwTypeError(globalObject, scope, "context.report() called with a messageId, but no messages were present in the rule metadata."_s);
        return {};
    }
    JSValue message = descriptor.get(globalObject, vm.propertyNames->message);
    RETURN_IF_EXCEPTION(scope, {});
    bool hasMessage = message.toBoolean(globalObject);
    if (!hasId) {
        if (hasMessage)
            return message;
        throwTypeError(globalObject, scope, "Missing `message` property in report() call; add a message that describes the linting problem."_s);
        return {};
    }
    if (hasMessage) {
        throwTypeError(globalObject, scope, "context.report() called with a message and a messageId. Please only pass one."_s);
        return {};
    }
    // `Object.hasOwn(messages, id)`
    JSObject* object = messages.toObject(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    Identifier key = messageId.toPropertyKey(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    bool isKnown = object->hasOwnProperty(globalObject, key);
    RETURN_IF_EXCEPTION(scope, {});
    if (isKnown)
        RELEASE_AND_RETURN(scope, messages.get(globalObject, key));
    String id = messageId.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    String json = stringify(globalObject, messages);
    RETURN_IF_EXCEPTION(scope, {});
    throwTypeError(globalObject, scope, makeString("context.report() called with a messageId of '"_s, id, "' which is not present in the 'messages' config: "_s, json));
    return {};
}

// What is kept of each suggestion: the object, its `messageId`, its `desc` or the message with that id, and its `fix`.
constexpr unsigned suggestionObject = 0, suggestionMessageId = 1, suggestionText = 2, suggestionFix = 3, suggestionFields = 4;

// The part of ESLint's `validateSuggestions` that's about one suggestion.
void validateSuggestion(JSGlobalObject* globalObject, const LintReportState& names, JSValue suggestion, JSValue messages, MarkedArgumentBuffer& kept)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    JSValue messageId = suggestion.get(globalObject, names.messageId);
    RETURN_IF_EXCEPTION(scope, );
    JSValue text;
    if (messageId.toBoolean(globalObject)) {
        bool hasMessages = messages.toBoolean(globalObject);
        if (hasMessages) {
            Identifier key = messageId.toPropertyKey(globalObject);
            RETURN_IF_EXCEPTION(scope, );
            text = messages.get(globalObject, key);
            RETURN_IF_EXCEPTION(scope, );
        }
        if (!hasMessages || !text.toBoolean(globalObject)) {
            String id = messageId.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, );
            if (!hasMessages) {
                throwTypeError(globalObject, scope, makeString("context.report() called with a suggest option with a messageId '"_s, id, "', but no messages were present in the rule metadata."_s));
                return;
            }
            String json = stringify(globalObject, messages);
            RETURN_IF_EXCEPTION(scope, );
            throwTypeError(globalObject, scope, makeString("context.report() called with a suggest option with a messageId '"_s, id, "' which is not present in the 'messages' config: "_s, json));
            return;
        }
        JSValue desc = suggestion.get(globalObject, names.desc);
        RETURN_IF_EXCEPTION(scope, );
        if (desc.toBoolean(globalObject)) {
            throwTypeError(globalObject, scope, "context.report() called with a suggest option that defines both a 'messageId' and an 'desc'. Please only pass one."_s);
            return;
        }
    } else {
        text = suggestion.get(globalObject, names.desc);
        RETURN_IF_EXCEPTION(scope, );
        if (!text.toBoolean(globalObject)) {
            throwTypeError(globalObject, scope, "context.report() called with a suggest option that doesn't have either a `desc` or `messageId`"_s);
            return;
        }
    }
    JSValue fix = suggestion.get(globalObject, names.fix);
    RETURN_IF_EXCEPTION(scope, );
    if (!fix.isCallable()) {
        String json = stringify(globalObject, suggestion);
        RETURN_IF_EXCEPTION(scope, );
        throwTypeError(globalObject, scope, makeString("context.report() called with a suggest option without a fix function. See: "_s, json));
        return;
    }
    kept.append(suggestion);
    kept.append(messageId);
    kept.append(text);
    kept.append(fix);
}

// `Object.fromEntries(Object.entries(data).map(([key, value]) => [key, String(value)]))`, or null.
JSValue stringsOf(JSGlobalObject* globalObject, JSValue data)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!data.toBoolean(globalObject))
        return jsNull();
    JSObject* object = data.toObject(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    PropertyNameArrayBuilder keys(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
    object->methodTable()->getOwnPropertyNames(object, globalObject, keys, DontEnumPropertiesMode::Include);
    RETURN_IF_EXCEPTION(scope, {});
    Vector<Identifier, 8> names;
    MarkedArgumentBuffer values;
    for (auto& key : keys) {
        PropertyDescriptor descriptor;
        bool exists = object->getOwnPropertyDescriptor(globalObject, key, descriptor);
        RETURN_IF_EXCEPTION(scope, {});
        if (!exists || !descriptor.enumerable())
            continue;
        JSValue value = object->get(globalObject, key);
        RETURN_IF_EXCEPTION(scope, {});
        names.append(key);
        values.append(value);
    }
    if (values.hasOverflowed()) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    JSObject* strings = constructEmptyObject(globalObject);
    for (unsigned i = 0; i < names.size(); ++i) {
        JSString* string = toStringOrDescription(globalObject, values.at(i));
        RETURN_IF_EXCEPTION(scope, {});
        strings->putDirectMayBeIndex(globalObject, names[i], string);
        RETURN_IF_EXCEPTION(scope, {});
    }
    return strings;
}

// `{ line, column }` of `index`, which nobody has checked: `range[0]` or `range[1]` of a node without a `loc`.
void locate(JSGlobalObject* globalObject, LintHost* host, JSValue index, JSValue& line, JSValue& column)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    double number = index.toNumber(globalObject);
    RETURN_IF_EXCEPTION(scope, );
    auto position = host->positionOf(number);
    line = jsNumber(position.line);
    column = jsNumber(position.column);
}

} // namespace

// The function behind `context.report`. It's bound to `{ position, meta, report }`, which `reporter` makes.
JSC_DEFINE_HOST_FUNCTION(jsLintReport, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    LintHost* host = LintHost::from(globalObject);
    LintReportState& state = host->report;
    auto* rule = dynamicDowncast<JSFinalObject>(callFrame->thisValue());
    if (!rule || rule->structure() != state.ruleStructure.get())
        return throwVMTypeError(globalObject, scope, "Expected a rule"_s);
    JSValue position = rule->getDirect(0);
    JSValue meta = rule->getDirect(1);
    auto ofMeta = [&](const Identifier& name) { return meta.isUndefinedOrNull() ? jsUndefined() : meta.get(globalObject, name); };

    // ESLint's `normalizeMultiArgReportCall`
    JSValue descriptor = callFrame->argument(0);
    if (callFrame->argumentCount() > 1) {
        unsigned at = 0;
        JSObject* made = constructEmptyObject(globalObject);
        made->putDirect(vm, state.node, callFrame->argument(at++));
        if (!callFrame->argument(1).isString())
            made->putDirect(vm, state.loc, callFrame->argument(at++));
        made->putDirect(vm, vm.propertyNames->message, callFrame->argument(at++));
        made->putDirect(vm, state.data, callFrame->argument(at++));
        made->putDirect(vm, state.fix, callFrame->argument(at++));
        descriptor = made;
    }
    JSValue messages = ofMeta(state.messages);
    RETURN_IF_EXCEPTION(scope, {});

    // ESLint's `assertValidNodeInfo`
    JSValue node = descriptor.get(globalObject, state.node);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue loc;
    if (node.toBoolean(globalObject)) {
        if (!jsTypeofIsObject(globalObject, node)) {
            throwError(globalObject, scope, "Node must be an object"_s);
            return {};
        }
    } else {
        loc = descriptor.get(globalObject, state.loc);
        RETURN_IF_EXCEPTION(scope, {});
        if (!loc.toBoolean(globalObject)) {
            throwError(globalObject, scope, "Node must be provided when reporting error if location is not provided"_s);
            return {};
        }
    }

    JSValue messageId;
    JSValue message = messageOf(globalObject, state, descriptor, messages, messageId);
    RETURN_IF_EXCEPTION(scope, {});

    // ESLint's `validateSuggestions`
    JSValue suggest = descriptor.get(globalObject, state.suggest);
    RETURN_IF_EXCEPTION(scope, {});
    MarkedArgumentBuffer suggested;
    bool hasSuggestions = false;
    if (suggest.toBoolean(globalObject)) {
        hasSuggestions = isArray(globalObject, suggest);
        RETURN_IF_EXCEPTION(scope, {});
    }
    if (hasSuggestions) {
        forEachInIterable(globalObject, suggest, [&](VM&, JSGlobalObject*, JSValue suggestion) {
            validateSuggestion(globalObject, state, suggestion, messages, suggested);
        });
        RETURN_IF_EXCEPTION(scope, {});
        if (suggested.hasOverflowed()) [[unlikely]] {
            throwOutOfMemoryError(globalObject, scope);
            return {};
        }
    }

    // Where it is. `start` and `end` are read when the report is made. A copy of a node, `{ ...node }`, has no `loc`,
    // because a node computes it when it's asked for.
    if (!loc) {
        loc = descriptor.get(globalObject, state.loc);
        RETURN_IF_EXCEPTION(scope, {});
    }
    if (loc.isUndefinedOrNull()) {
        loc = node.get(globalObject, state.loc);
        RETURN_IF_EXCEPTION(scope, {});
    }
    JSValue start, end, line, column, endLine = jsNull(), endColumn = jsNull();
    if (loc.isUndefinedOrNull()) {
        JSValue range = node.get(globalObject, state.range);
        RETURN_IF_EXCEPTION(scope, {});
        JSValue index = range.get(globalObject, 0u);
        RETURN_IF_EXCEPTION(scope, {});
        locate(globalObject, host, index, line, column);
        RETURN_IF_EXCEPTION(scope, {});
        index = range.get(globalObject, 1u);
        RETURN_IF_EXCEPTION(scope, {});
        locate(globalObject, host, index, endLine, endColumn);
        RETURN_IF_EXCEPTION(scope, {});
    } else {
        start = loc.get(globalObject, state.start);
        RETURN_IF_EXCEPTION(scope, {});
        if (start.toBoolean(globalObject)) {
            end = loc.get(globalObject, state.end);
            RETURN_IF_EXCEPTION(scope, {});
        }
        if (start.isUndefinedOrNull())
            start = loc;
    }

    JSValue fix = jsNull();
    JSValue suggestions = jsNull();
    if (host->wantsFixes()) {
        JSValue function = descriptor.get(globalObject, state.fix);
        RETURN_IF_EXCEPTION(scope, {});
        fix = normalizeFixes(globalObject, host, descriptor, function);
        RETURN_IF_EXCEPTION(scope, {});

        // ESLint's `mapSuggestions`
        MarkedArgumentBuffer mapped;
        for (unsigned i = 0; i < suggested.size(); i += suggestionFields) {
            JSValue suggestion = suggested.at(i + suggestionObject);
            JSValue data = suggestion.get(globalObject, state.data);
            RETURN_IF_EXCEPTION(scope, {});
            JSValue desc = interpolate(globalObject, state, suggested.at(i + suggestionText), data);
            RETURN_IF_EXCEPTION(scope, {});
            JSValue suggestedFix = normalizeFixes(globalObject, host, suggestion, suggested.at(i + suggestionFix));
            RETURN_IF_EXCEPTION(scope, {});
            if (suggestedFix.isNull())
                continue;
            JSValue strings = stringsOf(globalObject, data);
            RETURN_IF_EXCEPTION(scope, {});
            JSValue id = suggested.at(i + suggestionMessageId);
            JSArray* entry = createArray(globalObject, { id.isUndefinedOrNull() ? jsNull() : id, desc, strings, suggestedFix });
            RETURN_IF_EXCEPTION(scope, {});
            mapped.append(entry);
        }
        if (!mapped.isEmpty()) {
            suggestions = constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), mapped);
            RETURN_IF_EXCEPTION(scope, {});
        }
    }

    JSValue data = descriptor.get(globalObject, state.data);
    RETURN_IF_EXCEPTION(scope, {});
    message = interpolate(globalObject, state, message, data);
    RETURN_IF_EXCEPTION(scope, {});
    message = toStringOrDescription(globalObject, message);
    RETURN_IF_EXCEPTION(scope, {});
    if (start) {
        line = start.get(globalObject, state.line);
        RETURN_IF_EXCEPTION(scope, {});
        column = start.get(globalObject, state.column);
        RETURN_IF_EXCEPTION(scope, {});
        column = jsAdd(globalObject, column, jsNumber(1));
        RETURN_IF_EXCEPTION(scope, {});
        if (end && end.toBoolean(globalObject)) {
            endLine = end.get(globalObject, state.line);
            RETURN_IF_EXCEPTION(scope, {});
            endColumn = end.get(globalObject, state.column);
            RETURN_IF_EXCEPTION(scope, {});
            endColumn = jsAdd(globalObject, endColumn, jsNumber(1));
            RETURN_IF_EXCEPTION(scope, {});
        }
    } else {
        column = jsNumber(column.asNumber() + 1);
        endColumn = jsNumber(endColumn.asNumber() + 1);
    }

    JSArray* report = createArray(globalObject, { position, message, messageId.isUndefinedOrNull() ? jsNull() : messageId, line, column, endLine, endColumn, fix, suggestions });
    RETURN_IF_EXCEPTION(scope, {});
    JSArray* reports = state.reports.get();
    if (!reports) {
        reports = constructEmptyArray(globalObject, nullptr);
        RETURN_IF_EXCEPTION(scope, {});
        state.reports.set(vm, host, reports);
    }
    reports->push(globalObject, report);
    RETURN_IF_EXCEPTION(scope, {});

    if (!fix.isNull()) {
        JSValue fixable = ofMeta(state.fixable);
        RETURN_IF_EXCEPTION(scope, {});
        if (!fixable.toBoolean(globalObject)) {
            throwError(globalObject, scope, "Fixable rules must set the `meta.fixable` property to \"code\" or \"whitespace\"."_s);
            return {};
        }
    }
    if (!suggestions.isNull()) {
        JSValue allowed = ofMeta(state.hasSuggestions);
        RETURN_IF_EXCEPTION(scope, {});
        if (!allowed.isTrue()) {
            JSValue docs = ofMeta(state.docs);
            RETURN_IF_EXCEPTION(scope, {});
            if (docs.toBoolean(globalObject)) {
                JSValue old = docs.get(globalObject, state.suggestion);
                RETURN_IF_EXCEPTION(scope, {});
                if (!old.isUndefined()) {
                    throwError(globalObject, scope, "Rules with suggestions must set the `meta.hasSuggestions` property to `true`. `meta.docs.suggestion` is ignored by ESLint."_s);
                    return {};
                }
            }
            throwError(globalObject, scope, "Rules with suggestions must set the `meta.hasSuggestions` property to `true`."_s);
            return {};
        }
    }
    return JSValue::encode(jsUndefined());
}

// ───────────── ESLint's `RuleFixer` ─────────────

namespace {

enum class FixKind : uint8_t {
    InsertAfter,
    InsertBefore,
    Replace,
    Remove,
};

JSArray* createPair(JSGlobalObject* globalObject, JSValue value)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    Structure* structure = globalObject->arrayStructureForIndexingTypeDuringAllocation(value.isInt32() ? ArrayWithInt32 : ArrayWithContiguous);
    ObjectInitializationScope initializationScope(vm);
    JSArray* pair = JSArray::tryCreateUninitializedRestricted(initializationScope, structure, 2);
    if (!pair) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return nullptr;
    }
    pair->initializeIndex(initializationScope, 0, value);
    pair->initializeIndex(initializationScope, 1, value);
    return pair;
}

// `insertTextAfterRange(range, text)` and the like.
template<FixKind kind>
JSValue fixRange(JSGlobalObject* globalObject, const LintReportState& state, JSValue range, JSValue text)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if constexpr (kind == FixKind::Remove)
        text = jsEmptyString(vm);
    else if (!text.isString()) {
        throwTypeError(globalObject, scope, "'text' must be a string"_s);
        return {};
    }
    if constexpr (kind == FixKind::InsertAfter || kind == FixKind::InsertBefore) {
        JSValue index = range.get(globalObject, kind == FixKind::InsertAfter ? 1u : 0u);
        RETURN_IF_EXCEPTION(scope, {});
        range = createPair(globalObject, index);
        RETURN_IF_EXCEPTION(scope, {});
    }
    JSFinalObject* fix = JSFinalObject::create(vm, state.fixStructure.get());
    fix->putDirectOffset(vm, 0, range);
    fix->putDirectOffset(vm, 1, text);
    return fix;
}

template<FixKind kind>
EncodedJSValue fixRangeFunction(JSGlobalObject* globalObject, CallFrame* callFrame)
{
    return JSValue::encode(fixRange<kind>(globalObject, LintHost::from(globalObject)->report, callFrame->argument(0), callFrame->argument(1)));
}

// `insertTextAfter(nodeOrToken, text) { return this.insertTextAfterRange(nodeOrToken.range, text); }` and the like.
template<FixKind kind>
EncodedJSValue fixNodeFunction(JSGlobalObject* globalObject, CallFrame* callFrame)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    const LintReportState& state = LintHost::from(globalObject)->report;
    JSValue thisValue = callFrame->thisValue();
    // It's frozen.
    bool isFixer = thisValue.isCell() && thisValue.asCell() == state.fixer.get();
    JSValue method;
    if (!isFixer) [[unlikely]] {
        const Identifier& name = kind == FixKind::InsertAfter ? state.insertTextAfterRange
            : kind == FixKind::InsertBefore                   ? state.insertTextBeforeRange
            : kind == FixKind::Replace                        ? state.replaceTextRange
                                                              : state.removeRange;
        method = thisValue.get(globalObject, name);
        RETURN_IF_EXCEPTION(scope, {});
    }
    JSValue range = callFrame->argument(0).get(globalObject, state.range);
    RETURN_IF_EXCEPTION(scope, {});
    if (isFixer) [[likely]]
        RELEASE_AND_RETURN(scope, JSValue::encode(fixRange<kind>(globalObject, state, range, callFrame->argument(1))));
    auto callData = getCallData(method);
    if (callData.type == CallData::Type::None) {
        throwException(globalObject, scope, createNotAFunctionError(globalObject, method));
        return {};
    }
    MarkedArgumentBuffer arguments;
    arguments.append(range);
    if constexpr (kind != FixKind::Remove)
        arguments.append(callFrame->argument(1));
    RELEASE_AND_RETURN(scope, JSValue::encode(call(globalObject, method, callData, thisValue, arguments)));
}

} // namespace

JSC_DEFINE_HOST_FUNCTION(jsLintInsertTextAfter, (JSGlobalObject * globalObject, CallFrame* callFrame)) { return fixNodeFunction<FixKind::InsertAfter>(globalObject, callFrame); }
JSC_DEFINE_HOST_FUNCTION(jsLintInsertTextAfterRange, (JSGlobalObject * globalObject, CallFrame* callFrame)) { return fixRangeFunction<FixKind::InsertAfter>(globalObject, callFrame); }
JSC_DEFINE_HOST_FUNCTION(jsLintInsertTextBefore, (JSGlobalObject * globalObject, CallFrame* callFrame)) { return fixNodeFunction<FixKind::InsertBefore>(globalObject, callFrame); }
JSC_DEFINE_HOST_FUNCTION(jsLintInsertTextBeforeRange, (JSGlobalObject * globalObject, CallFrame* callFrame)) { return fixRangeFunction<FixKind::InsertBefore>(globalObject, callFrame); }
JSC_DEFINE_HOST_FUNCTION(jsLintReplaceText, (JSGlobalObject * globalObject, CallFrame* callFrame)) { return fixNodeFunction<FixKind::Replace>(globalObject, callFrame); }
JSC_DEFINE_HOST_FUNCTION(jsLintReplaceTextRange, (JSGlobalObject * globalObject, CallFrame* callFrame)) { return fixRangeFunction<FixKind::Replace>(globalObject, callFrame); }
JSC_DEFINE_HOST_FUNCTION(jsLintRemove, (JSGlobalObject * globalObject, CallFrame* callFrame)) { return fixNodeFunction<FixKind::Remove>(globalObject, callFrame); }
JSC_DEFINE_HOST_FUNCTION(jsLintRemoveRange, (JSGlobalObject * globalObject, CallFrame* callFrame)) { return fixRangeFunction<FixKind::Remove>(globalObject, callFrame); }

namespace {

JSObject* createFixer(JSGlobalObject* globalObject, LintReportState& state, LintHost* host)
{
    VM& vm = globalObject->vm();
    JSObject* fixer = constructEmptyObject(globalObject);
    auto add = [&](ASCIILiteral name, unsigned length, NativeFunction function) {
        fixer->putDirect(vm, Identifier::fromString(vm, name), JSFunction::create(vm, globalObject, length, name, function, ImplementationVisibility::Public), PropertyAttribute::ReadOnly | PropertyAttribute::DontDelete);
    };
    add("insertTextAfter"_s, 2, jsLintInsertTextAfter);
    add("insertTextAfterRange"_s, 2, jsLintInsertTextAfterRange);
    add("insertTextBefore"_s, 2, jsLintInsertTextBefore);
    add("insertTextBeforeRange"_s, 2, jsLintInsertTextBeforeRange);
    add("replaceText"_s, 2, jsLintReplaceText);
    add("replaceTextRange"_s, 2, jsLintReplaceTextRange);
    add("remove"_s, 1, jsLintRemove);
    add("removeRange"_s, 1, jsLintRemoveRange);
    fixer->methodTable()->preventExtensions(fixer, globalObject);
    state.fixer.set(vm, host, fixer);
    return fixer;
}

} // namespace

// `reporter(meta)` returns `{ position, meta, report }` for a rule. `report` is its `context.report`. The program sets
// `position`, the index of the rule among those that run on the file.
JSC_DEFINE_HOST_FUNCTION(jsLintReporter, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    LintReportState& state = LintHost::from(globalObject)->report;
    JSFinalObject* rule = JSFinalObject::create(vm, state.ruleStructure.get());
    rule->putDirectOffset(vm, 0, jsNumber(0));
    rule->putDirectOffset(vm, 1, callFrame->argument(0));
    rule->putDirectOffset(vm, 2, jsUndefined());
    JSBoundFunction* report = JSBoundFunction::create(vm, globalObject, state.target.get(), rule, ArgList(), 0, state.name.get(), makeSource("report"_s, SourceOrigin(), SourceTaintedOrigin::Untainted));
    RETURN_IF_EXCEPTION(scope, {});
    rule->putDirectOffset(vm, 2, report);
    return JSValue::encode(rule);
}

// `takeReports()` returns the reports about the file so far, each
// `[rule, message, messageId, line, column, endLine, endColumn, fix, suggestions]`, or undefined if there are none.
JSC_DEFINE_HOST_FUNCTION(jsLintTakeReports, (JSGlobalObject * globalObject, CallFrame*))
{
    LintReportState& state = LintHost::from(globalObject)->report;
    JSArray* reports = state.reports.get();
    state.reports.clear();
    return JSValue::encode(reports ? reports : jsUndefined());
}

void LintReportState::finishCreation(VM& vm, JSGlobalObject* globalObject, LintHost* host)
{
    auto set = [&](Identifier& name, ASCIILiteral text) { name = Identifier::fromString(vm, text); };
    set(node, "node"_s);
    set(loc, "loc"_s);
    set(messageId, "messageId"_s);
    set(data, "data"_s);
    set(fix, "fix"_s);
    set(suggest, "suggest"_s);
    set(desc, "desc"_s);
    set(range, "range"_s);
    set(text, "text"_s);
    set(start, "start"_s);
    set(end, "end"_s);
    set(line, "line"_s);
    set(column, "column"_s);
    set(messages, "messages"_s);
    set(fixable, "fixable"_s);
    set(hasSuggestions, "hasSuggestions"_s);
    set(docs, "docs"_s);
    set(suggestion, "suggestion"_s);
    set(includes, "includes"_s);
    set(replace, "replace"_s);
    set(insertTextAfterRange, "insertTextAfterRange"_s);
    set(insertTextBeforeRange, "insertTextBeforeRange"_s);
    set(replaceTextRange, "replaceTextRange"_s);
    set(removeRange, "removeRange"_s);
    JSObject* objectPrototype = globalObject->objectPrototype();
    ruleStructure.set(vm, host, LintHost::createShape(vm, globalObject, objectPrototype, std::to_array<ASCIILiteral>({ "position"_s, "meta"_s, "report"_s })));
    fixStructure.set(vm, host, LintHost::createShape(vm, globalObject, objectPrototype, std::to_array<ASCIILiteral>({ "range"_s, "text"_s })));
    target.set(vm, host, JSFunction::create(vm, globalObject, 0, "report"_s, jsLintReport, ImplementationVisibility::Public));
    name.set(vm, host, jsNontrivialString(vm, "report"_s));
}

void addLintReportFunctions(JSGlobalObject* globalObject, JSObject* native)
{
    VM& vm = globalObject->vm();
    native->putDirect(vm, Identifier::fromString(vm, "reporter"_s), JSFunction::create(vm, globalObject, 1, "reporter"_s, jsLintReporter, ImplementationVisibility::Public));
    native->putDirect(vm, Identifier::fromString(vm, "takeReports"_s), JSFunction::create(vm, globalObject, 0, "takeReports"_s, jsLintTakeReports, ImplementationVisibility::Public));
}

} // namespace Bun
