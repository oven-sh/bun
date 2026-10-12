// ESLint's `TokenStore`: the token and comment methods of `sourceCode`.
//
// Rust says where the tokens and comments of the file are (src/lint/js_plugin/tokens.rs). A method searches these tables, and
// an object is made for a token the first time a plugin gets it.
//
// Portions of this file are ported from ESLint, which is under the MIT License. The notice is in
// src/lint/js_plugin/worker/report.js.

#include "LintTokens.h"

#include "LintHost.h"
#include <JavaScriptCore/ArgList.h>
#include <JavaScriptCore/CallData.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/InternalFunction.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/ObjectInitializationScope.h>
#include <JavaScriptCore/ParseInt.h>
#include <wtf/text/MakeString.h>

namespace Bun {
using namespace JSC;

namespace {

// `ask` in src/lint/js_plugin/wire.rs
constexpr uint32_t askForTokens = 7;
constexpr uint32_t askForComments = 8;

// ───────────── the tables ─────────────

// Takes a list out of `words` at `at`, and moves `at` past it.
bool readList(std::span<const uint32_t> words, size_t& at, LintTokenList* list)
{
    if (at >= words.size())
        return false;
    size_t count = words[at++];
    size_t kindWords = (count + 3) / 4;
    if (count > words.size() || 2 * count + kindWords > words.size() - at)
        return false;
    if (list) {
        list->starts = words.subspan(at, count);
        list->ends = words.subspan(at + count, count);
        list->kinds = std::span { reinterpret_cast<const uint8_t*>(words.data() + at + 2 * count), count };
        list->objects.resize(count);
        list->isLoaded = true;
    }
    at += 2 * count + kindWords;
    return true;
}

// The values that come after the lists: how many, `[index, start, end]` for each, then the UTF-16 code units that these count.
bool readDecodedValues(std::span<const uint32_t> words, size_t at, LintTokenState& state)
{
    if (at >= words.size())
        return false;
    size_t count = words[at++];
    if (count > (words.size() - at) / 3)
        return false;
    auto entries = words.subspan(at, 3 * count);
    auto units = std::span { reinterpret_cast<const char16_t*>(words.data() + at + 3 * count), (words.size() - at - 3 * count) * 2 };
    state.decodedValues.reserveInitialCapacity(count);
    for (size_t i = 0; i < count; ++i) {
        uint32_t start = entries[3 * i + 1], end = entries[3 * i + 2];
        if (start > end || end > units.size())
            return false;
        state.decodedValues.append({ entries[3 * i], String(units.subspan(start, end - start)) });
    }
    return true;
}

// Copies the answer, and points the lists at the copy. Returns false if it's cut short.
bool readAnswer(LintHost* host, uint32_t kind, LintSpan answer)
{
    LintTokenState& state = host->tokens;
    Locker locker { host->cellLock() };
    auto& message = kind == askForTokens ? state.tokenMessage : state.commentMessage;
    message.resize(answer.len / 4);
    memcpy(message.mutableSpan().data(), answer.ptr, message.size() * 4);
    size_t at = 0;
    if (kind == askForComments)
        return readList(message.span(), at, &state.comments);
    // The comments may be there already, and plugins may have objects for them.
    return readList(message.span(), at, &state.tokens)
        && readList(message.span(), at, state.comments.isLoaded ? nullptr : &state.comments)
        && readDecodedValues(message.span(), at, state);
}

void load(JSGlobalObject* globalObject, LintHost* host, uint32_t kind)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    // A plugin can call from a timer or a promise, when its file is long done.
    LintSpan answer = host->isLinting() ? Bun__Lint__ask(globalObject, kind, nullptr, 0) : LintSpan {};
    if (!answer.ptr) {
        throwTypeError(globalObject, scope, "No file is being linted"_s);
        return;
    }
    if (!readAnswer(host, kind, answer)) {
        Locker locker { host->cellLock() };
        host->tokens.reset();
        throwTypeError(globalObject, scope, "The tokens are not as expected"_s);
    }
}

// Everything below that can throw says so by the exception alone.

ALWAYS_INLINE void loadTokens(JSGlobalObject* globalObject, LintHost* host)
{
    if (!host->tokens.tokens.isLoaded) [[unlikely]]
        load(globalObject, host, askForTokens);
}

// The parser has listed the comments, so this doesn't scan the file.
ALWAYS_INLINE void loadComments(JSGlobalObject* globalObject, LintHost* host)
{
    if (!host->tokens.comments.isLoaded) [[unlikely]]
        load(globalObject, host, askForComments);
}

// ───────────── the objects ─────────────

JSArray* createRange(JSGlobalObject* globalObject, uint32_t start, uint32_t end)
{
    VM& vm = globalObject->vm();
    ObjectInitializationScope initializationScope(vm);
    JSArray* range = JSArray::tryCreateUninitializedRestricted(initializationScope, globalObject->arrayStructureForIndexingTypeDuringAllocation(ArrayWithInt32), 2);
    if (!range) [[unlikely]]
        return nullptr;
    range->initializeIndex(initializationScope, 0, jsNumber(start));
    range->initializeIndex(initializationScope, 1, jsNumber(end));
    return range;
}

// `text.slice(start, end)`
JSString* slice(VM& vm, LintHost* host, uint32_t start, uint32_t end)
{
    end = std::min(end, host->text()->length());
    start = std::min(start, end);
    return jsSubstringOfResolved(vm, host->text(), start, end - start);
}

const String* decodedValue(const LintTokenState& state, uint32_t index)
{
    auto& values = state.decodedValues;
    auto found = std::lower_bound(values.begin(), values.end(), index, [](auto& entry, uint32_t index) { return entry.first < index; });
    return found != values.end() && found->first == index ? &found->second : nullptr;
}

JSObject* createToken(JSGlobalObject* globalObject, LintHost* host, LintTokenList& list, uint32_t index)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    LintTokenState& state = host->tokens;
    uint32_t start = list.starts[index], end = list.ends[index];
    uint8_t kindByte = list.kinds[index];
    if (kindByte >= lintTokenKindCount) [[unlikely]] {
        throwTypeError(globalObject, scope, "The tokens are not as expected"_s);
        return nullptr;
    }
    auto kind = static_cast<LintTokenKind>(kindByte);
    bool isRegex = kind == LintTokenKind::RegularExpression;

