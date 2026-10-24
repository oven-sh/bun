// ESLint's `TokenStore`: the token and comment methods of `sourceCode`.
//
// Rust says where the tokens and comments of the file are (src/lint/js_plugin/tokens.rs). A method searches these tables, and
// an object is made for a token the first time a plugin gets it.
//
// Ported from lib/languages/js/source-code/token-store in ESLint, which is under the MIT License. See LICENSE.md.

#include "LintTokens.h"

#include "LintHost.h"
#include <JavaScriptCore/ArgList.h>
#include <JavaScriptCore/CallData.h>
#include <JavaScriptCore/CustomGetterSetter.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/GetterSetter.h>
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

// Points the lists at the answer, which is Rust's and stays until `endFile`. Returns false if it's cut short.
bool readAnswer(LintHost* host, uint32_t kind, LintSpan answer)
{
    LintTokenState& state = host->tokens;
    Locker locker { host->cellLock() };
    std::span message { reinterpret_cast<const uint32_t*>(answer.ptr), answer.len / 4 };
    size_t at = 0;
    if (kind == askForComments)
        return readList(message, at, &state.comments);
    // The comments may be there already, and plugins may have objects for them.
    return readList(message, at, &state.tokens)
        && readList(message, at, state.comments.isLoaded ? nullptr : &state.comments)
        && readDecodedValues(message, at, state);
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

// Its properties are empty until they're put there by their offsets.
JSFinalObject* createObject(VM& vm, Structure* structure)
{
    return JSFinalObject::create(vm, structure);
}

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
    bool isComment = &list == &state.comments;
    LintTokenShape::Kind shapeKind;
    if (host->isOxlint())
        shapeKind = isComment ? LintTokenShape::OxlintComment : LintTokenShape::OxlintToken;
    else if (!host->isEspree())
        shapeKind = isRegex ? LintTokenShape::TypeScriptRegex : LintTokenShape::TypeScriptToken;
    else if (isComment)
        shapeKind = LintTokenShape::EspreeComment;
    else
        shapeKind = isRegex ? LintTokenShape::EspreeRegex : kind == LintTokenKind::Template ? LintTokenShape::EspreeTemplate
                                                                                            : LintTokenShape::EspreeToken;
    const LintTokenShape& shape = state.shapes[shapeKind];

    JSFinalObject* token = createObject(vm, shape.structure.get());
    token->putDirectOffset(vm, shape.typeOffset, state.typeNames[kindByte].get());
    token->putDirectOffset(vm, shape.locOffset, shape.loc.get());
    if (shape.startOffset != invalidOffset) {
        token->putDirectOffset(vm, shape.startOffset, jsNumber(start));
        token->putDirectOffset(vm, shape.endOffset, jsNumber(end));
    }

    const String* decoded = !isComment && !state.decodedValues.isEmpty() ? decodedValue(state, index) : nullptr;
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
    token->putDirectOffset(vm, shape.valueOffset, value);

    JSArray* range = createRange(globalObject, start, end);
    if (!range) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return nullptr;
    }
    token->putDirectOffset(vm, shape.rangeOffset, range);

    if (isRegex) {
        uint32_t slash = std::min(end, host->textString().length());
        while (slash > start + 1 && host->textString().codeUnitAt(slash - 1) != '/')
            --slash;
        bool isPatternFirst = host->isOxlint();
        JSFinalObject* regex = createObject(vm, (isPatternFirst ? state.oxlintRegexStructure : state.regexStructure).get());
        token->putDirectOffset(vm, shape.regexOffset, regex);
        regex->putDirectOffset(vm, isPatternFirst ? 0 : 1, slice(vm, host, start + 1, slash - 1));
        regex->putDirectOffset(vm, isPatternFirst ? 1 : 0, slice(vm, host, slash, end));
    } else if (shape.regexOffset != invalidOffset)
        token->putDirectOffset(vm, shape.regexOffset, jsUndefined());
    if (shape.cachedLocOffset != invalidOffset)
        token->putDirectOffset(vm, shape.cachedLocOffset, jsUndefined());
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
uint32_t lowerBound(std::span<const uint32_t> numbers, uint32_t number)
{
    return static_cast<uint32_t>(std::lower_bound(numbers.begin(), numbers.end(), number) - numbers.begin());
}

uint32_t lowerBound(std::span<const uint32_t> numbers, double number)
{
    // Also if it's NaN.
    if (!(number > 0))
        return 0;
    if (number > std::numeric_limits<uint32_t>::max())
        return static_cast<uint32_t>(numbers.size());
    return lowerBound(numbers, static_cast<uint32_t>(std::ceil(number)));
}

