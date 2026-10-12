// `context.report()` and the `fixer` of JavaScript lint plugins.
//
// Ported from ESLint's lib/linter/file-report.js, rule-fixer.js and interpolate.js (MIT License, see LICENSE.md).
//
// A rule can pass anything. Every property is read once, where ESLint reads it first, so getters and Proxies see the same
// order of reads and exceptions come in the same order.
//
// A report doesn't become a JavaScript value. It's written as bytes, which `sendReports` hands to Rust when the file is done.

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
#include <array>
#include <wtf/text/ASCIIFastPath.h>
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

// Appends to the message for src/lint/js_plugin/reports.rs, which documents the layout. Every target of Bun is little-endian.
class Writer {
public:
    explicit Writer(Vector<uint8_t>& out)
        : m_out(out)
    {
    }

    // There was no memory for something. What has been written is of no use.
    bool hasFailed() const { return m_hasFailed; }

    void word(uint32_t value) { bytes(asByteSpan(value)); }
    void number(double value) { bytes(asByteSpan(value)); }
    // A number that a rule gave. NaN: it gave something else.
    void number(JSValue value) { number(value.isNumber() ? value.asNumber() : PNaN); }

    void bytes(std::span<const uint8_t> added)
    {
        if (!m_hasFailed && !m_out.tryAppend(added))
            m_hasFailed = true;
    }

    void string(StringView text)
    {
        if (text.is8Bit() && charactersAreAllASCII(text.span8())) [[likely]] {
            word(text.length());
            bytes(text.span8());
            return;
        }
        // No character takes more than three bytes for each UTF-16 code unit.
        if (!reserve(4 + size_t(text.length()) * 3))
            return;
        size_t at = m_out.size();
        word(0);
        unsigned length = text.length();
        for (unsigned i = 0; i < length; ++i) {
            char32_t character = text[i];
            if (U16_IS_LEAD(character) && i + 1 < length && U16_IS_TRAIL(text[i + 1]))
                character = U16_GET_SUPPLEMENTARY(character, text[++i]);
            if (character < 0x80) {
                m_out.append(static_cast<uint8_t>(character));
                continue;
            }
            unsigned more = character < 0x800 ? 1 : character < 0x10000 ? 2
                                                                        : 3;
            m_out.append(static_cast<uint8_t>(((0xFF << (7 - more)) & 0xFF) | character >> (6 * more)));
            while (more--)
                m_out.append(static_cast<uint8_t>(0x80 | (character >> (6 * more) & 0x3F)));
        }
        uint32_t size = static_cast<uint32_t>(m_out.size() - at - 4);
        memcpySpan(m_out.mutableSpan().subspan(at, 4), asByteSpan(size));
    }

private:
    bool reserve(size_t more)
    {
        size_t needed = m_out.size() + more;
        if (!m_hasFailed && needed > m_out.capacity() && !m_out.tryReserveCapacity(std::max(needed, m_out.capacity() * 2)))
            m_hasFailed = true;
        return !m_hasFailed;
    }

    Vector<uint8_t>& m_out;
    bool m_hasFailed { false };
};