    JSFinalObject* token = JSFinalObject::create(vm, (isRegex ? state.regexTokenStructure : state.tokenStructure).get());
    token->putDirectOffset(vm, 0, state.typeNames[kindByte].get());
    token->putDirectOffset(vm, 2, jsNumber(start));
    token->putDirectOffset(vm, 3, jsNumber(end));

    const String* decoded = &list == &state.tokens && !state.decodedValues.isEmpty() ? decodedValue(state, index) : nullptr;
    JSString* value;
    if (decoded) [[unlikely]]
        value = jsString(vm, *decoded);
    else {
        switch (kind) {
        case LintTokenKind::PrivateIdentifier:
            value = slice(vm, host, start + 1, end);
            break;
        case LintTokenKind::Line: {
            // `<!--` and `-->` are comments too.
            auto first = start < host->textString().length() ? host->textString().codeUnitAt(start) : 0;
            value = slice(vm, host, start + (first == '<' ? 4 : first == '-' ? 3
                                                                             : 2),
                end);
            break;
        }
        case LintTokenKind::Block:
            value = slice(vm, host, start + 2, end < 2 ? 0 : end - 2);
            break;
        case LintTokenKind::Shebang:
            value = slice(vm, host, start + 2, end);
            break;
        default:
            value = slice(vm, host, start, end);
        }
    }
    token->putDirectOffset(vm, 1, value);

    JSArray* range = createRange(globalObject, start, end);
    if (!range) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return nullptr;
    }
    token->putDirectOffset(vm, 4, range);

    if (isRegex) {
        uint32_t slash = std::min(end, host->textString().length());
        while (slash > start + 1 && host->textString().codeUnitAt(slash - 1) != '/')
            --slash;
        JSFinalObject* regex = JSFinalObject::create(vm, state.regexStructure.get());
        token->putDirectOffset(vm, 5, regex);
        regex->putDirectOffset(vm, 0, slice(vm, host, start + 1, slash - 1));
        regex->putDirectOffset(vm, 1, slice(vm, host, slash, end));
    }
    list.objects[index].set(vm, host, token);
    return token;
}

// One of the tokens, or one of the comments.
struct TokenRef {
    bool isComment { false };
    uint32_t index { 0 };
};

ALWAYS_INLINE LintTokenList& listOf(LintTokenState& state, TokenRef ref)
{
    return ref.isComment ? state.comments : state.tokens;
}

// `index` is less than `list.count()`.
ALWAYS_INLINE JSObject* tokenAt(JSGlobalObject* globalObject, LintHost* host, LintTokenList& list, uint32_t index)
{
    if (JSObject* token = list.objects[index].get()) [[likely]]
        return token;
    return createToken(globalObject, host, list, index);
}

ALWAYS_INLINE JSObject* tokenAt(JSGlobalObject* globalObject, LintHost* host, TokenRef ref)
{
    return tokenAt(globalObject, host, listOf(host->tokens, ref), ref.index);
}

// An array of `items`, or of `items` from the last to the first.
JSArray* createArray(JSGlobalObject* globalObject, MarkedArgumentBuffer& items, bool isReversed = false)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSArray* array = nullptr;
    if (!items.hasOverflowed()) [[likely]] {
        ObjectInitializationScope initializationScope(vm);
        unsigned size = items.size();
        array = JSArray::tryCreateUninitializedRestricted(initializationScope, globalObject->arrayStructureForIndexingTypeDuringAllocation(ArrayWithContiguous), size);
        if (array) [[likely]] {
            for (unsigned i = 0; i < size; ++i)
                array->initializeIndex(initializationScope, i, items.at(isReversed ? size - 1 - i : i));
        }
    }
    if (!array) [[unlikely]]
        throwOutOfMemoryError(globalObject, scope);
    return array;
}

// The tokens of `list` from `from` up to, not including, `to`.
JSArray* createArray(JSGlobalObject* globalObject, LintHost* host, LintTokenList& list, int64_t from, int64_t to)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    MarkedArgumentBuffer items;
    to = std::min<int64_t>(to, list.count());
    for (int64_t index = std::max<int64_t>(from, 0); index < to; ++index) {
        JSObject* token = tokenAt(globalObject, host, list, static_cast<uint32_t>(index));
        RETURN_IF_EXCEPTION(scope, nullptr);
        items.append(token);
    }
    RELEASE_AND_RETURN(scope, createArray(globalObject, items));
}

// ───────────── searching ─────────────

// The index of the first of the sorted `numbers` that is not less than `number`.
uint32_t lowerBound(std::span<const uint32_t> numbers, double number)
{
    // Also if it's NaN.
    if (!(number > 0))
        return 0;
    if (number > std::numeric_limits<uint32_t>::max())
        return static_cast<uint32_t>(numbers.size());
    auto least = static_cast<uint32_t>(std::ceil(number));
    return static_cast<uint32_t>(std::lower_bound(numbers.begin(), numbers.end(), least) - numbers.begin());
}

// The index of the first token that starts at `location` or later. -1 is the start of the file.
int64_t firstIndex(const LintTokenList& list, double location)
{
    return location == -1 ? 0 : lowerBound(list.starts, location);
}

// The index of the last token that ends at `location` or before. -1 is the end of the file.
int64_t lastIndex(const LintTokenList& list, double location)
{
    return location == -1 ? int64_t(list.count()) - 1 : int64_t(lowerBound(list.ends, location + 1)) - 1;
}

// From `start` to `end` of the text. -1 is where the file starts or ends.
struct Span {
    double start { -1 };
    double end { -1 };
};

// Goes through the tokens in a part of the text, from the first to the last or the other way round. It holds indices only, and
// checks them against the tables each time, so JavaScript can run between two calls of `next`.
class Cursor {
public:
    Cursor(LintTokenState& state, bool isForward, Span span, bool includeComments)
        : m_state(state)
        , m_isForward(isForward)
        , m_includeComments(includeComments)
        , m_span(span)
    {
        m_token = isForward ? firstIndex(state.tokens, span.start) : lastIndex(state.tokens, span.end);
        if (!includeComments)
            m_last = isForward ? lastIndex(state.tokens, span.end) : firstIndex(state.tokens, span.start);
        else if (isForward)
            m_comment = firstIndex(state.comments, span.start);
        else
            m_comment = (span.end == -1 ? int64_t(state.comments.count()) : int64_t(lowerBound(state.comments.starts, span.end))) - 1;
    }