// ESLint's `search`: the index of the first of `list` that starts at `location` or later.
uint32_t search(const LintTokenList& list, double location)
{
    return std::isnan(location) ? list.count() : lowerBound(list.starts, location);
}

// ESLint's `indexMap[location]`. The map has the first and the last character of each token, with the index of the token, and
// those of each comment, with the index of the token after it. All other places aren't in it.
std::optional<uint32_t> indexAt(const LintTokenState& state, double location)
{
    if (!(location >= 0 && location <= std::numeric_limits<uint32_t>::max()) || location != std::floor(location))
        return std::nullopt;
    auto at = static_cast<uint32_t>(location);
    auto& tokens = state.tokens;
    uint32_t index = lowerBound(tokens.starts, at);
    if (index < tokens.count() && tokens.starts[index] == at)
        return index;
    if (index && tokens.ends[index - 1] - 1 == at)
        return index - 1;
    auto& comments = state.comments;
    uint32_t comment = lowerBound(comments.starts, at);
    if ((comment < comments.count() && comments.starts[comment] == at) || (comment && comments.ends[comment - 1] - 1 == at))
        return index;
    return std::nullopt;
}

// The index of the first token that starts at `location` or later. -1 is the start of the file.
// This is ESLint's `getFirstIndex`, which only finds it if a token or a comment starts or ends at `location`. oxlint always does.
int64_t firstIndex(const LintTokenState& state, double location)
{
    auto& tokens = state.tokens;
    if (location == -1)
        return 0;
    if (state.searchesEverywhere)
        return lowerBound(tokens.starts, location);
    if (auto index = indexAt(state, location))
        return *index;
    if (auto index = indexAt(state, location - 1)) {
        if (*index >= tokens.count())
            return tokens.count();
        return tokens.starts[*index] >= location ? *index : *index + 1;
    }
    return location == 0 ? 0 : tokens.count();
}

// The index of the last token that ends at `location` or before. -1 is the end of the file. ESLint's `getLastIndex`.
int64_t lastIndex(const LintTokenState& state, double location)
{
    auto& tokens = state.tokens;
    if (location == -1)
        return int64_t(tokens.count()) - 1;
    if (state.searchesEverywhere)
        return int64_t(lowerBound(tokens.ends, location + 1)) - 1;
    if (auto index = indexAt(state, location))
        return int64_t(*index) - 1;
    if (auto index = indexAt(state, location - 1)) {
        if (*index >= tokens.count())
            return int64_t(tokens.count()) - 1;
        return tokens.ends[*index] > location ? int64_t(*index) - 1 : *index;
    }
    return location == 0 ? -1 : int64_t(tokens.count()) - 1;
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
        m_token = isForward ? firstIndex(state, span.start) : lastIndex(state, span.end);
        if (!includeComments)
            m_last = isForward ? lastIndex(state, span.end) : firstIndex(state, span.start);
        else
            m_comment = isForward ? search(state.comments, span.start) : int64_t(search(state.comments, span.end)) - 1;
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

// `value[name]`, in one place because it's a lot of code inline.
NEVER_INLINE JSValue getProperty(JSGlobalObject* globalObject, JSValue value, PropertyName name)
{
    return value.get(globalObject, name);
}

NEVER_INLINE void throwNotAnObject(JSGlobalObject* globalObject, ThrowScope& scope, JSValue value, ASCIILiteral parameter, ASCIILiteral rest)
{
    throwTypeError(globalObject, scope, makeString(value.isNull() ? "null"_s : "undefined"_s, " is not an object (evaluating '"_s, parameter, rest, "')"_s));
}

// `target.range`. `parameter` is what ESLint calls `target`.
JSValue rangeOf(JSGlobalObject* globalObject, LintHost* host, JSValue target, ASCIILiteral parameter)
{
    LintPropertyCache& range = host->sourceCode.range;
    if (JSValue value = range.getOwnData(globalObject->vm(), host, target)) [[likely]]
        return value;
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    if (target.isUndefinedOrNull()) {
        throwNotAnObject(globalObject, scope, target, parameter, ".range"_s);
        return {};
    }
    RELEASE_AND_RETURN(scope, getProperty(globalObject, target, range.name()));
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
NEVER_INLINE double numberIn(JSGlobalObject* globalObject, JSValue range, unsigned index, ASCIILiteral parameter)
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

NEVER_INLINE Span toSpanSlow(JSGlobalObject* globalObject, Locations locations)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    Span span;
    span.start = locations.start.toNumber(globalObject);
    RETURN_IF_EXCEPTION(scope, span);
    span.end = locations.end.toNumber(globalObject);
    RETURN_IF_EXCEPTION(scope, span);
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

// `first` and `second` are the first two arguments of the method. Only `Between` looks at `second`.
void readLocations(JSGlobalObject* globalObject, LintHost* host, JSValue first, JSValue second, Where where, Locations& locations, ASCIILiteral parameter = "node"_s)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (where == Where::Between)
        parameter = "left"_s;
    JSValue range = rangeOf(globalObject, host, first, parameter);
    RETURN_IF_EXCEPTION(scope, void());
    if (where == Where::Inside || where == Where::Before) {
        (where == Where::Inside ? locations.start : locations.end) = elementOf(globalObject, range, 0, parameter);
        RETURN_IF_EXCEPTION(scope, void());
        if (where == Where::Before)
            return;
        RELEASE_AND_RETURN(scope, void(locations.end = elementOf(globalObject, range, 1, parameter)));
    }
    locations.start = elementOf(globalObject, range, 1, parameter);
    RETURN_IF_EXCEPTION(scope, void());
    if (where == Where::After)
        return;
    range = rangeOf(globalObject, host, second, "right"_s);
    RETURN_IF_EXCEPTION(scope, void());
    RELEASE_AND_RETURN(scope, void(locations.end = elementOf(globalObject, range, 0, "right"_s)));
}

JSValue optionsOf(CallFrame* callFrame, Where where)
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

NEVER_INLINE void throwError(JSGlobalObject* globalObject, ThrowScope& scope, ASCIILiteral message)
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
    JSValue includeComments = getProperty(globalObject, value, host->tokens.includeCommentsName);
    RETURN_IF_EXCEPTION(scope, {});
    options.includeComments = includeComments.toBoolean(globalObject);
    JSValue number = getProperty(globalObject, value, key);
    RETURN_IF_EXCEPTION(scope, {});
    options.number = number.toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue filter = getProperty(globalObject, value, host->tokens.filterName);
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
        isValid = options.number >= 0;
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

// ───────────── `loc` ─────────────

} // namespace