constexpr uint32_t hasId = 1, hasFix = 2, hasData = 4;

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
    JSValue range = lintGet(globalObject, fix, names.range);
    RETURN_IF_EXCEPTION(scope, {});
    if (range.toBoolean(globalObject)) {
        JSValue start = lintGetIndex(globalObject, range, 0);
        RETURN_IF_EXCEPTION(scope, {});
        if (start.isNumber()) {
            JSValue end = lintGetIndex(globalObject, range, 1);
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

// What a `fix` function comes to: ESLint's `{ range, text }`.
struct Fix {
    // The function returned one.
    bool exists { false };
    double start { 0 };
    double end { 0 };
    // Null: the rule gave something else than a string, and nobody can apply the fix.
    String text;

    bool canBeSent() const { return exists && !text.isNull(); }
    void write(Writer& writer) const
    {
        writer.number(start);
        writer.number(end);
        writer.string(text);
    }
};

// ESLint's `cloneFix`
Fix cloneFix(JSGlobalObject* globalObject, const LintReportState& names, JSValue fix, const Edit& edit)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    JSValue text = lintGet(globalObject, fix, names.text);
    RETURN_IF_EXCEPTION(scope, {});
    Fix result { true, edit.start, edit.end, {} };
    if (text.isString()) [[likely]] {
        result.text = asString(text)->value(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    }
    return result;
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

// ESLint's `mergeFixes`
Fix mergeFixes(JSGlobalObject* globalObject, LintHost* host, JSObject* iterable)
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
        return {};
    if (count == 1) {
        if (notAFix)
            return {};
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
    return { true, start, end, merged.isEmpty() ? emptyString() : merged.toString() };
}

JSObject* createFixer(JSGlobalObject*, LintReportState&, LintHost*);

// ESLint's `normalizeFixes`. `function` is the `fix` of `owner`.
Fix normalizeFixes(JSGlobalObject* globalObject, LintHost* host, JSValue owner, JSValue function)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    LintReportState& state = host->report;
    auto callData = getCallData(function);
    if (callData.type == CallData::Type::None)
        return {};
    JSObject* fixer = state.fixer.get();
    if (!fixer)
        fixer = createFixer(globalObject, state, host);
    MarkedArgumentBuffer arguments;
    arguments.append(fixer);
    JSValue fix = call(globalObject, function, callData, owner, arguments);
    RETURN_IF_EXCEPTION(scope, {});
    if (!fix.toBoolean(globalObject))
        return {};
    // `Symbol.iterator in fix`
    if (!fix.isObject()) {
        throwException(globalObject, scope, createInvalidInParameterError(globalObject, fix));
        return {};
    }
    // What the fixer makes isn't iterable, as long as nobody has made every object so.
    if (asObject(fix)->structure() != state.fixStructure.get() || !state.isObjectPrototypePlain(globalObject)) {
        bool isIterable = asObject(fix)->hasProperty(globalObject, vm.propertyNames->iteratorSymbol);
        RETURN_IF_EXCEPTION(scope, {});
        if (isIterable)
            RELEASE_AND_RETURN(scope, mergeFixes(globalObject, host, asObject(fix)));
    }
    Edit edit = readEdit(globalObject, state, fix, 0);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, cloneFix(globalObject, state, fix, edit));
}

// The argument of `report`. If it's a plain object with data properties, which it nearly always is, all of them are read at once
// by their offsets. Nothing can tell.
class Descriptor {
public:
    using Field = LintReportState::Field;
    using enum LintReportState::Field;

    Descriptor(JSGlobalObject* globalObject, LintHost* host, JSValue value)
        : m_value(value)
        , m_names(host->report)
    {
        if (!value.isObject()) [[unlikely]]
            return;
        JSObject* object = asObject(value);
        auto* shape = host->report.shapeOf(globalObject, host, object->structure());
        if (!shape) [[unlikely]]
            return;
        for (size_t i = 0; i < m_fields.size(); ++i)
            m_fields[i] = shape->offsets[i] == invalidOffset ? jsUndefined() : object->getDirect(shape->offsets[i]);
        m_isRead = true;
    }

    JSValue value() const { return m_value; }

    // Each field is asked for once.
    JSValue get(JSGlobalObject* globalObject, Field field)
    {
        if (m_isRead) [[likely]]
            return m_fields[static_cast<size_t>(field)];
        return m_value.get(globalObject, m_names.fieldNames[static_cast<size_t>(field)]);
    }

private:
    JSValue m_value;
    const LintReportState& m_names;
    std::array<JSValue, LintReportState::fieldCount> m_fields;
    bool m_isRead { false };
};

// ESLint's `computeMessageFromDescriptor`. Sets `messageId`.
JSValue messageOf(JSGlobalObject* globalObject, Descriptor& descriptor, JSValue messages, JSValue& messageId)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    messageId = descriptor.get(globalObject, Descriptor::MessageId);
    RETURN_IF_EXCEPTION(scope, {});
    bool hasId = messageId.toBoolean(globalObject);
    if (hasId && !messages.toBoolean(globalObject)) {
        throwTypeError(globalObject, scope, "context.report() called with a messageId, but no messages were present in the rule metadata."_s);
        return {};
    }
    JSValue message = descriptor.get(globalObject, Descriptor::Message);
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

// Writes `Object.entries(data).map(([key, value]) => [key, String(value)])`. `data` is truthy.
void writeData(JSGlobalObject* globalObject, JSValue data, Writer& writer)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* object = data.toObject(globalObject);
    RETURN_IF_EXCEPTION(scope, );
    PropertyNameArrayBuilder keys(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
    object->methodTable()->getOwnPropertyNames(object, globalObject, keys, DontEnumPropertiesMode::Include);
    RETURN_IF_EXCEPTION(scope, );
    Vector<Identifier, 8> names;
    MarkedArgumentBuffer values;
    for (auto& key : keys) {
        PropertyDescriptor descriptor;
        bool exists = object->getOwnPropertyDescriptor(globalObject, key, descriptor);
        RETURN_IF_EXCEPTION(scope, );
        if (!exists || !descriptor.enumerable())
            continue;
        JSValue value = object->get(globalObject, key);
        RETURN_IF_EXCEPTION(scope, );
        names.append(key);
        values.append(value);
    }
    if (values.hasOverflowed()) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return;
    }
    writer.word(names.size());
    for (unsigned i = 0; i < names.size(); ++i) {
        JSString* string = toStringOrDescription(globalObject, values.at(i));
        RETURN_IF_EXCEPTION(scope, );
        auto view = string->view(globalObject);
        RETURN_IF_EXCEPTION(scope, );
        writer.string(names[i].string());
        writer.string(view);
    }
}