    bool next(TokenRef& ref)
    {
        auto& tokens = m_state.tokens;
        auto& comments = m_state.comments;
        bool hasToken = m_token >= 0 && m_token < tokens.count();
        if (!m_includeComments) {
            if (!hasToken || (m_isForward ? m_token > m_last : m_token < m_last))
                return false;
            ref = { false, static_cast<uint32_t>(m_token) };
            m_token += m_isForward ? 1 : -1;
            return true;
        }
        bool hasComment = m_comment >= 0 && m_comment < comments.count();
        if (!hasToken && !hasComment)
            return false;
        if (m_isForward) {
            bool isToken = hasToken && (!hasComment || tokens.starts[m_token] < comments.starts[m_comment]);
            ref = { !isToken, static_cast<uint32_t>(isToken ? m_token++ : m_comment++) };
            return m_span.end == -1 || listOf(m_state, ref).ends[ref.index] <= m_span.end;
        }
        bool isToken = hasToken && (!hasComment || tokens.ends[m_token] > comments.ends[m_comment]);
        ref = { !isToken, static_cast<uint32_t>(isToken ? m_token-- : m_comment--) };
        return m_span.start == -1 || listOf(m_state, ref).starts[ref.index] >= m_span.start;
    }

private:
    LintTokenState& m_state;
    bool m_isForward;
    bool m_includeComments;
    Span m_span;
    int64_t m_token;
    // Without comments: the index of the last token to return.
    int64_t m_last { 0 };
    int64_t m_comment { 0 };
};

// ───────────── arguments ─────────────

void throwNotAnObject(JSGlobalObject* globalObject, ThrowScope& scope, JSValue value, ASCIILiteral parameter, ASCIILiteral rest)
{
    throwTypeError(globalObject, scope, makeString(value.isNull() ? "null"_s : "undefined"_s, " is not an object (evaluating '"_s, parameter, rest, "')"_s));
}

// `target.range`. `parameter` is what ESLint calls `target`.
JSValue rangeOf(JSGlobalObject* globalObject, LintHost* host, JSValue target, ASCIILiteral parameter)
{
    VM& vm = globalObject->vm();
    LintTokenState& state = host->tokens;
    if (target.isObject()) [[likely]] {
        JSObject* object = asObject(target);
        Structure* structure = object->structure();
        auto bits = reinterpret_cast<uintptr_t>(structure);
        auto& entry = state.rangeOffsets[((bits >> 7) ^ (bits >> 13)) % state.rangeOffsets.size()];
        if (entry.structure.get() == structure) [[likely]]
            return object->getDirect(entry.offset);
        // The offsets of a dictionary change, and others answer for themselves.
        if (!structure->isDictionary() && !structure->typeInfo().overridesGetOwnPropertySlot()) {
            unsigned attributes;
            PropertyOffset offset = structure->get(vm, state.rangeName, attributes);
            if (offset != invalidOffset && !(attributes & (PropertyAttribute::Accessor | PropertyAttribute::CustomAccessorOrValue))) {
                entry.structure.set(vm, host, structure);
                entry.offset = offset;
                return object->getDirect(offset);
            }
        }
    }
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (target.isUndefinedOrNull()) {
        throwNotAnObject(globalObject, scope, target, parameter, ".range"_s);
        return {};
    }
    RELEASE_AND_RETURN(scope, target.get(globalObject, state.rangeName));
}

// `range[index]`
JSValue elementOf(JSGlobalObject* globalObject, JSValue range, unsigned index, ASCIILiteral parameter)
{
    if (range.isCell() && isJSArray(range.asCell())) [[likely]] {
        JSArray* array = asArray(range);
        if (array->canGetIndexQuickly(index)) [[likely]]
            return array->getIndexQuickly(index);
    }
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (range.isUndefinedOrNull()) {
        throwNotAnObject(globalObject, scope, range, parameter, index ? ".range[1]"_s : ".range[0]"_s);
        return {};
    }
    RELEASE_AND_RETURN(scope, range.get(globalObject, index));
}

// `range[index]` as a number
double numberIn(JSGlobalObject* globalObject, JSValue range, unsigned index, ASCIILiteral parameter)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    JSValue element = elementOf(globalObject, range, index, parameter);
    RETURN_IF_EXCEPTION(scope, 0);
    RELEASE_AND_RETURN(scope, element.toNumber(globalObject));
}

// A `Span` as it's read from the arguments. ESLint reads the options before it does anything with these, so what they are as
// numbers is found out after that too.
struct Locations {
    JSValue start { jsNumber(-1) };
    JSValue end { jsNumber(-1) };
};

Span toSpanSlow(JSGlobalObject* globalObject, Locations locations)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    Span span;
    span.start = locations.start.toNumber(globalObject);
    RETURN_IF_EXCEPTION(scope, span);
    span.end = locations.end.toNumber(globalObject);
    return span;
}

ALWAYS_INLINE Span toSpan(JSGlobalObject* globalObject, Locations locations)
{
    if (locations.start.isNumber() && locations.end.isNumber()) [[likely]]
        return { locations.start.asNumber(), locations.end.asNumber() };
    return toSpanSlow(globalObject, locations);
}

// Which part of the text a method looks at, given its first argument or its first two.
enum class Where {
    Inside,
    Before,
    After,
    Between,
};

template<Where where>
void readLocations(JSGlobalObject* globalObject, LintHost* host, CallFrame* callFrame, Locations& locations, ASCIILiteral parameter = "node"_s)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue range = rangeOf(globalObject, host, callFrame->argument(0), where == Where::Between ? "left"_s : parameter);
    RETURN_IF_EXCEPTION(scope, void());
    if constexpr (where == Where::Inside) {
        locations.start = elementOf(globalObject, range, 0, parameter);
        RETURN_IF_EXCEPTION(scope, void());
        RELEASE_AND_RETURN(scope, void(locations.end = elementOf(globalObject, range, 1, parameter)));
    } else if constexpr (where == Where::Before)
        RELEASE_AND_RETURN(scope, void(locations.end = elementOf(globalObject, range, 0, parameter)));
    else if constexpr (where == Where::After)
        RELEASE_AND_RETURN(scope, void(locations.start = elementOf(globalObject, range, 1, parameter)));
    else {
        locations.start = elementOf(globalObject, range, 1, "left"_s);
        RETURN_IF_EXCEPTION(scope, void());
        range = rangeOf(globalObject, host, callFrame->argument(1), "right"_s);
        RETURN_IF_EXCEPTION(scope, void());
        RELEASE_AND_RETURN(scope, void(locations.end = elementOf(globalObject, range, 0, "right"_s)));
    }
}

