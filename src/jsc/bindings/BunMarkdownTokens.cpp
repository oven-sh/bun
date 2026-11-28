// Makes the objects of Bun.markdown.tokens() from the instructions of src/md/tokens.rs.
#include "root.h"

#include "BunMarkdownTagStrings.h"
#include "ZigGlobalObject.h"
#include "headers-handwritten.h"
#include <JavaScriptCore/JSArrayInlines.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>

extern "C" JSC::EncodedJSValue BunString__createUTF8ForJS(JSC::JSGlobalObject*, const char*, size_t);

namespace Bun {
namespace MarkdownTokens {

using namespace JSC;

enum class TokenKind : uint8_t {
    Space,
    FencedCode,
    IndentedCode,
    Heading,
    HeadingWithId,
    Hr,
    Blockquote,
    List,
    ListItem,
    HtmlBlock,
    Def,
    Table,
    TableCell,
    Paragraph,
    TextBlock,
    Em,
    Strong,
    Del,
    Text,
    LiteralText,
    Escape,
    Codespan,
    Br,
    HtmlInline,
    Link,
    Image,
    Autolink,
    Wikilink,
    TableRow,
    SetBase,
    Reuse,
};

enum class StringFrom : uint32_t {
    Empty,
    Null,
    Undefined,
    Source,
    Pool,
    Base,
    PartOfBase,
    Raw,
};

struct Str {
    StringFrom from;
    uint32_t begin;
    uint32_t length;
};

struct Op {
    TokenKind kind;
    bool flagA;
    bool flagB;
    bool flagC;
    uint32_t childCount;
    uint32_t number;
    uint32_t keepIn;
    Str raw;
    Str text;
    Str first;
    Str second;
};

static constexpr uint32_t notKept = std::numeric_limits<uint32_t>::max();

enum class Value : uint8_t {
    None,
    Type,
    Raw,
    Text,
    First,
    Second,
    Children,
    Number,
    FlagA,
    FlagB,
    FlagC,
    True,
    False,
    Indented,
    NumberIfFlagA,
    FlagBIfFlagA,
    Alignment,
    HeaderRow,
    HeaderAlignments,
    BodyRows,
};

struct Property {
    ASCIILiteral name;
    Value value { Value::None };
};

struct Shape {
    ASCIILiteral type;
    std::array<Property, 7> properties;
};

static constexpr Property type { "type"_s, Value::Type };
static constexpr Property raw { "raw"_s, Value::Raw };
static constexpr Property text { "text"_s, Value::Text };
static constexpr Property tokens { "tokens"_s, Value::Children };
static constexpr Property href { "href"_s, Value::First };
static constexpr Property title { "title"_s, Value::Second };
static constexpr Property depth { "depth"_s, Value::Number };

// In the order of TokenKind.
static constexpr Shape shapes[] = {
    { "space"_s, { type, raw } },
    { "code"_s, { type, raw, { "lang"_s, Value::First }, text } },
    { "code"_s, { type, raw, { "codeBlockStyle"_s, Value::Indented }, text } },
    { "heading"_s, { type, raw, depth, text, tokens } },
    { "heading"_s, { type, raw, depth, text, tokens, { "id"_s, Value::First } } },
    { "hr"_s, { type, raw } },
    { "blockquote"_s, { type, raw, tokens, text } },
    { "list"_s, { type, raw, { "ordered"_s, Value::FlagA }, { "start"_s, Value::NumberIfFlagA }, { "loose"_s, Value::FlagB }, { "items"_s, Value::Children } } },
    { "list_item"_s, { type, raw, { "task"_s, Value::FlagA }, { "checked"_s, Value::FlagBIfFlagA }, { "loose"_s, Value::FlagC }, text, tokens } },
    { "html"_s, { type, { "block"_s, Value::True }, raw, { "pre"_s, Value::FlagA }, text } },
    { "def"_s, { type, { "tag"_s, Value::Text }, raw, href, title } },
    { "table"_s, { type, raw, { "header"_s, Value::HeaderRow }, { "align"_s, Value::HeaderAlignments }, { "rows"_s, Value::BodyRows } } },
    { ""_s, { text, tokens, { "header"_s, Value::FlagA }, { "align"_s, Value::Alignment } } },
    { "paragraph"_s, { type, raw, text, tokens } },
    { "text"_s, { type, raw, text, tokens } },
    { "em"_s, { type, raw, text, tokens } },
    { "strong"_s, { type, raw, text, tokens } },
    { "del"_s, { type, raw, text, tokens } },
    { "text"_s, { type, raw, text, { "escaped"_s, Value::FlagA } } },
    { "text"_s, { type, raw, text } },
    { "escape"_s, { type, raw, text } },
    { "codespan"_s, { type, raw, text } },
    { "br"_s, { type, raw } },
    { "html"_s, { type, raw, { "inLink"_s, Value::FlagA }, { "inRawBlock"_s, Value::FlagB }, { "block"_s, Value::False }, text } },
    { "link"_s, { type, raw, href, title, text, tokens } },
    { "image"_s, { type, raw, href, title, text, tokens } },
    { "link"_s, { type, raw, text, href, tokens } },
    { "wikilink"_s, { type, raw, { "target"_s, Value::First }, text, tokens } },
};
static constexpr size_t shapeCount = std::size(shapes);
static_assert(shapeCount == static_cast<size_t>(TokenKind::TableRow));
static constexpr PropertyOffset alignOffsetInCell = 3;

// Behind a structure and a type for each shape. The first three follow `Align` in src/md/types.rs.
static constexpr ASCIILiteral words[] = { "left"_s, "center"_s, "right"_s, "indented"_s };

static JSArray* createConstants(VM& vm, JSGlobalObject* globalObject)
{
    MarkedArgumentBuffer constants;
    for (auto& shape : shapes) {
        Structure* structure = globalObject->structureCache().emptyObjectStructureForPrototype(globalObject, globalObject->objectPrototype(), shape.properties.size());
        for (auto& property : shape.properties) {
            if (property.value == Value::None)
                break;
            PropertyOffset offset;
            structure = Structure::addPropertyTransition(vm, structure, Identifier::fromString(vm, property.name), 0, offset);
        }
        constants.append(structure);
        constants.append(jsString(vm, AtomString(shape.type).string()));
    }
    for (auto word : words)
        constants.append(jsString(vm, AtomString(word).string()));
    RELEASE_ASSERT(!constants.hasOverflowed());
    return constructArray(globalObject, globalObject->originalArrayStructureForIndexingType(ArrayWithContiguous), constants);
}

static JSArray* arrayOfLast(JSGlobalObject* globalObject, MarkedArgumentBuffer& stack, size_t count)
{
    RELEASE_ASSERT(count <= stack.size());
    return constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), std::bit_cast<const JSValue*>(stack.data()) + stack.size() - count, count);
}

} // namespace MarkdownTokens