// ESLint's `validateSuggestions` and `mapSuggestions`. `suggest` is an array. `beforeFixes` runs between the two. Writes the
// suggestions that have a fix and returns how many there are, and how many of them were written.
struct Mapped {
    unsigned withFix { 0 };
    unsigned written { 0 };
};
NEVER_INLINE Mapped mapSuggestions(JSGlobalObject* globalObject, LintHost* host, JSValue suggest, JSValue messages, Writer& writer, const Invocable<void()> auto& beforeFixes)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    LintReportState& state = host->report;
    MarkedArgumentBuffer suggested;
    forEachInIterable(globalObject, suggest, [&](VM&, JSGlobalObject*, JSValue suggestion) {
        validateSuggestion(globalObject, state, suggestion, messages, suggested);
    });
    RETURN_IF_EXCEPTION(scope, {});
    if (suggested.hasOverflowed()) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    beforeFixes();
    RETURN_IF_EXCEPTION(scope, {});
    Mapped mapped;
    if (!host->wantsFixes())
        return mapped;
    for (unsigned i = 0; i < suggested.size(); i += suggestionFields) {
        JSValue suggestion = suggested.at(i + suggestionObject);
        JSValue data = suggestion.get(globalObject, state.data);
        RETURN_IF_EXCEPTION(scope, {});
        JSValue desc = interpolate(globalObject, state, suggested.at(i + suggestionText), data);
        RETURN_IF_EXCEPTION(scope, {});
        Fix fix = normalizeFixes(globalObject, host, suggestion, suggested.at(i + suggestionFix));
        RETURN_IF_EXCEPTION(scope, {});
        if (!fix.exists)
            continue;
        ++mapped.withFix;
        // The data is turned into strings even if nobody gets to see it.
        bool isSent = desc.isString() && fix.canBeSent();
        Vector<uint8_t> unseen;
        Writer unseenWriter(unseen);
        Writer& out = isSent ? writer : unseenWriter;
        JSValue id = suggested.at(i + suggestionMessageId);
        bool givesData = data.toBoolean(globalObject);
        out.word((id.isString() ? hasId : 0) | (givesData ? hasData : 0));
        if (isSent) {
            auto view = asString(desc)->view(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            out.string(view);
        }
        if (id.isString()) {
            auto view = asString(id)->view(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            out.string(view);
        }
        if (givesData) {
            writeData(globalObject, data, out);
            RETURN_IF_EXCEPTION(scope, {});
        }
        if (isSent) {
            fix.write(out);
            ++mapped.written;
        }
    }
    return mapped;
}

} // namespace