template<Where where>
ALWAYS_INLINE JSValue optionsOf(CallFrame* callFrame)
{
    return callFrame->argument(where == Where::Between ? 2 : 1);
}

struct Options {
    bool includeComments { false };
    // How many tokens to skip, or how many to return at most. -1: all of them.
    int32_t number { 0 };
    // Not callable: there's none.
    JSValue filter;
    CallData callData;
};

void throwError(JSGlobalObject* globalObject, ThrowScope& scope, ASCIILiteral message)
{
    throwException(globalObject, scope, createError(globalObject, String(message)));
}

void checkFilter(JSGlobalObject* globalObject, ThrowScope& scope, Options& options)
{
    if (!options.filter)
        return;
    options.callData = getCallData(options.filter);
    if (options.callData.type == CallData::Type::None)
        throwError(globalObject, scope, "options.filter should be a function."_s);
}

// Reads `{ includeComments, filter }` and `key`, in ESLint's order. Returns what `key` is.
JSValue readOptionsObject(JSGlobalObject* globalObject, LintHost* host, JSValue value, const Identifier& key, Options& options)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue includeComments = value.get(globalObject, host->tokens.includeCommentsName);
    RETURN_IF_EXCEPTION(scope, {});
    options.includeComments = includeComments.toBoolean(globalObject);
    JSValue number = value.get(globalObject, key);
    RETURN_IF_EXCEPTION(scope, {});
    options.number = number.toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue filter = value.get(globalObject, host->tokens.filterName);
    RETURN_IF_EXCEPTION(scope, {});
    if (filter.toBoolean(globalObject))
        options.filter = filter;
    return number;
}

// The options of ESLint's `createCursorWithSkip`
void readSkipOptions(JSGlobalObject* globalObject, LintHost* host, JSValue value, Options& options)
{
    if (value.isUndefined()) [[likely]]
        return;
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (value.isNumber())
        options.number = toInt32(value.asNumber());
    else if (value.isCallable())
        options.filter = value;
    else if (value.toBoolean(globalObject)) {
        readOptionsObject(globalObject, host, value, host->tokens.skipName, options);
        RETURN_IF_EXCEPTION(scope, void());
    }
    if (options.number < 0) {
        throwError(globalObject, scope, "options.skip should be zero or a positive integer."_s);
        return;
    }
    checkFilter(globalObject, scope, options);
}

// The options of ESLint's `createCursorWithCount`
void readCountOptions(JSGlobalObject* globalObject, LintHost* host, JSValue value, Options& options)
{
    options.number = -1;
    if (value.isUndefined()) [[likely]]
        return;
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    bool isValid = true;
    if (value.isNumber()) {
        options.number = toInt32(value.asNumber());
        isValid = options.number >= -1;
    } else if (value.isCallable())
        options.filter = value;
    else if (value.toBoolean(globalObject)) {
        JSValue count = readOptionsObject(globalObject, host, value, host->tokens.countName, options);
        RETURN_IF_EXCEPTION(scope, void());
        isValid = options.number >= 0;
        // What isn't a number is checked, and then counts for nothing.
        if (!count.isNumber())
            options.number = -1;
    }
    if (!isValid) {
        throwError(globalObject, scope, "options.count should be zero or a positive integer."_s);
        return;
    }
    checkFilter(globalObject, scope, options);
}

// Calls `options.filter`.
bool passesFilter(JSGlobalObject* globalObject, const Options& options, JSObject* token)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    MarkedArgumentBuffer arguments;
    arguments.append(token);
    JSValue result = call(globalObject, options.filter, options.callData, jsUndefined(), arguments);
    RETURN_IF_EXCEPTION(scope, false);
    return result.toBoolean(globalObject);
}

// ───────────── what the methods do ─────────────

// ESLint's `createCursorWithSkip(..).getOneToken()`
EncodedJSValue oneToken(JSGlobalObject* globalObject, LintHost* host, bool isForward, Locations locations, Options& options)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    Span span = toSpan(globalObject, locations);
    RETURN_IF_EXCEPTION(scope, {});
    loadTokens(globalObject, host);
    RETURN_IF_EXCEPTION(scope, {});
    Cursor cursor(host->tokens, isForward, span, options.includeComments);
    int32_t skip = options.number;
    for (TokenRef ref; cursor.next(ref);) {
        if (options.filter) {
            JSObject* token = tokenAt(globalObject, host, ref);
            RETURN_IF_EXCEPTION(scope, {});
            bool passes = passesFilter(globalObject, options, token);
            RETURN_IF_EXCEPTION(scope, {});
            if (!passes)
                continue;
            if (!skip--)
                return JSValue::encode(token);
        } else if (!skip--)
            RELEASE_AND_RETURN(scope, JSValue::encode(tokenAt(globalObject, host, ref)));
    }
    return JSValue::encode(jsNull());
}

// ESLint's `createCursorWithCount(..).getAllTokens()`, in the order of the text. With `onlyComments` ESLint's `isCommentToken` is
// the filter.
EncodedJSValue someTokens(JSGlobalObject* globalObject, LintHost* host, bool isForward, Locations locations, Options& options, bool onlyComments = false)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    MarkedArgumentBuffer found;
    if (options.number) {
        Span span = toSpan(globalObject, locations);
        RETURN_IF_EXCEPTION(scope, {});
        loadTokens(globalObject, host);
        RETURN_IF_EXCEPTION(scope, {});
        Cursor cursor(host->tokens, isForward, span, options.includeComments);
        for (TokenRef ref; cursor.next(ref);) {
            if (onlyComments && !ref.isComment)
                continue;
            JSObject* token = tokenAt(globalObject, host, ref);
            RETURN_IF_EXCEPTION(scope, {});
            if (options.filter) {
                bool passes = passesFilter(globalObject, options, token);
                RETURN_IF_EXCEPTION(scope, {});
                if (!passes)
                    continue;
            }
            found.append(token);
            if (found.size() == static_cast<uint32_t>(options.number))
                break;
        }
    }
    RELEASE_AND_RETURN(scope, JSValue::encode(createArray(globalObject, found, !isForward)));
}

