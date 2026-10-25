#pragma once

#include "root.h"
#include "BunValidator.h"
#include <JavaScriptCore/RegExp.h>
#include <wtf/HashMap.h>
#include <wtf/Vector.h>
#include <wtf/text/AtomString.h>
#include <wtf/text/WTFString.h>

// Reads a JSON Schema (draft 2020-12, draft-07) into validation nodes.
namespace Bun::JSONSchema {

static constexpr uint32_t none = UINT32_MAX;

#define FOR_EACH_JSON_SCHEMA_KEYWORD(macro)                                                                                                                                                                                                                   \
    macro(Id, "$id")                                                                                                                                                                                                                                          \
        macro(SchemaDialect, "$schema")                                                                                                                                                                                                                       \
            macro(Ref, "$ref")                                                                                                                                                                                                                                \
                macro(Anchor, "$anchor")                                                                                                                                                                                                                      \
                    macro(DynamicRef, "$dynamicRef")                                                                                                                                                                                                          \
                        macro(DynamicAnchor, "$dynamicAnchor")                                                                                                                                                                                                \
                            macro(Defs, "$defs")                                                                                                                                                                                                              \
                                macro(Definitions, "definitions")                                                                                                                                                                                             \
                                    macro(Title, "title")                                                                                                                                                                                                     \
                                        macro(Extension, "x-bun")                                                                                                                                                                                             \
                                            macro(Type, "type")                                                                                                                                                                                               \
                                                macro(Enum, "enum")                                                                                                                                                                                           \
                                                    macro(Const, "const")                                                                                                                                                                                     \
                                                        macro(Nullable, "nullable")                                                                                                                                                                           \
                                                            macro(MultipleOf, "multipleOf")                                                                                                                                                                   \
                                                                macro(Maximum, "maximum")                                                                                                                                                                     \
                                                                    macro(ExclusiveMaximum, "exclusiveMaximum")                                                                                                                                               \
                                                                        macro(Minimum, "minimum")                                                                                                                                                             \
                                                                            macro(ExclusiveMinimum, "exclusiveMinimum")                                                                                                                                       \
                                                                                macro(MaxLength, "maxLength")                                                                                                                                                 \
                                                                                    macro(MinLength, "minLength")                                                                                                                                             \
                                                                                        macro(Pattern, "pattern")                                                                                                                                             \
                                                                                            macro(Format, "format")                                                                                                                                           \
                                                                                                macro(Items, "items")                                                                                                                                         \
                                                                                                    macro(PrefixItems, "prefixItems")                                                                                                                         \
                                                                                                        macro(AdditionalItems, "additionalItems")                                                                                                             \
                                                                                                            macro(Contains, "contains")                                                                                                                       \
                                                                                                                macro(MinContains, "minContains")                                                                                                             \
                                                                                                                    macro(MaxContains, "maxContains")                                                                                                         \
                                                                                                                        macro(MaxItems, "maxItems")                                                                                                           \
                                                                                                                            macro(MinItems, "minItems")                                                                                                       \
                                                                                                                                macro(UniqueItems, "uniqueItems")                                                                                             \
                                                                                                                                    macro(Properties, "properties")                                                                                           \
                                                                                                                                        macro(PatternProperties, "patternProperties")                                                                         \
                                                                                                                                            macro(AdditionalProperties, "additionalProperties")                                                               \
                                                                                                                                                macro(PropertyNames, "propertyNames")                                                                         \
                                                                                                                                                    macro(Required, "required")                                                                               \
                                                                                                                                                        macro(DependentRequired, "dependentRequired")                                                         \
                                                                                                                                                            macro(DependentSchemas, "dependentSchemas")                                                       \
                                                                                                                                                                macro(Dependencies, "dependencies")                                                           \
                                                                                                                                                                    macro(MaxProperties, "maxProperties")                                                     \
                                                                                                                                                                        macro(MinProperties, "minProperties")                                                 \
                                                                                                                                                                            macro(AllOf, "allOf")                                                             \
                                                                                                                                                                                macro(AnyOf, "anyOf")                                                         \
                                                                                                                                                                                    macro(OneOf, "oneOf")                                                     \
                                                                                                                                                                                        macro(Not, "not")                                                     \
                                                                                                                                                                                            macro(If, "if")                                                   \
                                                                                                                                                                                                macro(Then, "then")                                           \
                                                                                                                                                                                                    macro(Else, "else")                                       \
                                                                                                                                                                                                        macro(UnevaluatedProperties, "unevaluatedProperties") \
                                                                                                                                                                                                            macro(UnevaluatedItems, "unevaluatedItems")       \
                                                                                                                                                                                                                macro(ContentSchema, "contentSchema")

enum class Keyword : uint8_t {
#define DECLARE_KEYWORD(name, text) name,
    FOR_EACH_JSON_SCHEMA_KEYWORD(DECLARE_KEYWORD)
#undef DECLARE_KEYWORD
        Unknown,
};
static constexpr unsigned numberOfKeywords = static_cast<unsigned>(Keyword::Unknown);

enum class Dialect : uint8_t { Draft7,
    Draft2020 };

enum class Kind : uint8_t { Null,
    False,
    True,
    Number,
    String,
    Array,
    Object,
    NotJSON };

// One JSON value of a schema document. Values are numbered parent first, so [index, end) is a subtree.
struct Data {
    Kind kind { Kind::Null };
    uint32_t first { 0 };
    uint32_t count { 0 };
    uint32_t end { 0 };
    double number { 0 };
    WTF::String string;
};

struct Member {
    WTF::AtomString key;
    uint32_t value;
    Keyword keyword;
};

struct Document {
    uint32_t root;
    WTF::String uri;
    bool hasIdentifiers { false };
};

struct Pool {
    WTF::Vector<Data> values;
    WTF::Vector<uint32_t> elements;
    WTF::Vector<Member> members;
    WTF::Vector<Document> documents;
    // The first value that JSON cannot hold, such as a function, a Map, a Proxy, a class instance or NaN.
    uint32_t firstNotJSON { none };