JSObject* lintCreateLoc(VM& vm, LintHost* host, LintLocShape::Kind kind, double start, double end)
{
    const LintLocShape& shape = host->tokens.locShapes[kind];
    JSFinalObject* loc = createObject(vm, shape.structure.get());
    for (unsigned i = 0; i < 2; ++i) {
        auto [line, column] = host->positionOf(i ? end : start);
        JSFinalObject* position = createObject(vm, shape.positionStructure.get());
        position->putDirectOffset(vm, shape.isReversed ? 1 : 0, jsNumber(line));
        position->putDirectOffset(vm, shape.isReversed ? 0 : 1, jsNumber(column));
        loc->putDirectOffset(vm, shape.isReversed ? 1 - i : i, position);
    }
    return loc;
}

namespace {

// From the `range` of `token`, and the lines of the current file. So it's wrong for a token of an earlier file.
JSObject* locOf(JSGlobalObject* globalObject, LintHost* host, JSObject* token, LintLocShape::Kind kind)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue range = rangeOf(globalObject, host, token, "token"_s);
    RETURN_IF_EXCEPTION(scope, nullptr);
    double start = numberIn(globalObject, range, 0, "token"_s);
    RETURN_IF_EXCEPTION(scope, nullptr);
    double end = numberIn(globalObject, range, 1, "token"_s);
    RETURN_IF_EXCEPTION(scope, nullptr);
    return lintCreateLoc(vm, host, kind, start, end);
}

} // namespace

void lintReplaceCustomValue(VM& vm, LintHost* host, JSObject* object, PropertyName name, JSValue value)
{
    Structure* before = object->structure();
    auto& known = host->tokens.replacements[(before->id().bits() >> 4) % host->tokens.replacements.size()];
    if (known.before.get() == before && known.name == name.uid()) [[likely]] {
        object->setStructure(vm, known.after.get());
        object->putDirectOffset(vm, known.offset, value);
        return;
    }
    unsigned attributes;
    PropertyOffset offset = object->getDirectOffset(vm, name, attributes);
    if (offset == invalidOffset || !(attributes & PropertyAttribute::CustomValue))
        return;
    object->putDirect(vm, name, value, attributes & ~PropertyAttribute::CustomValue);
    Structure* after = object->structure();
    // Only what the next object with that Structure can do in the same way.
    if (before->isDictionary() || after->isDictionary() || after->get(vm, name) != offset)
        return;
    known.before.set(vm, host, before);
    known.after.set(vm, host, after);
    known.name = name.uid();
    known.offset = offset;
}