// ESLint's `createCursorWithPadding(..).getAllTokens()`
EncodedJSValue paddedTokens(JSGlobalObject* globalObject, LintHost* host, Locations locations, JSValue before, JSValue after)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!before.isNumber() && !before.isUndefined()) {
        Options options;
        readCountOptions(globalObject, host, before, options);
        RETURN_IF_EXCEPTION(scope, {});
        RELEASE_AND_RETURN(scope, someTokens(globalObject, host, true, locations, options));
    }
    Span span = toSpan(globalObject, locations);
    RETURN_IF_EXCEPTION(scope, {});
    int32_t beforeCount = before.isNumber() ? toInt32(before.asNumber()) : 0;
    int32_t afterCount = after.toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    loadTokens(globalObject, host);
    RETURN_IF_EXCEPTION(scope, {});
    auto& tokens = host->tokens.tokens;
    RELEASE_AND_RETURN(scope, JSValue::encode(createArray(globalObject, host, tokens, firstIndex(tokens, span.start) - beforeCount, lastIndex(tokens, span.end) + afterCount + 1)));
}

// The comments from where `cursor` is up to the first token.
EncodedJSValue adjacentComments(JSGlobalObject* globalObject, LintHost* host, bool isForward, Locations locations)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    Span span = toSpan(globalObject, locations);
    RETURN_IF_EXCEPTION(scope, {});
    loadTokens(globalObject, host);
    RETURN_IF_EXCEPTION(scope, {});
    MarkedArgumentBuffer found;
    Cursor cursor(host->tokens, isForward, span, true);
    for (TokenRef ref; cursor.next(ref) && ref.isComment;) {
        JSObject* comment = tokenAt(globalObject, host, ref);
        RETURN_IF_EXCEPTION(scope, {});
        found.append(comment);
    }
    RELEASE_AND_RETURN(scope, JSValue::encode(createArray(globalObject, found, !isForward)));
}

template<Where where>
ALWAYS_INLINE EncodedJSValue oneTokenMethod(JSGlobalObject* globalObject, CallFrame* callFrame, bool isForward)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    LintHost* host = LintHost::from(globalObject);
    Locations locations;
    readLocations<where>(globalObject, host, callFrame, locations);
    RETURN_IF_EXCEPTION(scope, {});
    Options options;
    readSkipOptions(globalObject, host, optionsOf<where>(callFrame), options);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, oneToken(globalObject, host, isForward, locations, options));
}

template<Where where>
ALWAYS_INLINE EncodedJSValue someTokensMethod(JSGlobalObject* globalObject, CallFrame* callFrame, bool isForward)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    LintHost* host = LintHost::from(globalObject);
    Locations locations;
    readLocations<where>(globalObject, host, callFrame, locations);
    RETURN_IF_EXCEPTION(scope, {});
    Options options;
    readCountOptions(globalObject, host, optionsOf<where>(callFrame), options);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, someTokens(globalObject, host, isForward, locations, options));
}

// Until ESLint 8: `getTokenBefore(node, { includeComments: true, skip })`, and the same with `getTokenAfter`.
template<Where where>
ALWAYS_INLINE EncodedJSValue tokenOrCommentMethod(JSGlobalObject* globalObject, CallFrame* callFrame, bool isForward)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    LintHost* host = LintHost::from(globalObject);
    Locations locations;
    readLocations<where>(globalObject, host, callFrame, locations);
    RETURN_IF_EXCEPTION(scope, {});
    Options options;
    options.includeComments = true;
    options.number = callFrame->argument(1).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (options.number < 0) {
        throwError(globalObject, scope, "options.skip should be zero or a positive integer."_s);
        return {};
    }
    RELEASE_AND_RETURN(scope, oneToken(globalObject, host, isForward, locations, options));
}

bool hasWhitespace(StringView text)
{
    for (unsigned i = 0; i < text.length(); ++i) {
        if (isStrWhiteSpace(text[i]))
            return true;
    }
    return false;
}

// Whether the `value` of a token has whitespace in it.
bool valueHasWhitespace(LintHost* host, uint32_t index)
{
    LintTokenState& state = host->tokens;
    if (const String* decoded = decodedValue(state, index))
        return hasWhitespace(*decoded);
    uint32_t end = std::min(state.tokens.ends[index], host->textString().length());
    uint32_t start = std::min(state.tokens.starts[index], end);
    return hasWhitespace(StringView(host->textString()).substring(start, end - start));
}