JSC::JSArray* createMarkdownTokenConstants(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    return MarkdownTokens::createConstants(vm, globalObject);
}

} // namespace Bun

// `kept` is the array that has the slots, or empty if no instruction names one.
extern "C" JSC::EncodedJSValue BunMarkdownTokens__create(Zig::GlobalObject* globalObject, const Bun::MarkdownTokens::Op* ops, size_t opCount, const char* source, const char* pool, JSC::EncodedJSValue encodedKept)
{
    using namespace JSC;
    using namespace Bun::MarkdownTokens;

    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSArray* constants = globalObject->markdownTagStrings().tokenConstants(globalObject);
    JSValue kept = JSValue::decode(encodedKept);
    JSString* base = jsEmptyString(vm);
    MarkedArgumentBuffer stack;

    // Empty if it has thrown.
    auto toJS = [&](const Str& string, JSValue rawValue) -> JSValue {
        switch (string.from) {
        case StringFrom::Empty:
            return jsEmptyString(vm);
        case StringFrom::Null:
            return jsNull();
        case StringFrom::Undefined:
            return jsUndefined();
        case StringFrom::Source:
            return JSValue::decode(BunString__createUTF8ForJS(globalObject, source + string.begin, string.length));
        case StringFrom::Pool:
            return JSValue::decode(BunString__createUTF8ForJS(globalObject, pool + string.begin, string.length));
        case StringFrom::Base:
            return base;
        case StringFrom::PartOfBase:
            RELEASE_ASSERT(string.begin <= base->length() && string.length <= base->length() - string.begin);
            return jsSubstringOfResolved(vm, nullptr, base, string.begin, string.length);
        case StringFrom::Raw:
            return rawValue;
        }
        RELEASE_ASSERT_NOT_REACHED();
    };

    for (const Op& op : std::span { ops, opCount }) {
        JSValue token;
        switch (op.kind) {
        case TokenKind::SetBase: {
            JSValue string = toJS(op.raw, {});
            RETURN_IF_EXCEPTION(scope, {});
            base = asString(string);
            continue;
        }
        case TokenKind::Reuse:
            token = asObject(kept)->getDirectIndex(globalObject, op.number);
            RETURN_IF_EXCEPTION(scope, {});
            RELEASE_ASSERT(token);
            break;
        case TokenKind::TableRow:
            token = arrayOfLast(globalObject, stack, op.childCount);
            RETURN_IF_EXCEPTION(scope, {});
            break;
        default: {
            size_t index = static_cast<size_t>(op.kind);
            JSValue rawValue = toJS(op.raw, {});
            RETURN_IF_EXCEPTION(scope, {});
            JSObject* object = constructEmptyObject(vm, uncheckedDowncast<Structure>(constants->getIndexQuickly(index * 2).asCell()));
            PropertyOffset offset = 0;
            for (auto& property : shapes[index].properties) {
                JSValue value;
                switch (property.value) {
                case Value::None:
                    continue;
                case Value::Type:
                    value = constants->getIndexQuickly(index * 2 + 1);
                    break;
                case Value::Raw:
                    value = rawValue;
                    break;
                case Value::Text:
                    value = toJS(op.text, rawValue);
                    break;
                case Value::First:
                    value = toJS(op.first, rawValue);
                    break;
                case Value::Second:
                    value = toJS(op.second, rawValue);
                    break;
                case Value::Children:
                    value = arrayOfLast(globalObject, stack, op.childCount);
                    break;
                case Value::Number:
                    value = jsNumber(op.number);
                    break;
                case Value::FlagA:
                    value = jsBoolean(op.flagA);
                    break;
                case Value::FlagB:
                    value = jsBoolean(op.flagB);
                    break;
                case Value::FlagC:
                    value = jsBoolean(op.flagC);
                    break;
                case Value::True:
                    value = jsBoolean(true);
                    break;
                case Value::False:
                    value = jsBoolean(false);
                    break;
                case Value::Indented:
                    value = constants->getIndexQuickly(shapeCount * 2 + 3);
                    break;
                case Value::NumberIfFlagA:
                    value = op.flagA ? jsNumber(op.number) : JSValue(jsEmptyString(vm));
                    break;
                case Value::FlagBIfFlagA:
                    value = op.flagA ? jsBoolean(op.flagB) : jsUndefined();
                    break;
                case Value::Alignment:
                    value = op.number ? constants->getIndexQuickly(shapeCount * 2 + op.number - 1) : jsNull();
                    break;
                case Value::HeaderRow:
                    RELEASE_ASSERT(op.childCount && op.childCount <= stack.size());
                    value = stack.at(stack.size() - op.childCount);
                    break;
                case Value::HeaderAlignments: {
                    // No JavaScript has seen this row.
                    JSArray* header = asArray(stack.at(stack.size() - op.childCount));
                    unsigned length = header->length();
                    for (unsigned i = 0; i < length; i++)
                        stack.append(asObject(header->getDirectIndex(globalObject, i))->getDirect(alignOffsetInCell));
                    if (stack.hasOverflowed()) [[unlikely]] {
                        throwOutOfMemoryError(globalObject, scope);
                        return {};
                    }
                    value = arrayOfLast(globalObject, stack, length);
                    for (unsigned i = 0; i < length; i++)
                        stack.removeLast();
                    break;
                }
                case Value::BodyRows:
                    value = arrayOfLast(globalObject, stack, op.childCount - 1);
                    break;
                }
                RETURN_IF_EXCEPTION(scope, {});
                object->putDirectOffset(vm, offset++, value);
            }
            token = object;
            break;
        }
        }

        for (uint32_t i = 0; i < op.childCount; i++)
            stack.removeLast();
        stack.append(token);
        if (stack.hasOverflowed()) [[unlikely]] {
            throwOutOfMemoryError(globalObject, scope);
            return {};
        }
        if (op.keepIn != notKept) {
            asObject(kept)->putDirectIndex(globalObject, op.keepIn, token);
            RETURN_IF_EXCEPTION(scope, {});
        }
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(arrayOfLast(globalObject, stack, stack.size())));
}