    const Data& operator[](uint32_t index) const { return values[index]; }
    std::span<const Member> membersOf(uint32_t index) const { return members.span().subspan(values[index].first, values[index].count); }
    std::span<const uint32_t> elementsOf(uint32_t index) const { return elements.span().subspan(values[index].first, values[index].count); }
    // For error messages: `properties.a.allOf[0]`. The root is `schema`.
    WTF::String pathTo(uint32_t index) const;
};

enum TypeBit : uint8_t {
    NullBit = 1,
    BooleanBit = 2,
    NumberBit = 4,
    IntegerBit = 8,
    StringBit = 16,
    ArrayBit = 32,
    ObjectBit = 64,
    OtherBit = 128,
    // What JSON can hold. Infinity, NaN, undefined, functions, symbols and BigInts are "other": only `true` and `{}` accept them.
    EveryJSONType = 127,
    EveryType = 255,
};

enum class OpCode : uint8_t {
    Minimum,
    Maximum,
    ExclusiveMinimum,
    ExclusiveMaximum,
    MultipleOf,
    MinLength,
    MaxLength,
    Pattern,
    Format,
    Enum,
    StringEnum,
    UniqueItems,
    Items,
    Contains,
    Object,
    Ref,
    AllOf,
    AnyOf,
    OneOf,
    Not,
    If,
};

struct Op {
    OpCode code;
    uint8_t applies;
    Keyword keyword;
    uint32_t a { 0 };
    union {
        double number;
        struct {
            uint32_t b;
            uint32_t c;
        };
    };
};
static_assert(sizeof(Op) == 16);

struct Schema {
    uint8_t types { EveryType };
    bool hasTitleOrExtension { false };
    uint32_t firstOp { 0 };
    uint32_t opCount { 0 };
    uint32_t data { none };
};

struct PropertyRule {
    WTF::AtomString key;
    uint32_t schema;
    bool required;
};

struct PatternRule {
    uint32_t regExp;
    uint32_t schema;
};

struct DependentRule {
    WTF::AtomString key;
    uint32_t schema;
    uint32_t firstName;
    uint32_t nameCount;
};

struct ObjectNode {
    uint32_t firstRule { 0 };
    uint32_t ruleCount { 0 };
    uint32_t firstPattern { 0 };
    uint32_t patternCount { 0 };
    uint32_t firstDependent { 0 };
    uint32_t dependentCount { 0 };
    uint32_t additional { none };
    uint32_t propertyNames { none };
    uint32_t minProperties { 0 };
    uint32_t maxProperties { UINT32_MAX };
    WTF::HashMap<const WTF::StringImpl*, uint32_t> ruleByKey;
};

struct ArrayNode {
    uint32_t firstPrefix { 0 };
    uint32_t prefixCount { 0 };
    uint32_t rest { none };
    uint32_t minItems { 0 };
    uint32_t maxItems { UINT32_MAX };
};

enum class Format : uint8_t {
    DateTime,
    Date,
    Time,
    Duration,
    Email,
    Hostname,
    IPv4,
    IPv6,
    URI,
    URIReference,
    UUID,
    RegularExpression,
    JSONPointer,
    RelativeJSONPointer,
    URL,
};

// A schema with its references resolved. It lives only while readJSONSchema runs.
struct Program {
    Pool pool;
    WTF::Vector<Schema> schemas;
    WTF::Vector<Op> ops;
    WTF::Vector<uint32_t> lists;
    WTF::Vector<ObjectNode> objects;
    WTF::Vector<PropertyRule> rules;
    WTF::Vector<PatternRule> patterns;
    WTF::Vector<DependentRule> dependents;
    WTF::Vector<WTF::AtomString> names;
    WTF::Vector<ArrayNode> arrays;
    WTF::Vector<JSC::RegExp*> regExps;
    uint32_t root { 0 };
};

// The first two schemas of every program.
static constexpr uint32_t trueSchema = 0;
static constexpr uint32_t falseSchema = 1;

ASCIILiteral nameOf(Keyword);

// JSONSchemaFormats.cpp.
ASCIILiteral nameOf(Format);
std::optional<Format> formatNamed(const WTF::String&);
bool matchesFormat(JSC::VM&, Format, WTF::StringView);

// JSONSchemaNodes.cpp. Throws a TypeError if the nodes cannot say what the schema says.
std::optional<ValidatorNodes> writeNodes(JSC::JSGlobalObject*, const Program&);

} // namespace Bun::JSONSchema