// `looksIntoText`: a blank in the text between two JSX elements counts too, as until ESLint 9.
EncodedJSValue isSpaceBetween(JSGlobalObject* globalObject, CallFrame* callFrame, bool looksIntoText)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    LintHost* host = LintHost::from(globalObject);
    LintTokenState& state = host->tokens;
    JSValue first = callFrame->argument(0), second = callFrame->argument(1);
    // Each location is read once, when ESLint first reads it.
    Span firstSpan, secondSpan;
    JSValue firstRange = rangeOf(globalObject, host, first, "first"_s);
    RETURN_IF_EXCEPTION(scope, {});
    firstSpan.start = numberIn(globalObject, firstRange, 0, "first"_s);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue secondRange = rangeOf(globalObject, host, second, "second"_s);
    RETURN_IF_EXCEPTION(scope, {});
    secondSpan.start = numberIn(globalObject, secondRange, 0, "second"_s);
    RETURN_IF_EXCEPTION(scope, {});
    bool isFirstEndRead = firstSpan.start <= secondSpan.start;
    if (isFirstEndRead) {
        firstSpan.end = numberIn(globalObject, firstRange, 1, "first"_s);
        RETURN_IF_EXCEPTION(scope, {});
        if (firstSpan.end >= secondSpan.start)
            return JSValue::encode(jsBoolean(false));
    }
    bool isSecondEndRead = secondSpan.start <= firstSpan.start;
    if (isSecondEndRead) {
        secondSpan.end = numberIn(globalObject, secondRange, 1, "second"_s);
        RETURN_IF_EXCEPTION(scope, {});
        if (secondSpan.end >= firstSpan.start)
            return JSValue::encode(jsBoolean(false));
    }
    if (!isFirstEndRead) {
        firstSpan.end = numberIn(globalObject, firstRange, 1, "first"_s);
        RETURN_IF_EXCEPTION(scope, {});
    }
    if (!isSecondEndRead) {
        secondSpan.end = numberIn(globalObject, secondRange, 1, "second"_s);
        RETURN_IF_EXCEPTION(scope, {});
    }
    loadTokens(globalObject, host);
    RETURN_IF_EXCEPTION(scope, {});

    bool isInOrder = firstSpan.end <= secondSpan.start;
    Span starting = isInOrder ? firstSpan : secondSpan, ending = isInOrder ? secondSpan : firstSpan;
    // The walk ends at the first token of `ending`, or at `ending` itself if there's no token in it. Then it's a comment, most likely.
    TokenRef final;
    bool hasFinal = Cursor(state, true, ending, false).next(final);
    JSValue finalObject = isInOrder ? second : first;
    auto isFinal = [&](TokenRef ref) {
        if (hasFinal)
            return !ref.isComment && ref.index == final.index;
        return JSValue(listOf(state, ref).objects[ref.index].get()) == finalObject;
    };

    TokenRef current;
    double currentEnd = starting.end;
    if (Cursor(state, false, starting, false).next(current)) {
        if (isFinal(current))
            return JSValue::encode(jsBoolean(false));
        currentEnd = state.tokens.ends[current.index];
    } else if ((isInOrder ? first : second) == finalObject && !hasFinal)
        return JSValue::encode(jsBoolean(false));
    while (true) {
        TokenRef next;
        if (!Cursor(state, true, { currentEnd, -1 }, true).next(next)) {
            throwNotAnObject(globalObject, scope, jsNull(), "next"_s, ".range"_s);
            return {};
        }
        auto& list = listOf(state, next);
        if (currentEnd != list.starts[next.index])
            return JSValue::encode(jsBoolean(true));
        if (isFinal(next))
            return JSValue::encode(jsBoolean(false));
        if (looksIntoText && !next.isComment && list.kinds[next.index] == static_cast<uint8_t>(LintTokenKind::JSXText) && valueHasWhitespace(host, next.index))
            return JSValue::encode(jsBoolean(true));
        currentEnd = list.ends[next.index];
    }
}

// `ast.tokens` or `ast.comments`
EncodedJSValue allOf(JSGlobalObject* globalObject, LintHost* host, LintTokenList& list)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (JSArray* all = list.all.get())
        return JSValue::encode(all);
    JSArray* all = createArray(globalObject, host, list, 0, list.count());
    RETURN_IF_EXCEPTION(scope, {});
    list.all.set(vm, host, all);
    return JSValue::encode(all);
}

} // namespace

// ───────────── the methods ─────────────

JSC_DEFINE_HOST_FUNCTION(jsLintGetTokenByRangeStart, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    LintHost* host = LintHost::from(globalObject);
    JSValue offset = callFrame->argument(0);
    JSValue options = callFrame->argument(1);
    bool includeComments = false;
    if (options.toBoolean(globalObject)) {
        JSValue value = options.get(globalObject, host->tokens.includeCommentsName);
        RETURN_IF_EXCEPTION(scope, {});
        includeComments = value.toBoolean(globalObject);
    }
    loadTokens(globalObject, host);
    RETURN_IF_EXCEPTION(scope, {});
    TokenRef ref;
    if (!offset.isNumber() || !Cursor(host->tokens, true, { offset.asNumber(), -1 }, includeComments).next(ref))
        return JSValue::encode(jsNull());
    if (listOf(host->tokens, ref).starts[ref.index] != offset.asNumber())
        return JSValue::encode(jsNull());
    RELEASE_AND_RETURN(scope, JSValue::encode(tokenAt(globalObject, host, ref)));
}

#define LINT_TOKEN_METHOD(name, implementation, where, isForward)                          \
    JSC_DEFINE_HOST_FUNCTION(name, (JSGlobalObject * globalObject, CallFrame * callFrame)) \
    {                                                                                      \
        return implementation<Where::where>(globalObject, callFrame, isForward);           \
    }

LINT_TOKEN_METHOD(jsLintGetFirstToken, oneTokenMethod, Inside, true)
LINT_TOKEN_METHOD(jsLintGetLastToken, oneTokenMethod, Inside, false)
LINT_TOKEN_METHOD(jsLintGetTokenBefore, oneTokenMethod, Before, false)
LINT_TOKEN_METHOD(jsLintGetTokenAfter, oneTokenMethod, After, true)
LINT_TOKEN_METHOD(jsLintGetFirstTokenBetween, oneTokenMethod, Between, true)
LINT_TOKEN_METHOD(jsLintGetLastTokenBetween, oneTokenMethod, Between, false)
LINT_TOKEN_METHOD(jsLintGetFirstTokens, someTokensMethod, Inside, true)
LINT_TOKEN_METHOD(jsLintGetLastTokens, someTokensMethod, Inside, false)
LINT_TOKEN_METHOD(jsLintGetTokensBefore, someTokensMethod, Before, false)
LINT_TOKEN_METHOD(jsLintGetTokensAfter, someTokensMethod, After, true)
LINT_TOKEN_METHOD(jsLintGetFirstTokensBetween, someTokensMethod, Between, true)
LINT_TOKEN_METHOD(jsLintGetLastTokensBetween, someTokensMethod, Between, false)
LINT_TOKEN_METHOD(jsLintGetTokenOrCommentBefore, tokenOrCommentMethod, Before, false)
LINT_TOKEN_METHOD(jsLintGetTokenOrCommentAfter, tokenOrCommentMethod, After, true)

#undef LINT_TOKEN_METHOD

JSC_DEFINE_HOST_FUNCTION(jsLintGetTokens, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    LintHost* host = LintHost::from(globalObject);
    Locations locations;
    readLocations<Where::Inside>(globalObject, host, callFrame, locations);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, paddedTokens(globalObject, host, locations, callFrame->argument(1), callFrame->argument(2)));
}