namespace {

// To a plugin `loc` is a plain data property, as with ESLint. It's computed when it's first read.
EncodedJSValue computeLoc(EncodedJSValue thisValue, PropertyName name, LintLocShape::Kind kind)
{
    JSGlobalObject* globalObject = LintHost::realmOfHolder(thisValue);
    if (!globalObject) [[unlikely]]
        return JSValue::encode(jsUndefined());
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* token = asObject(JSValue::decode(thisValue));
    LintHost* host = LintHost::from(globalObject);
    JSObject* loc = locOf(globalObject, host, token, kind);
    RETURN_IF_EXCEPTION(scope, {});
    lintReplaceCustomValue(vm, host, token, name, loc);
    return JSValue::encode(loc);
}

JSC_DEFINE_CUSTOM_GETTER(lintEspreeTokenLoc, (JSGlobalObject*, EncodedJSValue thisValue, PropertyName name))
{
    return computeLoc(thisValue, name, LintLocShape::EspreeToken);
}

JSC_DEFINE_CUSTOM_GETTER(lintEspreeOtherLoc, (JSGlobalObject*, EncodedJSValue thisValue, PropertyName name))
{
    return computeLoc(thisValue, name, LintLocShape::EspreeOther);
}

JSC_DEFINE_CUSTOM_GETTER(lintTypeScriptLoc, (JSGlobalObject*, EncodedJSValue thisValue, PropertyName name))
{
    return computeLoc(thisValue, name, LintLocShape::TypeScript);
}

// oxlint's `get loc()`, which returns the same object each time.
JSC_DEFINE_HOST_FUNCTION(jsLintOxlintLoc, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    LintHost* host = LintHost::from(globalObject);
    auto* token = dynamicDowncast<JSFinalObject>(callFrame->thisValue());
    if (!token)
        return throwVMTypeError(globalObject, scope, "Expected a token or a comment"_s);
    JSValue cached = token->getDirect(vm, host->tokens.cachedLocName);
    if (cached && cached.isObject())
        return JSValue::encode(cached);
    JSObject* loc = locOf(globalObject, host, token, LintLocShape::Oxlint);
    RETURN_IF_EXCEPTION(scope, {});
    token->putDirect(vm, host->tokens.cachedLocName, loc, static_cast<unsigned>(PropertyAttribute::DontEnum));
    return JSValue::encode(loc);
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
    int64_t from = std::max<int64_t>(0, firstIndex(host->tokens, span.start) - beforeCount);
    int64_t to = std::min<int64_t>(int64_t(tokens.count()) - 1, lastIndex(host->tokens, span.end) + afterCount) + 1;
    // ESLint ends with `tokens.slice(from, to)`, which counts a negative `to` from the end.
    if (to < 0)
        to += tokens.count();
    RELEASE_AND_RETURN(scope, JSValue::encode(createArray(globalObject, host, tokens, from, to)));
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

EncodedJSValue oneTokenMethod(JSGlobalObject* globalObject, CallFrame* callFrame, Where where, bool isForward)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    LintHost* host = LintHost::from(globalObject);
    Locations locations;
    readLocations(globalObject, host, callFrame->argument(0), callFrame->argument(1), where, locations);
    RETURN_IF_EXCEPTION(scope, {});
    Options options;
    readSkipOptions(globalObject, host, optionsOf(callFrame, where), options);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, oneToken(globalObject, host, isForward, locations, options));
}

EncodedJSValue someTokensMethod(JSGlobalObject* globalObject, CallFrame* callFrame, Where where, bool isForward)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    LintHost* host = LintHost::from(globalObject);
    Locations locations;
    readLocations(globalObject, host, callFrame->argument(0), callFrame->argument(1), where, locations);
    RETURN_IF_EXCEPTION(scope, {});
    Options options;
    readCountOptions(globalObject, host, optionsOf(callFrame, where), options);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, someTokens(globalObject, host, isForward, locations, options));
}

// Until ESLint 8: `getTokenBefore(node, { includeComments: true, skip })`, and the same with `getTokenAfter`.
EncodedJSValue tokenOrCommentMethod(JSGlobalObject* globalObject, CallFrame* callFrame, Where where, bool isForward)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    LintHost* host = LintHost::from(globalObject);
    Locations locations;
    readLocations(globalObject, host, callFrame->argument(0), callFrame->argument(1), where, locations);
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
            throwNotAnObject(globalObject, scope, jsNull(), "nextToken"_s, ".range"_s);
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
    // oxlint has one frozen array for every file without comments.
    if (host->isOxlint() && &list == &host->tokens.comments && !list.count()) {
        objectConstructorFreeze(globalObject, all);
        RETURN_IF_EXCEPTION(scope, {});
    }
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
        JSValue value = getProperty(globalObject, options, host->tokens.includeCommentsName);
        RETURN_IF_EXCEPTION(scope, {});
        includeComments = value.toBoolean(globalObject);
    }
    loadTokens(globalObject, host);
    RETURN_IF_EXCEPTION(scope, {});
    // Nothing but a number is equal to where a token starts. ESLint still computes with it.
    if (!offset.isNumber()) {
        offset.toNumber(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        return JSValue::encode(jsNull());
    }
    TokenRef ref;
    if (!Cursor(host->tokens, true, { offset.asNumber(), -1 }, includeComments).next(ref))
        return JSValue::encode(jsNull());
    if (listOf(host->tokens, ref).starts[ref.index] != offset.asNumber())
        return JSValue::encode(jsNull());
    RELEASE_AND_RETURN(scope, JSValue::encode(tokenAt(globalObject, host, ref)));
}