const LintReportState::Shape* LintReportState::shapeOf(JSGlobalObject* globalObject, LintHost* host, Structure* structure)
{
    auto bits = reinterpret_cast<uintptr_t>(structure);
    Shape& shape = shapes[((bits >> 7) ^ (bits >> 13)) % shapes.size()];
    if (!isObjectPrototypePlain(globalObject)) [[unlikely]] {
        if (!checkObjectPrototype(globalObject, host))
            return nullptr;
    }
    if (shape.structure.get() == structure) [[likely]]
        return &shape;
    // The offsets of a dictionary change, and others answer for themselves.
    if (structure->isDictionary() || structure->typeInfo().overridesGetOwnPropertySlot() || !structure->hasMonoProto() || structure->storedPrototype() != globalObject->objectPrototype())
        return nullptr;
    VM& vm = globalObject->vm();
    std::array<PropertyOffset, fieldCount> offsets;
    for (size_t i = 0; i < fieldCount; ++i) {
        unsigned attributes;
        offsets[i] = structure->get(vm, fieldNames[i], attributes);
        if (offsets[i] != invalidOffset && (attributes & (PropertyAttribute::Accessor | PropertyAttribute::CustomAccessorOrValue)))
            return nullptr;
    }
    shape.structure.set(vm, host, structure);
    shape.offsets = offsets;
    return &shape;
}