JSC_DEFINE_HOST_FUNCTION(jsLintGetTokensBetween, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    LintHost* host = LintHost::from(globalObject);
    Locations locations;
    readLocations<Where::Between>(globalObject, host, callFrame, locations);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, paddedTokens(globalObject, host, locations, callFrame->argument(2), callFrame->argument(2)));
}

JSC_DEFINE_HOST_FUNCTION(jsLintCommentsExistBetween, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    LintHost* host = LintHost::from(globalObject);
    JSValue range = rangeOf(globalObject, host, callFrame->argument(0), "left"_s);
    RETURN_IF_EXCEPTION(scope, {});
    double start = numberIn(globalObject, range, 1, "left"_s);
    RETURN_IF_EXCEPTION(scope, {});
    loadComments(globalObject, host);
    RETURN_IF_EXCEPTION(scope, {});
    auto& comments = host->tokens.comments;
    uint32_t index = lowerBound(comments.starts, start);
    // ESLint doesn't look at `right` if no comment is left.
    if (index >= comments.count())
        return JSValue::encode(jsBoolean(false));
    range = rangeOf(globalObject, host, callFrame->argument(1), "right"_s);
    RETURN_IF_EXCEPTION(scope, {});
    double end = numberIn(globalObject, range, 0, "right"_s);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsBoolean(index < comments.count() && comments.ends[index] <= end));
}

JSC_DEFINE_HOST_FUNCTION(jsLintGetCommentsBefore, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    LintHost* host = LintHost::from(globalObject);
    Locations locations;
    readLocations<Where::Before>(globalObject, host, callFrame, locations, "nodeOrToken"_s);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, adjacentComments(globalObject, host, false, locations));
}

JSC_DEFINE_HOST_FUNCTION(jsLintGetCommentsAfter, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    LintHost* host = LintHost::from(globalObject);
    Locations locations;
    readLocations<Where::After>(globalObject, host, callFrame, locations, "nodeOrToken"_s);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, adjacentComments(globalObject, host, true, locations));
}

JSC_DEFINE_HOST_FUNCTION(jsLintGetCommentsInside, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    LintHost* host = LintHost::from(globalObject);
    Locations locations;
    readLocations<Where::Inside>(globalObject, host, callFrame, locations);
    RETURN_IF_EXCEPTION(scope, {});
    Options options;
    options.includeComments = true;
    options.number = -1;
    RELEASE_AND_RETURN(scope, someTokens(globalObject, host, true, locations, options, true));
}

JSC_DEFINE_HOST_FUNCTION(jsLintIsSpaceBetween, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return isSpaceBetween(globalObject, callFrame, callFrame->argument(2).toBoolean(globalObject));
}

JSC_DEFINE_HOST_FUNCTION(jsLintIsSpaceBetweenTokens, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return isSpaceBetween(globalObject, callFrame, true);
}

// `tokens()` is `ast.tokens`.
JSC_DEFINE_HOST_FUNCTION(jsLintTokens, (JSGlobalObject * globalObject, CallFrame*))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    LintHost* host = LintHost::from(globalObject);
    loadTokens(globalObject, host);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, allOf(globalObject, host, host->tokens.tokens));
}

// `comments()` is `ast.comments`.
JSC_DEFINE_HOST_FUNCTION(jsLintComments, (JSGlobalObject * globalObject, CallFrame*))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    LintHost* host = LintHost::from(globalObject);
    loadComments(globalObject, host);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, allOf(globalObject, host, host->tokens.comments));
}

// `tokensAndComments()` is `sourceCode.tokensAndComments`.
JSC_DEFINE_HOST_FUNCTION(jsLintTokensAndComments, (JSGlobalObject * globalObject, CallFrame*))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    LintHost* host = LintHost::from(globalObject);
    if (JSArray* all = host->tokens.tokensAndComments.get())
        return JSValue::encode(all);
    Options options;
    options.includeComments = true;
    options.number = -1;
    JSValue all = JSValue::decode(someTokens(globalObject, host, true, {}, options));
    RETURN_IF_EXCEPTION(scope, {});
    host->tokens.tokensAndComments.set(vm, host, asArray(all));
    return JSValue::encode(all);
}

// ───────────── the class ─────────────

namespace {

JSC_DECLARE_HOST_FUNCTION(callTokenStore);
JSC_DECLARE_HOST_FUNCTION(constructTokenStore);

// `class TokenStore`. `SourceCode` extends it.
class LintTokenStoreConstructor final : public InternalFunction {
public:
    using Base = InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    DECLARE_INFO;

    static LintTokenStoreConstructor* create(VM& vm, JSGlobalObject* globalObject, JSObject* prototype)
    {
        Structure* structure = Structure::create(vm, globalObject, globalObject->functionPrototype(), TypeInfo(InternalFunctionType, StructureFlags), info());
        auto* constructor = new (NotNull, allocateCell<LintTokenStoreConstructor>(vm)) LintTokenStoreConstructor(vm, structure);
        constructor->finishCreation(vm, 2, "TokenStore"_s, PropertyAdditionMode::WithoutStructureTransition);
        constructor->putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
        return constructor;
    }

private:
    LintTokenStoreConstructor(VM& vm, Structure* structure)
        : Base(vm, structure, callTokenStore, constructTokenStore)
    {
    }
};

const ClassInfo LintTokenStoreConstructor::s_info = { "Function"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(LintTokenStoreConstructor) };

JSC_DEFINE_HOST_FUNCTION(callTokenStore, (JSGlobalObject * globalObject, CallFrame*))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    return throwVMTypeError(globalObject, scope, "Cannot call a class constructor TokenStore without |new|"_s);
}

JSC_DEFINE_HOST_FUNCTION(constructTokenStore, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    LintTokenState& state = LintHost::from(globalObject)->tokens;
    Structure* structure = state.instanceStructure.get();
    JSObject* newTarget = asObject(callFrame->newTarget());
    if (newTarget != state.constructor.get()) {
        structure = InternalFunction::createSubclassStructure(globalObject, newTarget, structure);
        RETURN_IF_EXCEPTION(scope, {});
    }
    return JSValue::encode(constructEmptyObject(vm, structure));
}

struct Method {
    ASCIILiteral name;
    unsigned length;
    NativeFunction function;
};