#define LINT_TOKEN_METHOD(name, implementation, where, isForward)                          \
    JSC_DEFINE_HOST_FUNCTION(name, (JSGlobalObject * globalObject, CallFrame * callFrame)) \
    {                                                                                      \
        return implementation(globalObject, callFrame, Where::where, isForward);           \
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
    readLocations(globalObject, host, callFrame->argument(0), callFrame->argument(1), Where::Inside, locations);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, paddedTokens(globalObject, host, locations, callFrame->argument(1), callFrame->argument(2)));
}

JSC_DEFINE_HOST_FUNCTION(jsLintGetTokensBetween, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    LintHost* host = LintHost::from(globalObject);
    Locations locations;
    readLocations(globalObject, host, callFrame->argument(0), callFrame->argument(1), Where::Between, locations);
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
    uint32_t index = search(comments, start);
    // ESLint doesn't look at `right` if no comment is left.
    if (index >= comments.count())
        return JSValue::encode(jsBoolean(false));
    range = rangeOf(globalObject, host, callFrame->argument(1), "right"_s);
    RETURN_IF_EXCEPTION(scope, {});
    double end = numberIn(globalObject, range, 0, "right"_s);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsBoolean(index < comments.count() && comments.ends[index] <= end));
}

EncodedJSValue lintTokenOrCommentNextTo(JSGlobalObject* globalObject, JSValue nodeOrToken, bool isAfter)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    LintHost* host = LintHost::from(globalObject);
    Locations locations;
    readLocations(globalObject, host, nodeOrToken, {}, isAfter ? Where::After : Where::Before, locations);
    RETURN_IF_EXCEPTION(scope, {});
    Options options;
    options.includeComments = true;
    RELEASE_AND_RETURN(scope, oneToken(globalObject, host, isAfter, locations, options));
}

EncodedJSValue lintCommentsNextTo(JSGlobalObject* globalObject, JSValue nodeOrToken, bool isAfter)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    LintHost* host = LintHost::from(globalObject);
    Locations locations;
    readLocations(globalObject, host, nodeOrToken, {}, isAfter ? Where::After : Where::Before, locations, "nodeOrToken"_s);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, adjacentComments(globalObject, host, isAfter, locations));
}

EncodedJSValue lintCommentsInside(JSGlobalObject* globalObject, JSValue node)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    LintHost* host = LintHost::from(globalObject);
    Locations locations;
    readLocations(globalObject, host, node, {}, Where::Inside, locations);
    RETURN_IF_EXCEPTION(scope, {});
    Options options;
    options.includeComments = true;
    options.number = -1;
    RELEASE_AND_RETURN(scope, someTokens(globalObject, host, true, locations, options, true));
}

JSC_DEFINE_HOST_FUNCTION(jsLintGetCommentsBefore, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return lintCommentsNextTo(globalObject, callFrame->argument(0), false);
}

JSC_DEFINE_HOST_FUNCTION(jsLintGetCommentsAfter, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return lintCommentsNextTo(globalObject, callFrame->argument(0), true);
}

JSC_DEFINE_HOST_FUNCTION(jsLintGetCommentsInside, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return lintCommentsInside(globalObject, callFrame->argument(0));
}

JSC_DEFINE_HOST_FUNCTION(jsLintIsSpaceBetween, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return isSpaceBetween(globalObject, callFrame, false);
}

JSC_DEFINE_HOST_FUNCTION(jsLintIsSpaceBetweenTokens, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return isSpaceBetween(globalObject, callFrame, true);
}

namespace {

// `ast.tokens` or `ast.comments`
EncodedJSValue listOfProgram(JSGlobalObject* globalObject, bool isComments)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    LintHost* host = LintHost::from(globalObject);
    if (isComments)
        loadComments(globalObject, host);
    else
        loadTokens(globalObject, host);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, allOf(globalObject, host, isComments ? host->tokens.comments : host->tokens.tokens));
}