bool LintReportState::checkObjectPrototype(JSGlobalObject* globalObject, LintHost* host)
{
    VM& vm = globalObject->vm();
    Structure* structure = globalObject->objectPrototype()->structure();
    if (structure->isDictionary() || structure->typeInfo().overridesGetOwnPropertySlot() || !structure->storedPrototype().isNull())
        return false;
    for (auto& name : fieldNames) {
        if (structure->get(vm, name) != invalidOffset)
            return false;
    }
    if (structure->get(vm, vm.propertyNames->iteratorSymbol) != invalidOffset)
        return false;
    plainObjectPrototype.set(vm, host, structure);
    return true;
}

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
    auto ofMeta = [&](const Identifier& name) { return meta.isUndefinedOrNull() ? jsUndefined() : lintGet(globalObject, meta, name); };

    // ESLint's `normalizeMultiArgReportCall`
    JSValue argument = callFrame->argument(0);
    if (callFrame->argumentCount() > 1) [[unlikely]] {
        unsigned at = 0;
        JSObject* made = constructEmptyObject(globalObject);
        made->putDirect(vm, state.name(Descriptor::Node), callFrame->argument(at++));
        if (!callFrame->argument(1).isString())
            made->putDirect(vm, state.name(Descriptor::Loc), callFrame->argument(at++));
        made->putDirect(vm, state.name(Descriptor::Message), callFrame->argument(at++));
        made->putDirect(vm, state.name(Descriptor::Data), callFrame->argument(at++));
        made->putDirect(vm, state.name(Descriptor::Fix), callFrame->argument(at++));
        argument = made;
    }
    Descriptor descriptor(globalObject, host, argument);
    JSValue messages = ofMeta(state.messages);
    RETURN_IF_EXCEPTION(scope, {});

    // ESLint's `assertValidNodeInfo`
    JSValue node = descriptor.get(globalObject, Descriptor::Node);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue loc;
    if (node.toBoolean(globalObject)) [[likely]] {
        if (!jsTypeofIsObject(globalObject, node)) {
            throwError(globalObject, scope, "Node must be an object"_s);
            return {};
        }
    } else {
        loc = descriptor.get(globalObject, Descriptor::Loc);
        RETURN_IF_EXCEPTION(scope, {});
        if (!loc.toBoolean(globalObject)) {
            throwError(globalObject, scope, "Node must be provided when reporting error if location is not provided"_s);
            return {};
        }
    }

    JSValue messageId;
    JSValue message = messageOf(globalObject, descriptor, messages, messageId);
    RETURN_IF_EXCEPTION(scope, {});

    JSValue suggest = descriptor.get(globalObject, Descriptor::Suggest);
    RETURN_IF_EXCEPTION(scope, {});
    bool hasSuggestions = false;
    if (suggest.toBoolean(globalObject)) [[unlikely]] {
        hasSuggestions = isArray(globalObject, suggest);
        RETURN_IF_EXCEPTION(scope, {});
    }

    // Where it is, and the fix. With suggestions this runs after they are checked and before their fixes are asked for.
    // `start` and `end` are read when the report is made.
    JSValue start, end, line, column, endLine, endColumn;
    Fix fix;
    auto locateAndFix = [&] {
        auto scope = DECLARE_THROW_SCOPE(vm);
        if (!loc) {
            loc = descriptor.get(globalObject, Descriptor::Loc);
            RETURN_IF_EXCEPTION(scope, );
        }
        if (loc.isUndefinedOrNull()) {
            loc = lintGet(globalObject, node, state.name(Descriptor::Loc));
            RETURN_IF_EXCEPTION(scope, );
        }
        if (loc.isUndefinedOrNull()) [[unlikely]] {
            // A copy of a node, `{ ...node }`, has no `loc`, because a node computes it when it's asked for.
            JSValue range = node.get(globalObject, state.range);
            RETURN_IF_EXCEPTION(scope, );
            for (unsigned i = 0; i < 2; ++i) {
                JSValue index = range.get(globalObject, i);
                RETURN_IF_EXCEPTION(scope, );
                double number = index.toNumber(globalObject);
                RETURN_IF_EXCEPTION(scope, );
                auto found = host->positionOf(number);
                (i ? endLine : line) = jsNumber(found.line);
                (i ? endColumn : column) = jsNumber(found.column + 1);
            }
        } else {
            // `start = loc.start ?? loc` and `end = loc.start ? loc.end : null`
            bool isPlain = host->isLoc(loc);
            start = isPlain ? asObject(loc)->getDirect(0) : loc.get(globalObject, state.start);
            RETURN_IF_EXCEPTION(scope, );
            if (start.toBoolean(globalObject)) [[likely]] {
                end = isPlain ? asObject(loc)->getDirect(1) : loc.get(globalObject, state.end);
                RETURN_IF_EXCEPTION(scope, );
            } else if (start.isUndefinedOrNull())
                start = loc;
        }
        if (!host->wantsFixes())
            return;
        JSValue function = descriptor.get(globalObject, Descriptor::Fix);
        RETURN_IF_EXCEPTION(scope, );
        if (function.isUndefined())
            return;
        scope.release();
        fix = normalizeFixes(globalObject, host, descriptor.value(), function);
    };

    Vector<uint8_t> suggestionBytes;
    Mapped mapped;
    if (hasSuggestions) [[unlikely]] {
        Writer writer(suggestionBytes);
        mapped = mapSuggestions(globalObject, host, suggest, messages, writer, locateAndFix);
        RETURN_IF_EXCEPTION(scope, {});
        if (writer.hasFailed()) [[unlikely]] {
            throwOutOfMemoryError(globalObject, scope);
            return {};
        }
    } else {
        locateAndFix();
        RETURN_IF_EXCEPTION(scope, {});
    }

    JSValue data = descriptor.get(globalObject, Descriptor::Data);
    RETURN_IF_EXCEPTION(scope, {});
    message = interpolate(globalObject, state, message, data);
    RETURN_IF_EXCEPTION(scope, {});
    JSString* messageString = toStringOrDescription(globalObject, message);
    RETURN_IF_EXCEPTION(scope, {});
    // `position.line` and `position.column + 1`
    auto read = [&](JSValue position, JSValue& line, JSValue& column) {
        auto scope = DECLARE_THROW_SCOPE(vm);
        if (host->isPosition(position)) [[likely]] {
            line = asObject(position)->getDirect(0);
            column = asObject(position)->getDirect(1);
        } else {
            line = position.get(globalObject, state.line);
            RETURN_IF_EXCEPTION(scope, );
            column = position.get(globalObject, state.column);
            RETURN_IF_EXCEPTION(scope, );
        }
        scope.release();
        column = jsAdd(globalObject, column, jsNumber(1));
    };
    if (start) [[likely]] {
        read(start, line, column);
        RETURN_IF_EXCEPTION(scope, {});
        if (end && end.toBoolean(globalObject)) {
            read(end, endLine, endColumn);
            RETURN_IF_EXCEPTION(scope, {});
        }
    }
    auto messageView = messageString->view(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    GCOwnedDataScope<StringView> idView { nullptr, StringView() };
    if (messageId.isString()) {
        idView = asString(messageId)->view(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    }

    // Nothing from here to the end of the report runs JavaScript.
    size_t before = state.bytes.size();
    Writer writer(state.bytes);
    writer.word(position.isNumber() ? JSC::toUInt32(position.asNumber()) : 0);
    writer.word((messageId.isString() ? hasId : 0) | (fix.canBeSent() ? hasFix : 0));
    writer.number(line);
    writer.number(column);
    writer.number(endLine ? endLine : jsNull());
    writer.number(endColumn ? endColumn : jsNull());
    writer.word(mapped.written);
    writer.string(messageView);
    if (messageId.isString())
        writer.string(idView);
    if (fix.canBeSent())
        fix.write(writer);
    writer.bytes(suggestionBytes.span());
    if (writer.hasFailed()) [[unlikely]] {
        state.bytes.shrink(before);
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }

    if (fix.exists) {
        JSValue fixable = ofMeta(state.fixable);
        RETURN_IF_EXCEPTION(scope, {});
        if (!fixable.toBoolean(globalObject)) {
            throwError(globalObject, scope, "Fixable rules must set the `meta.fixable` property to \"code\" or \"whitespace\"."_s);
            return {};
        }
    }
    if (mapped.withFix) [[unlikely]] {
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
        JSValue index = lintGetIndex(globalObject, range, kind == FixKind::InsertAfter ? 1 : 0);
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
    JSValue range = lintGet(globalObject, callFrame->argument(0), state.range);
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
    JSBoundFunction* report = JSBoundFunction::create(vm, globalObject, state.target.get(), rule, ArgList(), 0, nullptr, makeSource("report"_s, SourceOrigin(), SourceTaintedOrigin::Untainted));
    RETURN_IF_EXCEPTION(scope, {});
    // Its name would be "bound report". Both properties are made when they're first asked for, `length` first.
    report->get(globalObject, vm.propertyNames->length);
    RETURN_IF_EXCEPTION(scope, {});
    report->get(globalObject, vm.propertyNames->name);
    RETURN_IF_EXCEPTION(scope, {});
    report->putDirect(vm, vm.propertyNames->name, state.reportName.get(), PropertyAttribute::ReadOnly | PropertyAttribute::DontEnum);
    rule->putDirectOffset(vm, 2, report);
    return JSValue::encode(rule);
}

// `sendReports()` hands the reports about the file so far to Rust.
JSC_DEFINE_HOST_FUNCTION(jsLintSendReports, (JSGlobalObject * globalObject, CallFrame*))
{
    LintReportState& state = LintHost::from(globalObject)->report;
    // `ask::REPORTS` in src/lint/js_plugin/wire.rs
    constexpr uint32_t reports = 12;
    if (!state.bytes.isEmpty())
        Bun__Lint__ask(globalObject, reports, state.bytes.span().data(), state.bytes.size());
    state.bytes.shrink(0);
    return JSValue::encode(jsUndefined());
}

void LintReportState::finishCreation(VM& vm, JSGlobalObject* globalObject, LintHost* host)
{
    auto set = [&](Identifier& name, ASCIILiteral text) { name = Identifier::fromString(vm, text); };
    constexpr std::array<ASCIILiteral, fieldCount> fields { "node"_s, "loc"_s, "messageId"_s, "message"_s, "suggest"_s, "fix"_s, "data"_s };
    for (size_t i = 0; i < fieldCount; ++i)
        set(fieldNames[i], fields[i]);
    set(messageId, "messageId"_s);
    set(data, "data"_s);
    set(fix, "fix"_s);
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
    set(insertTextAfterRange, "insertTextAfterRange"_s);
    set(insertTextBeforeRange, "insertTextBeforeRange"_s);
    set(replaceTextRange, "replaceTextRange"_s);
    set(removeRange, "removeRange"_s);
    JSObject* objectPrototype = globalObject->objectPrototype();
    ruleStructure.set(vm, host, LintHost::createShape(vm, globalObject, objectPrototype, std::to_array<ASCIILiteral>({ "position"_s, "meta"_s, "report"_s })));
    fixStructure.set(vm, host, LintHost::createShape(vm, globalObject, objectPrototype, std::to_array<ASCIILiteral>({ "range"_s, "text"_s })));
    target.set(vm, host, JSFunction::create(vm, globalObject, 0, "report"_s, jsLintReport, ImplementationVisibility::Public));
    reportName.set(vm, host, jsNontrivialString(vm, "report"_s));
}

void addLintReportFunctions(JSGlobalObject* globalObject, JSObject* native)
{
    VM& vm = globalObject->vm();
    native->putDirect(vm, Identifier::fromString(vm, "reporter"_s), JSFunction::create(vm, globalObject, 1, "reporter"_s, jsLintReporter, ImplementationVisibility::Public));
    native->putDirect(vm, Identifier::fromString(vm, "sendReports"_s), JSFunction::create(vm, globalObject, 0, "sendReports"_s, jsLintSendReports, ImplementationVisibility::Public));
}

} // namespace Bun