// In the order of ESLint's class, then what ESLint has elsewhere or doesn't have any more.
const Method methods[] = {
    { "getTokenByRangeStart"_s, 2, jsLintGetTokenByRangeStart },
    { "getFirstToken"_s, 2, jsLintGetFirstToken },
    { "getLastToken"_s, 2, jsLintGetLastToken },
    { "getTokenBefore"_s, 2, jsLintGetTokenBefore },
    { "getTokenAfter"_s, 2, jsLintGetTokenAfter },
    { "getFirstTokenBetween"_s, 3, jsLintGetFirstTokenBetween },
    { "getLastTokenBetween"_s, 3, jsLintGetLastTokenBetween },
    { "getFirstTokens"_s, 2, jsLintGetFirstTokens },
    { "getLastTokens"_s, 2, jsLintGetLastTokens },
    { "getTokensBefore"_s, 2, jsLintGetTokensBefore },
    { "getTokensAfter"_s, 2, jsLintGetTokensAfter },
    { "getFirstTokensBetween"_s, 3, jsLintGetFirstTokensBetween },
    { "getLastTokensBetween"_s, 3, jsLintGetLastTokensBetween },
    { "getTokens"_s, 3, jsLintGetTokens },
    { "getTokensBetween"_s, 3, jsLintGetTokensBetween },
    { "commentsExistBetween"_s, 2, jsLintCommentsExistBetween },
    { "getCommentsBefore"_s, 1, jsLintGetCommentsBefore },
    { "getCommentsAfter"_s, 1, jsLintGetCommentsAfter },
    { "getCommentsInside"_s, 1, jsLintGetCommentsInside },
    { "getTokenOrCommentBefore"_s, 2, jsLintGetTokenOrCommentBefore },
    { "getTokenOrCommentAfter"_s, 2, jsLintGetTokenOrCommentAfter },
    { "isSpaceBetween"_s, 2, jsLintIsSpaceBetween },
    { "isSpaceBetweenTokens"_s, 2, jsLintIsSpaceBetweenTokens },
};

constexpr ASCIILiteral tokenTypeNames[lintTokenKindCount] = {
    "Boolean"_s,
    "Identifier"_s,
    "JSXIdentifier"_s,
    "JSXText"_s,
    "Keyword"_s,
    "Null"_s,
    "Numeric"_s,
    "PrivateIdentifier"_s,
    "Punctuator"_s,
    "RegularExpression"_s,
    "String"_s,
    "Template"_s,
    "Line"_s,
    "Block"_s,
    "Shebang"_s,
};

} // namespace

void LintTokenState::finishCreation(VM& vm, JSGlobalObject* globalObject, LintHost* host)
{
    rangeName = Identifier::fromString(vm, "range"_s);
    includeCommentsName = Identifier::fromString(vm, "includeComments"_s);
    skipName = Identifier::fromString(vm, "skip"_s);
    countName = Identifier::fromString(vm, "count"_s);
    filterName = Identifier::fromString(vm, "filter"_s);
    // Rules compare them with literals, which are atoms too.
    for (size_t i = 0; i < lintTokenKindCount; ++i)
        typeNames[i].set(vm, host, jsNontrivialString(vm, Identifier::fromString(vm, tokenTypeNames[i]).string()));
    regexStructure.set(vm, host, LintHost::createShape(vm, globalObject, globalObject->objectPrototype(), std::to_array<ASCIILiteral>({ "pattern"_s, "flags"_s })));

    JSObject* prototype = constructEmptyObject(globalObject);
    auto* store = LintTokenStoreConstructor::create(vm, globalObject, prototype);
    prototype->putDirect(vm, vm.propertyNames->constructor, store, static_cast<unsigned>(PropertyAttribute::DontEnum));
    for (auto& method : methods)
        prototype->putDirect(vm, Identifier::fromString(vm, method.name), JSFunction::create(vm, globalObject, method.length, method.name, method.function, ImplementationVisibility::Public), static_cast<unsigned>(PropertyAttribute::DontEnum));
    constructor.set(vm, host, store);
    instanceStructure.set(vm, host, globalObject->structureCache().emptyObjectStructureForPrototype(globalObject, prototype, JSFinalObject::defaultInlineCapacity));
}

void LintTokenState::reset()
{
    for (auto* list : { &tokens, &comments }) {
        list->isLoaded = false;
        list->starts = {};
        list->ends = {};
        list->kinds = {};
        list->objects.clear();
        list->all.clear();
    }
    tokenMessage.clear();
    commentMessage.clear();
    decodedValues.clear();
    tokensAndComments.clear();
}

// `tokenStore(prototype)` returns the class. `prototype` is what the tokens and comments inherit from.
JSC_DEFINE_HOST_FUNCTION(jsLintTokenStore, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* prototype = callFrame->argument(0).getObject();
    if (!prototype)
        return throwVMTypeError(globalObject, scope, "Expected a prototype"_s);
    LintHost* host = LintHost::from(globalObject);
    host->tokens.tokenStructure.set(vm, host, LintHost::createShape(vm, globalObject, prototype, std::to_array<ASCIILiteral>({ "type"_s, "value"_s, "start"_s, "end"_s, "range"_s })));
    host->tokens.regexTokenStructure.set(vm, host, LintHost::createShape(vm, globalObject, prototype, std::to_array<ASCIILiteral>({ "type"_s, "value"_s, "start"_s, "end"_s, "range"_s, "regex"_s })));
    return JSValue::encode(host->tokens.constructor.get());
}

void addLintTokenFunctions(JSGlobalObject* globalObject, JSObject* native)
{
    VM& vm = globalObject->vm();
    native->putDirect(vm, Identifier::fromString(vm, "tokenStore"_s), JSFunction::create(vm, globalObject, 1, "tokenStore"_s, jsLintTokenStore, ImplementationVisibility::Public));
    native->putDirect(vm, Identifier::fromString(vm, "tokens"_s), JSFunction::create(vm, globalObject, 0, "tokens"_s, jsLintTokens, ImplementationVisibility::Public));
    native->putDirect(vm, Identifier::fromString(vm, "comments"_s), JSFunction::create(vm, globalObject, 0, "comments"_s, jsLintComments, ImplementationVisibility::Public));
    native->putDirect(vm, Identifier::fromString(vm, "tokensAndComments"_s), JSFunction::create(vm, globalObject, 0, "tokensAndComments"_s, jsLintTokensAndComments, ImplementationVisibility::Public));
}

} // namespace Bun