// With ESLint the two are plain data properties. Like `loc` they're computed when they're first read.
EncodedJSValue computeListOfProgram(EncodedJSValue thisValue, PropertyName name, bool isComments)
{
    JSGlobalObject* globalObject = LintHost::realmOfHolder(thisValue);
    if (!globalObject) [[unlikely]]
        return JSValue::encode(jsUndefined());
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    EncodedJSValue list = listOfProgram(globalObject, isComments);
    RETURN_IF_EXCEPTION(scope, {});
    lintReplaceCustomValue(vm, LintHost::from(globalObject), asObject(JSValue::decode(thisValue)), name, JSValue::decode(list));
    return list;
}

JSC_DEFINE_CUSTOM_GETTER(lintProgramTokens, (JSGlobalObject*, EncodedJSValue thisValue, PropertyName name))
{
    return computeListOfProgram(thisValue, name, false);
}

JSC_DEFINE_CUSTOM_GETTER(lintProgramComments, (JSGlobalObject*, EncodedJSValue thisValue, PropertyName name))
{
    return computeListOfProgram(thisValue, name, true);
}

} // namespace

EncodedJSValue lintComments(JSGlobalObject* globalObject)
{
    return listOfProgram(globalObject, true);
}

// oxlint's `get tokens()`
JSC_DEFINE_HOST_FUNCTION(jsLintTokens, (JSGlobalObject * globalObject, CallFrame*))
{
    return listOfProgram(globalObject, false);
}

// oxlint's `get comments()`
JSC_DEFINE_HOST_FUNCTION(jsLintComments, (JSGlobalObject * globalObject, CallFrame*))
{
    return listOfProgram(globalObject, true);
}

EncodedJSValue lintTokensAndComments(JSGlobalObject* globalObject)
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

// As in ESLint's class.
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

namespace {

JSC_DEFINE_HOST_FUNCTION(illegalConstructor, (JSGlobalObject * globalObject, CallFrame*))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    return throwVMTypeError(globalObject, scope, "Illegal constructor"_s);
}

// acorn's `new Position(line, col)`
JSC_DEFINE_HOST_FUNCTION(constructPosition, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    JSFinalObject* position = createObject(vm, LintHost::from(globalObject)->tokens.locShapes[LintLocShape::EspreeToken].positionStructure.get());
    position->putDirectOffset(vm, 0, callFrame->argument(0));
    position->putDirectOffset(vm, 1, callFrame->argument(1));
    return JSValue::encode(position);
}

// acorn's `position.offset(n)`
JSC_DEFINE_HOST_FUNCTION(positionOffset, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue line = getProperty(globalObject, callFrame->thisValue(), vm.propertyNames->line);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue column = getProperty(globalObject, callFrame->thisValue(), vm.propertyNames->column);
    RETURN_IF_EXCEPTION(scope, {});
    double sum = column.toNumber(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    sum += callFrame->argument(0).toNumber(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    JSFinalObject* position = createObject(vm, LintHost::from(globalObject)->tokens.locShapes[LintLocShape::EspreeToken].positionStructure.get());
    position->putDirectOffset(vm, 0, line);
    position->putDirectOffset(vm, 1, jsNumber(sum));
    return JSValue::encode(position);
}

NEVER_INLINE JSFunction* createFunction(JSGlobalObject* globalObject, ASCIILiteral name, unsigned length, NativeFunction function)
{
    return JSFunction::create(globalObject->vm(), globalObject, length, name, function, ImplementationVisibility::Public);
}

NEVER_INLINE void putFunction(JSGlobalObject* globalObject, JSObject* object, ASCIILiteral name, unsigned length, NativeFunction function, unsigned attributes = 0)
{
    VM& vm = globalObject->vm();
    object->putDirect(vm, Identifier::fromString(vm, name), createFunction(globalObject, name, length, function), attributes);
}

NEVER_INLINE GetterSetter* createGetter(JSGlobalObject* globalObject, ASCIILiteral name, NativeFunction function)
{
    return GetterSetter::create(globalObject->vm(), globalObject, createFunction(globalObject, name, 0, function), nullptr);
}

// What's in a property that looks like a plain data property and is computed by `compute` when it's first read.
NEVER_INLINE CustomGetterSetter* createLazyValue(VM& vm, GetValueFunc compute)
{
    return CustomGetterSetter::create(vm, compute, nullptr);
}

// A class of a parser, for `constructor.name` and `instanceof`. Returns its prototype.
NEVER_INLINE JSObject* createClass(VM& vm, JSGlobalObject* globalObject, ASCIILiteral name, unsigned length, NativeFunction construct = illegalConstructor)
{
    JSObject* prototype = constructEmptyObject(globalObject);
    JSFunction* constructor = JSFunction::create(vm, globalObject, length, name, illegalConstructor, ImplementationVisibility::Public, NoIntrinsic, construct);
    constructor->putDirect(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete);
    prototype->putDirect(vm, vm.propertyNames->constructor, constructor, static_cast<unsigned>(PropertyAttribute::DontEnum));
    return prototype;
}

struct Key {
    ASCIILiteral name;
    PropertyOffset LintTokenShape::* offset;
};
constexpr Key typeKey { "type"_s, &LintTokenShape::typeOffset };
constexpr Key valueKey { "value"_s, &LintTokenShape::valueOffset };
constexpr Key startKey { "start"_s, &LintTokenShape::startOffset };
constexpr Key endKey { "end"_s, &LintTokenShape::endOffset };
constexpr Key locKey { "loc"_s, &LintTokenShape::locOffset };
constexpr Key rangeKey { "range"_s, &LintTokenShape::rangeOffset };
constexpr Key regexKey { "regex"_s, &LintTokenShape::regexOffset };

// Makes an object with `keys` the way a plugin could, and takes its Structure.
NEVER_INLINE void initializeShape(VM& vm, JSGlobalObject* globalObject, LintHost* host, LintTokenShape::Kind kind, JSObject* prototype, JSCell* loc, std::initializer_list<Key> keys)
{
    LintTokenShape& shape = host->tokens.shapes[kind];
    auto* getter = dynamicDowncast<GetterSetter>(loc);
    JSFinalObject* object = createObject(vm, JSFinalObject::createStructure(vm, globalObject, prototype, keys.size() + (getter ? 1 : 0)));
    for (auto& key : keys) {
        Identifier name = Identifier::fromString(vm, key.name);
        if (key.offset != &LintTokenShape::locOffset)
            object->putDirect(vm, name, jsUndefined());
        else if (getter)
            object->putDirectNonIndexAccessor(vm, name, getter, static_cast<unsigned>(PropertyAttribute::Accessor));
        else
            object->putDirectCustomAccessor(vm, name, loc, static_cast<unsigned>(PropertyAttribute::CustomValue));
        shape.*key.offset = object->structure()->get(vm, name);
    }
    if (getter) {
        object->putDirect(vm, host->tokens.cachedLocName, jsUndefined(), static_cast<unsigned>(PropertyAttribute::DontEnum));
        shape.cachedLocOffset = object->structure()->get(vm, host->tokens.cachedLocName);
    }
    shape.structure.set(vm, host, object->structure());
    shape.loc.set(vm, host, loc);
}

void initializeShapes(VM& vm, JSGlobalObject* globalObject, LintHost* host)
{
    LintTokenState& state = host->tokens;
    JSObject* objectPrototype = globalObject->objectPrototype();
    auto startAndEnd = std::to_array<ASCIILiteral>({ "start"_s, "end"_s });
    auto lineAndColumn = std::to_array<ASCIILiteral>({ "line"_s, "column"_s });
    auto initializeLoc = [&](LintLocShape::Kind kind, Structure* structure, Structure* positionStructure, bool isReversed = false) {
        state.locShapes[kind].structure.set(vm, host, structure);
        state.locShapes[kind].positionStructure.set(vm, host, positionStructure);
        state.locShapes[kind].isReversed = isReversed;
    };

    JSObject* positionPrototype = createClass(vm, globalObject, "Position"_s, 2, constructPosition);
    putFunction(globalObject, positionPrototype, "offset"_s, 1, positionOffset);
    Structure* position = LintHost::createShape(vm, globalObject, positionPrototype, lineAndColumn);
    Structure* plainLoc = host->locStructure();
    initializeLoc(LintLocShape::EspreeToken, LintHost::createShape(vm, globalObject, createClass(vm, globalObject, "SourceLocation"_s, 3), startAndEnd), position);
    initializeLoc(LintLocShape::EspreeOther, plainLoc, position);
    initializeLoc(LintLocShape::TypeScript, LintHost::createShape(vm, globalObject, objectPrototype, std::to_array<ASCIILiteral>({ "end"_s, "start"_s })), LintHost::createShape(vm, globalObject, objectPrototype, std::to_array<ASCIILiteral>({ "column"_s, "line"_s })), true);
    initializeLoc(LintLocShape::Oxlint, plainLoc, host->positionStructure());
    state.regexStructure.set(vm, host, LintHost::createShape(vm, globalObject, objectPrototype, std::to_array<ASCIILiteral>({ "flags"_s, "pattern"_s })));
    state.oxlintRegexStructure.set(vm, host, LintHost::createShape(vm, globalObject, objectPrototype, std::to_array<ASCIILiteral>({ "pattern"_s, "flags"_s })));

    JSObject* tokenPrototype = createClass(vm, globalObject, "Token"_s, 1);
    JSCell* tokenLoc = createLazyValue(vm, lintEspreeTokenLoc);
    JSCell* otherLoc = createLazyValue(vm, lintEspreeOtherLoc);
    initializeShape(vm, globalObject, host, LintTokenShape::EspreeToken, tokenPrototype, tokenLoc, { typeKey, valueKey, startKey, endKey, locKey, rangeKey });
    initializeShape(vm, globalObject, host, LintTokenShape::EspreeRegex, tokenPrototype, tokenLoc, { typeKey, valueKey, startKey, endKey, locKey, rangeKey, regexKey });
    initializeShape(vm, globalObject, host, LintTokenShape::EspreeTemplate, objectPrototype, otherLoc, { typeKey, valueKey, locKey, startKey, endKey, rangeKey });
    initializeShape(vm, globalObject, host, LintTokenShape::EspreeComment, objectPrototype, otherLoc, { typeKey, valueKey, startKey, endKey, rangeKey, locKey });

    JSCell* typeScriptLoc = createLazyValue(vm, lintTypeScriptLoc);
    initializeShape(vm, globalObject, host, LintTokenShape::TypeScriptToken, objectPrototype, typeScriptLoc, { typeKey, locKey, rangeKey, valueKey });
    initializeShape(vm, globalObject, host, LintTokenShape::TypeScriptRegex, objectPrototype, typeScriptLoc, { typeKey, locKey, rangeKey, regexKey, valueKey });

    JSCell* oxlintLoc = createGetter(globalObject, "get loc"_s, jsLintOxlintLoc);
    initializeShape(vm, globalObject, host, LintTokenShape::OxlintToken, createClass(vm, globalObject, "Token"_s, 0), oxlintLoc, { typeKey, valueKey, regexKey, startKey, endKey, rangeKey, locKey });
    initializeShape(vm, globalObject, host, LintTokenShape::OxlintComment, createClass(vm, globalObject, "Comment"_s, 0), oxlintLoc, { typeKey, valueKey, startKey, endKey, rangeKey, locKey });
}

} // namespace

void LintTokenState::finishCreation(VM& vm, JSGlobalObject* globalObject, LintHost* host)
{
    cachedLocName = Identifier::fromUid(PrivateName(PrivateName::PrivateSymbol, "loc"_s));
    includeCommentsName = Identifier::fromString(vm, "includeComments"_s);
    skipName = Identifier::fromString(vm, "skip"_s);
    countName = Identifier::fromString(vm, "count"_s);
    filterName = Identifier::fromString(vm, "filter"_s);
    // Rules compare them with literals, which are atoms too.
    for (size_t i = 0; i < lintTokenKindCount; ++i)
        typeNames[i].set(vm, host, jsNontrivialString(vm, Identifier::fromString(vm, tokenTypeNames[i]).string()));
    initializeShapes(vm, globalObject, host);
    auto initializeList = [&](size_t index, ASCIILiteral name, ASCIILiteral getterName, NativeFunction getter, GetValueFunc customValue) {
        listsOfProgram[index].name = Identifier::fromString(vm, name);
        listsOfProgram[index].getter.set(vm, host, createGetter(globalObject, getterName, getter));
        listsOfProgram[index].customValue.set(vm, host, createLazyValue(vm, customValue));
    };
    initializeList(0, "comments"_s, "get comments"_s, jsLintComments, lintProgramComments);
    initializeList(1, "tokens"_s, "get tokens"_s, jsLintTokens, lintProgramTokens);

    JSObject* prototype = constructEmptyObject(globalObject);
    auto* store = LintTokenStoreConstructor::create(vm, globalObject, prototype);
    prototype->putDirect(vm, vm.propertyNames->constructor, store, static_cast<unsigned>(PropertyAttribute::DontEnum));
    for (auto& method : methods)
        putFunction(globalObject, prototype, method.name, method.length, method.function, static_cast<unsigned>(PropertyAttribute::DontEnum));
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
    decodedValues.clear();
    tokensAndComments.clear();
}

void addLintTokenFunctions(JSGlobalObject* globalObject, JSObject* native)
{
    VM& vm = globalObject->vm();
    native->putDirect(vm, Identifier::fromString(vm, "TokenStore"_s), LintHost::from(globalObject)->tokens.constructor.get());
}

} // namespace Bun
