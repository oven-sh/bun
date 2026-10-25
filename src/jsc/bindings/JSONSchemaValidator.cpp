#include "root.h"

#include "JSONSchemaValidator.h"
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/PropertyNameArray.h>
#include <JavaScriptCore/YarrFlags.h>
#include <wtf/HashSet.h>
#include <wtf/URL.h>
#include <wtf/text/MakeString.h>
#include <wtf/text/StringBuilder.h>
#include <wtf/text/StringToIntegerConversion.h>

namespace Bun::JSONSchema {

using namespace JSC;
using namespace WTF;

static constexpr ASCIILiteral nestedTooDeeply = "Schema is nested too deeply"_s;

static constexpr ASCIILiteral keywordNames[] = {
#define KEYWORD_NAME(name, text) text##_s,
    FOR_EACH_JSON_SCHEMA_KEYWORD(KEYWORD_NAME)
#undef KEYWORD_NAME
        ""_s,
};

ASCIILiteral nameOf(Keyword keyword)
{
    return keywordNames[static_cast<unsigned>(keyword)];
}

static Keyword parseKeyword(const StringImpl& key)
{
    if (!key.is8Bit())
        return Keyword::Unknown;
    auto characters = key.span8();
    for (unsigned i = 0; i < numberOfKeywords; ++i) {
        auto name = keywordNames[i].span8();
        if (name.size() == characters.size() && name[1] == characters[1] && equalSpans(name, characters))
            return static_cast<Keyword>(i);
    }
    return Keyword::Unknown;
}

static bool isIdentifier(StringView key)
{
    for (unsigned i = 0; i < key.length(); ++i) {
        char16_t unit = key[i];
        if (!isASCIIAlpha(unit) && unit != '_' && unit != '$' && (!i || !isASCIIDigit(unit)))
            return false;
    }
    return !key.isEmpty();
}

static void appendKey(StringBuilder& path, const String& key)
{
    if (!isIdentifier(key)) {
        path.append('[');
        path.appendQuotedJSONString(key);
        path.append(']');
        return;
    }
    if (!path.isEmpty())
        path.append('.');
    path.append(key);
}

String Pool::pathTo(uint32_t target) const
{
    unsigned document = 0;
    while (document + 1 < documents.size() && documents[document + 1].root <= target)
        ++document;
    StringBuilder path;
    if (document) {
        path.append("schemas"_s);
        if (documents[document].uri.isEmpty())
            path.append('[', document - 1, ']');
        else {
            path.append('[');
            path.appendQuotedJSONString(documents[document].uri);
            path.append(']');
        }
    }
    uint32_t current = documents[document].root;
    while (current != target) {
        uint32_t next = none;
        if (values[current].kind == Kind::Object) {
            for (auto& member : membersOf(current)) {
                if (member.value <= target && target < values[member.value].end) {
                    appendKey(path, member.key.string());
                    next = member.value;
                    break;
                }
            }
        } else if (values[current].kind == Kind::Array) {
            unsigned position = 0;
            for (uint32_t element : elementsOf(current)) {
                if (element <= target && target < values[element].end) {
                    path.append('[', position, ']');
                    next = element;
                    break;
                }
                ++position;
            }
        }
        if (next == none)
            break;
        current = next;
    }
    return path.isEmpty() ? String("schema"_s) : path.toString();
}

// An object literal, or what JSON.parse returns: its prototype is null or some realm's Object.prototype.
static bool isPlainObject(JSValue value)
{
    if (!value.isObject())
        return false;
    JSObject* object = asObject(value);
    if (object->type() != FinalObjectType && object->type() != CompiledObjectType)
        return false;
    JSValue prototype = object->getPrototypeDirect();
    return prototype.isNull() || (prototype.isObject() && asObject(prototype)->getPrototypeDirect().isNull());
}

// Copies a JavaScript value into a Pool. This is the only step that runs getters, and it reads each property once.
class Importer {
public:
    Importer(VM& vm, JSGlobalObject* globalObject, Pool& pool)
        : m_vm(vm)
        , m_globalObject(globalObject)
        , m_pool(pool)
    {
    }

    void importDocument(JSValue value, const String& uri)
    {
        m_hasIdentifiers = false;
        uint32_t root = import(value, true);
        if (root != none)
            m_pool.documents.append(Document { root, uri, m_hasIdentifiers });
    }

private:
    static constexpr uint32_t maxValues = 1 << 20;
    static constexpr uint64_t maxCharacters = 1 << 26;
    static constexpr unsigned maxDepth = 1024;

    // A string that is held in several places counts once for each place.
    bool countCharacters(unsigned length)
    {
        m_characters += length;
        if (m_characters <= maxCharacters) [[likely]]
            return true;
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        throwTypeError(m_globalObject, scope, "Too many characters in schema (limit 67108864)"_s);
        return false;
    }

    uint32_t import(JSValue value, bool isRoot)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        // An object that is held in several places is read once for each place.
        uint32_t index = m_pool.values.size();
        if (index >= maxValues) [[unlikely]] {
            throwTypeError(m_globalObject, scope, "Too many values in schema (limit 1048576)"_s);
            return none;
        }
        m_pool.values.append(Data {});

        if (value.isNull()) {
        } else if (value.isBoolean())
            m_pool.values[index].kind = value.asBoolean() ? Kind::True : Kind::False;
        else if (value.isNumber()) {
            m_pool.values[index].kind = std::isfinite(value.asNumber()) ? Kind::Number : Kind::NotJSON;
            m_pool.values[index].number = value.asNumber();
        } else if (value.isString()) {
            String string = asString(value)->value(m_globalObject);
            RETURN_IF_EXCEPTION(scope, none);
            if (!countCharacters(string.length()))
                return none;
            m_pool.values[index].kind = Kind::String;
            m_pool.values[index].string = WTF::move(string);
        } else if (isJSArray(value) || isPlainObject(value)) {
            JSObject* object = asObject(value);
            if (m_ancestors.size() >= maxDepth || !m_vm.isSafeToRecurse()) [[unlikely]] {
                throwTypeError(m_globalObject, scope, nestedTooDeeply);
                return none;
            }
            if (m_ancestors.contains(object)) {
                throwTypeError(m_globalObject, scope, "Expected schema to have no cycles (use \"$ref\" for recursion)"_s);
                return none;
            }
            m_ancestors.append(object);
            if (isJSArray(object)) {
                unsigned length = asArray(object)->length();
                Vector<uint32_t, 8> children;
                for (unsigned i = 0; i < length; ++i) {
                    JSValue element = object->getIndex(m_globalObject, i);
                    RETURN_IF_EXCEPTION(scope, none);
                    uint32_t child = import(element, false);
                    RETURN_IF_EXCEPTION(scope, none);
                    children.append(child);
                }
                Data& data = m_pool.values[index];
                data.kind = Kind::Array;
                data.first = m_pool.elements.size();
                data.count = children.size();
                m_pool.elements.appendVector(children);
            } else {
                PropertyNameArrayBuilder names(m_vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
                object->methodTable()->getOwnPropertyNames(object, m_globalObject, names, DontEnumPropertiesMode::Exclude);
                RETURN_IF_EXCEPTION(scope, none);
                Vector<Member, 8> members;
                for (auto& name : names) {
                    JSValue property = object->get(m_globalObject, name);
                    RETURN_IF_EXCEPTION(scope, none);
                    if (property.isUndefined())
                        continue;
                    if (!countCharacters(name.length()))
                        return none;
                    Keyword keyword = parseKeyword(*name.impl());
                    if (!isRoot && (keyword == Keyword::Id || keyword == Keyword::Anchor || keyword == Keyword::DynamicAnchor))
                        m_hasIdentifiers = true;
                    uint32_t child = import(property, false);
                    RETURN_IF_EXCEPTION(scope, none);
                    members.append(Member { name.string(), child, keyword });
                }
                Data& data = m_pool.values[index];
                data.kind = Kind::Object;
                data.first = m_pool.members.size();
                data.count = members.size();
                m_pool.members.appendVector(WTF::move(members));
            }
            m_ancestors.removeLast();
        } else
            m_pool.values[index].kind = Kind::NotJSON;
        if (m_pool.values[index].kind == Kind::NotJSON && m_pool.firstNotJSON == none)
            m_pool.firstNotJSON = index;
        m_pool.values[index].end = m_pool.values.size();
        return index;
    }

    VM& m_vm;
    JSGlobalObject* m_globalObject;
    Pool& m_pool;
    Vector<JSObject*, 16> m_ancestors;
    uint64_t m_characters { 0 };
    bool m_hasIdentifiers { false };
};

enum Vocabulary : uint8_t {
    ValidationVocabulary = 1,
    FormatAssertionVocabulary = 2,
};

struct DialectInUse {
    Dialect dialect;
    uint8_t vocabularies;
};

// With a place, the message is "Expected <path to the place><text>".
struct Problem {
    String text;
    uint32_t place { none };
};

struct Resource {
    String uri;
    uint32_t root;
    uint32_t parent;
    DialectInUse inUse;
    // What is wrong with its "$schema". It is an error only if a schema of this resource is used.
    Problem problem;
    HashMap<String, uint32_t> anchors;
    HashMap<String, uint32_t> dynamicAnchors;
};

// Checks every keyword and resolves every reference.
class Compiler {
public:
    Compiler(VM& vm, Program& program, MarkedArgumentBuffer& cells, Dialect defaultDialect, bool assertsFormats, bool isStrict)
        : m_vm(vm)
        , m_program(program)
        , m_pool(program.pool)
        , m_cells(cells)
        , m_defaultDialect(defaultDialect)
        , m_assertsFormats(assertsFormats)
        , m_isStrict(isStrict)
    {
    }

    bool run();
    const String& error() const { return m_error; }

private:
    using Keywords = std::array<uint32_t, numberOfKeywords>;
    using MembersByKey = HashMap<const StringImpl*, uint32_t>;

    static constexpr uint64_t maxSteps = 1 << 26;

    bool failed() const { return !m_error.isNull(); }
    uint32_t fail(const String& message)
    {
        if (!failed())
            m_error = message;
        return none;
    }
    uint32_t fail(ASCIILiteral prefix, uint32_t data, ASCIILiteral suffix = ""_s)
    {
        return failed() ? none : fail(makeString(prefix, m_pool.pathTo(data), suffix));
    }
    uint32_t expect(uint32_t data, ASCIILiteral what)
    {
        return failed() ? none : fail(makeString("Expected "_s, m_pool.pathTo(data), " to be "_s, what));
    }
    bool refuse(uint32_t data, ASCIILiteral what)
    {
        expect(data, what);
        return false;
    }

    // Bounds the work that grows faster than the schema does.
    bool spend(uint64_t steps)
    {
        m_steps += steps;
        if (m_steps > maxSteps)
            fail("Too many steps to resolve \"$id\", \"$ref\" and \"$schema\" in schema"_s);
        return !failed();
    }

    // A name that two schemas share. It is an error only if something refers to it.
    static constexpr uint32_t ambiguous = none - 1;
    static void addOnce(HashMap<String, uint32_t>& map, const String& name, uint32_t value)
    {
        auto result = map.add(name, value);
        if (!result.isNewEntry && result.iterator->value != value)
            result.iterator->value = ambiguous;
    }

    Keywords collectKeywords(uint32_t data) const
    {
        Keywords at;
        at.fill(none);
        for (auto& member : m_pool.membersOf(data)) {
            if (member.keyword != Keyword::Unknown)
                at[static_cast<unsigned>(member.keyword)] = member.value;
        }
        return at;
    }

    DialectInUse findDialect(uint32_t data, DialectInUse inherited, Problem&);
    void readVocabularies(uint32_t vocabulary, DialectInUse&, Problem&);
    bool checkNoKeywordIsIgnored(uint32_t data, const Keywords&, uint32_t resource);
    String resolveURI(const String& base, const String& reference);
    uint32_t addResource(const String& uri, uint32_t root, uint32_t parent, DialectInUse inherited);
    void scanDocument(Document&);
    void scan(uint32_t data, uint32_t resource, bool recurse);
    uint32_t findResource(uint32_t data) const;
    uint32_t resolve(uint32_t from, const String& reference, uint32_t fromResource, bool* isDynamic = nullptr);
    uint32_t findMember(uint32_t object, const AtomString& key);
    uint32_t walkPointer(uint32_t from, const String& pointer);

    uint32_t compile(uint32_t data);
    uint32_t compileList(uint32_t data, uint32_t& count);
    bool compileObjectKeywords(const Keywords&, DialectInUse, Vector<Op, 16>&);
    bool compileArrayKeywords(const Keywords&, DialectInUse, Vector<Op, 16>&);
    uint32_t compileRegExp(uint32_t data, ASCIILiteral place, const String& pattern);
    bool readCount(uint32_t data, uint32_t& result);
    uint8_t getTypeBit(uint32_t data) const;
    void collapseReferences();
    void simplifyOneOf();

    VM& m_vm;
    Program& m_program;
    Pool& m_pool;
    MarkedArgumentBuffer& m_cells;
    Dialect m_defaultDialect;
    bool m_assertsFormats;
    bool m_isStrict;
    String m_error;
    Vector<Resource> m_resources;
    HashMap<String, uint32_t> m_resourceByURI;
    HashMap<uint32_t, uint32_t, IntHash<uint32_t>, UnsignedWithZeroKeyHashTraits<uint32_t>> m_compiled;
    HashMap<uint32_t, MembersByKey, IntHash<uint32_t>, UnsignedWithZeroKeyHashTraits<uint32_t>> m_membersByKey;
    HashMap<String, uint32_t> m_regExpByPattern;
    uint64_t m_steps { 0 };
    unsigned m_dialectDepth { 0 };
};

#define AT(keyword) at[static_cast<unsigned>(Keyword::keyword)]

void Compiler::readVocabularies(uint32_t vocabulary, DialectInUse& inUse, Problem& problem)
{
    static constexpr ASCIILiteral prefix = "https://json-schema.org/draft/2020-12/vocab/"_s;
    static constexpr ASCIILiteral known[] = { "core"_s, "applicator"_s, "unevaluated"_s, "validation"_s, "meta-data"_s, "format-annotation"_s, "format-assertion"_s, "content"_s };
    inUse.vocabularies = m_assertsFormats ? FormatAssertionVocabulary : 0;
    if (!spend(m_pool[vocabulary].count))
        return;
    for (auto& member : m_pool.membersOf(vocabulary)) {
        StringView name = member.key.string();
        bool isKnown = false;
        if (name.startsWith(prefix)) {
            for (auto& candidate : known)
                isKnown |= name.substring(prefix.length()) == candidate;
        }
        if (!isKnown && m_pool[member.value].kind != Kind::False)
            problem = { makeString("Unknown vocabulary: "_s, name) };
        if (name.endsWith("/validation"_s))
            inUse.vocabularies |= ValidationVocabulary;
        else if (name.endsWith("/format-assertion"_s))
            inUse.vocabularies |= FormatAssertionVocabulary;
    }
    if (m_isStrict && !(inUse.vocabularies & ValidationVocabulary))
        problem = { " to include the validation vocabulary (or pass { strict: false })"_s, vocabulary };
}

DialectInUse Compiler::findDialect(uint32_t data, DialectInUse inherited, Problem& problem)
{
    if (m_pool[data].kind != Kind::Object)
        return inherited;
    uint8_t standard = ValidationVocabulary | (m_assertsFormats ? FormatAssertionVocabulary : 0);
    for (auto& member : m_pool.membersOf(data)) {
        if (member.keyword != Keyword::SchemaDialect)
            continue;
        if (m_pool[member.value].kind != Kind::String) {
            problem = { " to be a string"_s, member.value };
            return inherited;
        }
        const String& name = m_pool[member.value].string;
        StringView address = name.endsWith('#') ? StringView(name).left(name.length() - 1) : StringView(name);
        if (address == "http://json-schema.org/draft-07/schema"_s || address == "http://json-schema.org/draft-06/schema"_s)
            return { Dialect::Draft7, standard };
        if (address == "https://json-schema.org/draft/2020-12/schema"_s)
            return { Dialect::Draft2020, standard };
        for (auto& document : m_pool.documents) {
            if (document.root == data || m_pool[document.root].kind != Kind::Object)
                continue;
            if (!spend(1 + name.length() + m_pool[document.root].count))
                return inherited;
            bool isNamed = document.uri == name;
            uint32_t vocabulary = none;
            for (auto& inner : m_pool.membersOf(document.root)) {
                if (inner.keyword == Keyword::Id && m_pool[inner.value].kind == Kind::String)
                    isNamed |= m_pool[inner.value].string == name;
                else if (inner.key == "$vocabulary"_s && m_pool[inner.value].kind == Kind::Object)
                    vocabulary = inner.value;
            }
            if (!isNamed)
                continue;
            if (m_dialectDepth > 4) {
                problem = { "Too many meta-schemas that name one another (limit 4)"_s };
                return inherited;
            }
            ++m_dialectDepth;
            DialectInUse result = findDialect(document.root, inherited, problem);
            --m_dialectDepth;
            if (vocabulary != none)
                readVocabularies(vocabulary, result, problem);
            return result;
        }
        if (spend(name.length()))
            problem = { makeString("Unknown $schema: "_s, name) };
        return inherited;
    }
    return inherited;
}

String Compiler::resolveURI(const String& base, const String& reference)
{
    if (!spend(base.length() + reference.length()))
        return reference;
    if (base.isEmpty()) {
        URL url { reference };
        return url.isValid() ? url.string() : reference;
    }
    URL url { URL { base }, reference };
    return url.isValid() ? url.string() : reference;
}

uint32_t Compiler::addResource(const String& uri, uint32_t root, uint32_t parent, DialectInUse inherited)
{
    uint32_t index = m_resources.size();
    Problem problem;
    DialectInUse inUse = findDialect(root, inherited, problem);
    m_resources.append(Resource { uri, root, parent, inUse, problem, {}, {} });
    if (!uri.isEmpty())
        addOnce(m_resourceByURI, uri, index);
    return index;
}

void Compiler::scanDocument(Document& document)
{
    String uri = document.uri;
    if (size_t hash = uri.find('#'); hash != notFound)
        uri = uri.left(hash);
    DialectInUse byDefault { m_defaultDialect, static_cast<uint8_t>(ValidationVocabulary | (m_assertsFormats ? FormatAssertionVocabulary : 0)) };
    uint32_t resource = addResource(resolveURI(String(), uri), document.root, none, byDefault);
    scan(document.root, resource, document.hasIdentifiers);
}

void Compiler::scan(uint32_t data, uint32_t resource, bool recurse)
{
    if (failed() || m_pool[data].kind != Kind::Object)
        return;
    if (!m_vm.isSafeToRecurse()) [[unlikely]] {
        fail(nestedTooDeeply);
        return;
    }
    Keywords at = collectKeywords(data);
    Dialect dialect = m_resources[resource].inUse.dialect;
    bool isString = AT(Id) != none && m_pool[AT(Id)].kind == Kind::String;
    if (isString && !(dialect == Dialect::Draft7 && AT(Ref) != none)) {
        const String& id = m_pool[AT(Id)].string;
        size_t hash = id.find('#');
        String address = hash == notFound ? id : id.left(hash);
        String fragment = hash == notFound ? String() : id.substring(hash + 1);
        if (!address.isEmpty()) {
            String absolute = resolveURI(m_resources[resource].uri, address);
            if (m_resources[resource].root == data) {
                m_resources[resource].uri = absolute;
                addOnce(m_resourceByURI, absolute, resource);
            } else {
                resource = addResource(absolute, data, resource, m_resources[resource].inUse);
                dialect = m_resources[resource].inUse.dialect;
            }
        }
        if (!fragment.isEmpty() && dialect == Dialect::Draft7)
            addOnce(m_resources[resource].anchors, fragment, data);
    }
    if (dialect != Dialect::Draft7) {
        if (AT(Anchor) != none && m_pool[AT(Anchor)].kind == Kind::String)
            addOnce(m_resources[resource].anchors, m_pool[AT(Anchor)].string, data);
        if (AT(DynamicAnchor) != none && m_pool[AT(DynamicAnchor)].kind == Kind::String) {
            addOnce(m_resources[resource].anchors, m_pool[AT(DynamicAnchor)].string, data);
            addOnce(m_resources[resource].dynamicAnchors, m_pool[AT(DynamicAnchor)].string, data);
        }
    }
    if (!recurse)
        return;
    for (auto& member : m_pool.membersOf(data)) {
        switch (member.keyword) {
        case Keyword::AdditionalProperties:
        case Keyword::AdditionalItems:
        case Keyword::Contains:
        case Keyword::Else:
        case Keyword::If:
        case Keyword::Not:
        case Keyword::PropertyNames:
        case Keyword::Then:
        case Keyword::UnevaluatedItems:
        case Keyword::UnevaluatedProperties:
        case Keyword::ContentSchema:
            scan(member.value, resource, true);
            break;
        case Keyword::Items:
        case Keyword::AllOf:
        case Keyword::AnyOf:
        case Keyword::OneOf:
        case Keyword::PrefixItems:
            if (m_pool[member.value].kind == Kind::Array) {
                for (uint32_t element : m_pool.elementsOf(member.value))
                    scan(element, resource, true);
            } else
                scan(member.value, resource, true);
            break;
        case Keyword::Defs:
        case Keyword::Definitions:
        case Keyword::DependentSchemas:
        case Keyword::Dependencies:
        case Keyword::PatternProperties:
        case Keyword::Properties:
            if (m_pool[member.value].kind == Kind::Object) {
                for (auto& inner : m_pool.membersOf(member.value))
                    scan(inner.value, resource, true);
            }
            break;
        default:
            break;
        }
    }
}

// Resources are sorted by root. The last one that starts at or before `data` holds it, or else one of its parents does.
uint32_t Compiler::findResource(uint32_t data) const
{
    uint32_t low = 0;
    uint32_t high = m_resources.size();
    while (high - low > 1) {
        uint32_t middle = low + (high - low) / 2;
        if (m_resources[middle].root <= data)
            low = middle;
        else
            high = middle;
    }
    while (data >= m_pool[m_resources[low].root].end && m_resources[low].parent != none)
        low = m_resources[low].parent;
    return low;
}

static String decodePercent(const String& text)
{
    if (!text.contains('%'))
        return text;
    auto utf8 = text.utf8();
    Vector<char8_t> bytes;
    auto span = utf8.span();
    for (size_t i = 0; i < span.size(); ++i) {
        if (span[i] == '%' && i + 2 < span.size() && isASCIIHexDigit(span[i + 1]) && isASCIIHexDigit(span[i + 2])) {
            bytes.append(static_cast<char8_t>(toASCIIHexValue(span[i + 1], span[i + 2])));
            i += 2;
        } else
            bytes.append(static_cast<char8_t>(span[i]));
    }
    String decoded = String::fromUTF8(bytes.span());
    return decoded.isNull() ? text : decoded;
}

uint32_t Compiler::findMember(uint32_t object, const AtomString& key)
{
    auto members = m_pool.membersOf(object);
    if (members.size() <= 16) {
        for (auto& member : members) {
            if (member.key == key)
                return member.value;
        }
        return none;
    }
    auto& byKey = m_membersByKey.ensure(object, [&] {
                                    MembersByKey map;
                                    for (auto& member : members)
                                        map.add(member.key.impl(), member.value);
                                    return map;
                                })
                      .iterator->value;
    auto found = byKey.find(key.impl());
    return found == byKey.end() ? none : found->value;
}

uint32_t Compiler::walkPointer(uint32_t from, const String& pointer)
{
    uint32_t current = from;
    unsigned position = 1;
    while (position <= pointer.length()) {
        size_t slash = pointer.find('/', position);
        unsigned tokenEnd = slash == notFound ? pointer.length() : slash;
        String token = pointer.substring(position, tokenEnd - position);
        if (token.contains('~'))
            token = makeStringByReplacingAll(makeStringByReplacingAll(token, "~1"_s, "/"_s), "~0"_s, "~"_s);
        uint32_t next = none;
        if (m_pool[current].kind == Kind::Object)
            next = findMember(current, AtomString { token });
        else if (m_pool[current].kind == Kind::Array) {
            if (auto index = parseInteger<uint32_t>(token); index && *index < m_pool[current].count)
                next = m_pool.elementsOf(current)[*index];
        }
        if (next == none)
            return none;
        current = next;
        position = tokenEnd + 1;
    }
    return current;
}

uint32_t Compiler::resolve(uint32_t from, const String& reference, uint32_t fromResource, bool* isDynamic)
{
    auto failUnknown = [&] {
        return fail(makeString("Unknown "_s, m_pool.pathTo(from), ": "_s, reference));
    };
    size_t hash = reference.find('#');
    String address = hash == notFound ? reference : reference.left(hash);
    String fragment = hash == notFound ? String() : decodePercent(reference.substring(hash + 1));
    uint32_t resource = fromResource;
    if (!address.isEmpty()) {
        String absolute = resolveURI(m_resources[fromResource].uri, address);
        if (failed())
            return none;
        auto found = m_resourceByURI.find(absolute);
        if (found == m_resourceByURI.end())
            return failUnknown();
        if (found->value == ambiguous)
            return fail(makeString("Expected every $id to be unique: "_s, absolute));
        resource = found->value;
    }
    uint32_t target = none;
    if (fragment.isEmpty())
        target = m_resources[resource].root;
    else if (fragment[0] == '/')
        target = walkPointer(m_resources[resource].root, fragment);
    else {
        auto found = m_resources[resource].anchors.find(fragment);
        if (found != m_resources[resource].anchors.end()) {
            if (found->value == ambiguous)
                return fail(makeString("Expected every $anchor to be unique: "_s, fragment));
            target = found->value;
            if (isDynamic)
                *isDynamic = m_resources[resource].dynamicAnchors.contains(fragment);
        }
    }
    return target == none ? failUnknown() : target;
}

bool Compiler::readCount(uint32_t data, uint32_t& result)
{
    const Data& value = m_pool[data];
    if (value.kind != Kind::Number || value.number < 0 || value.number != std::trunc(value.number))
        return refuse(data, "a non-negative integer"_s);
    result = value.number >= UINT32_MAX ? UINT32_MAX : static_cast<uint32_t>(value.number);
    return true;
}

uint32_t Compiler::compileRegExp(uint32_t data, ASCIILiteral place, const String& pattern)
{
    auto found = m_regExpByPattern.find(pattern);
    if (found != m_regExpByPattern.end())
        return found->value;
    RegExp* regExp = RegExp::create(m_vm, pattern, { Yarr::Flags::Unicode });
    if (!regExp->isValid())
        regExp = RegExp::create(m_vm, pattern, {});
    if (!regExp->isValid())
        return fail(makeString("Expected "_s, place, m_pool.pathTo(data), " to be a regular expression: "_s, regExp->errorMessage()));
    m_cells.append(regExp);
    uint32_t index = m_program.regExps.size();
    m_program.regExps.append(regExp);
    m_regExpByPattern.set(pattern, index);
    return index;
}

static uint8_t parseTypeName(const String& name)
{
    if (name == "string"_s)
        return StringBit;
    if (name == "number"_s)
        return NumberBit | IntegerBit;
    if (name == "integer"_s)
        return IntegerBit;
    if (name == "object"_s)
        return ObjectBit;
    if (name == "array"_s)
        return ArrayBit;
    if (name == "boolean"_s)
        return BooleanBit;
    if (name == "null"_s)
        return NullBit;
    return 0;
}

uint8_t Compiler::getTypeBit(uint32_t data) const
{
    switch (m_pool[data].kind) {
    case Kind::Null:
        return NullBit;
    case Kind::False:
    case Kind::True:
        return BooleanBit;
    case Kind::Number:
        return m_pool[data].number == std::trunc(m_pool[data].number) ? IntegerBit : NumberBit;
    case Kind::String:
        return StringBit;
    case Kind::Array:
        return ArrayBit;
    case Kind::Object:
        return ObjectBit;
    case Kind::NotJSON:
        break;
    }
    return 0;
}

uint32_t Compiler::compileList(uint32_t data, uint32_t& count)
{
    if (m_pool[data].kind != Kind::Array || !m_pool[data].count)
        return expect(data, "a non-empty array of schemas"_s);
    Vector<uint32_t, 8> compiled;
    for (uint32_t i = 0; i < m_pool[data].count; ++i) {
        uint32_t schema = compile(m_pool.elementsOf(data)[i]);
        if (schema == none)
            return none;
        compiled.append(schema);
    }
    uint32_t first = m_program.lists.size();
    m_program.lists.appendVector(compiled);
    count = compiled.size();
    return first;
}

static Op makeOp(OpCode code, uint8_t applies, Keyword keyword, uint32_t a = 0, uint32_t b = 0, uint32_t c = 0)
{
    Op op { code, applies, keyword, a, { 0 } };
    op.b = b;
    op.c = c;
    return op;
}

static Op makeNumberOp(OpCode code, Keyword keyword, double number)
{
    Op op { code, NumberBit | IntegerBit, keyword, 0, { 0 } };
    op.number = number;
    return op;
}

bool Compiler::compileObjectKeywords(const Keywords& given, DialectInUse inUse, Vector<Op, 16>& ops)
{
    bool isModern = inUse.dialect != Dialect::Draft7;
    Keywords at = given;
    if (!(inUse.vocabularies & ValidationVocabulary))
        AT(Required) = AT(MinProperties) = AT(MaxProperties) = AT(DependentRequired) = none;
    bool any = AT(Properties) != none || AT(Required) != none || AT(PatternProperties) != none || AT(AdditionalProperties) != none || AT(PropertyNames) != none
        || AT(MinProperties) != none || AT(MaxProperties) != none || AT(Dependencies) != none || (isModern && (AT(DependentRequired) != none || AT(DependentSchemas) != none));
    if (!any)
        return true;

    Vector<PropertyRule, 16> rules;
    Vector<PatternRule, 4> patterns;
    Vector<DependentRule, 4> dependents;
    ObjectNode node;

    if (AT(Properties) != none) {
        if (m_pool[AT(Properties)].kind != Kind::Object)
            return refuse(AT(Properties), "an object"_s);
        for (uint32_t i = 0; i < m_pool[AT(Properties)].count; ++i) {
            Member member = m_pool.membersOf(AT(Properties))[i];
            uint32_t schema = compile(member.value);
            if (schema == none)
                return false;
            node.ruleByKey.add(member.key.impl(), static_cast<uint32_t>(rules.size()));
            rules.append(PropertyRule { member.key, schema, false });
        }
    }
    if (AT(Required) != none) {
        if (m_pool[AT(Required)].kind != Kind::Array)
            return refuse(AT(Required), "an array of strings"_s);
        for (uint32_t element : m_pool.elementsOf(AT(Required))) {
            if (m_pool[element].kind != Kind::String)
                return refuse(element, "a string"_s);
            AtomString key { m_pool[element].string };
            auto result = node.ruleByKey.add(key.impl(), static_cast<uint32_t>(rules.size()));
            if (result.isNewEntry)
                rules.append(PropertyRule { key, none, true });
            else
                rules[result.iterator->value].required = true;
        }
    }
    if (AT(PatternProperties) != none) {
        if (m_pool[AT(PatternProperties)].kind != Kind::Object)
            return refuse(AT(PatternProperties), "an object"_s);
        for (uint32_t i = 0; i < m_pool[AT(PatternProperties)].count; ++i) {
            Member member = m_pool.membersOf(AT(PatternProperties))[i];
            uint32_t regExp = compileRegExp(AT(PatternProperties), "every key of "_s, member.key.string());
            if (regExp == none)
                return false;
            uint32_t schema = compile(member.value);
            if (schema == none)
                return false;
            patterns.append(PatternRule { regExp, schema });
        }
    }
    if (AT(AdditionalProperties) != none) {
        node.additional = compile(AT(AdditionalProperties));
        if (node.additional == none)
            return false;
    }
    if (AT(PropertyNames) != none) {
        node.propertyNames = compile(AT(PropertyNames));
        if (node.propertyNames == none)
            return false;
        if (node.propertyNames == trueSchema)
            node.propertyNames = none;
    }
    if (AT(MinProperties) != none && !readCount(AT(MinProperties), node.minProperties))
        return false;
    if (AT(MaxProperties) != none && !readCount(AT(MaxProperties), node.maxProperties))
        return false;

    auto addNames = [&](const AtomString& key, uint32_t list) -> bool {
        uint32_t first = m_program.names.size();
        for (uint32_t element : m_pool.elementsOf(list)) {
            if (m_pool[element].kind != Kind::String)
                return refuse(element, "a string"_s);
            m_program.names.append(AtomString { m_pool[element].string });
        }
        dependents.append(DependentRule { key, none, first, m_pool[list].count });
        return true;
    };
    auto addDependents = [&](uint32_t map, bool allowsNames, bool allowsSchemas) -> bool {
        if (m_pool[map].kind != Kind::Object)
            return refuse(map, "an object"_s);
        for (uint32_t i = 0; i < m_pool[map].count; ++i) {
            Member member = m_pool.membersOf(map)[i];
            if (m_pool[member.value].kind == Kind::Array) {
                if (!allowsNames)
                    return refuse(member.value, "an object or a boolean"_s);
                if (!addNames(member.key, member.value))
                    return false;
                continue;
            }
            if (!allowsSchemas)
                return refuse(member.value, "an array of strings"_s);
            uint32_t schema = compile(member.value);
            if (schema == none)
                return false;
            dependents.append(DependentRule { member.key, schema, 0, 0 });
        }
        return true;
    };
    if (AT(Dependencies) != none && !addDependents(AT(Dependencies), true, true))
        return false;
    if (isModern && AT(DependentRequired) != none && !addDependents(AT(DependentRequired), true, false))
        return false;
    if (isModern && AT(DependentSchemas) != none && !addDependents(AT(DependentSchemas), false, true))
        return false;

    node.firstRule = m_program.rules.size();
    node.ruleCount = rules.size();
    node.firstPattern = m_program.patterns.size();
    node.patternCount = patterns.size();
    node.firstDependent = m_program.dependents.size();
    node.dependentCount = dependents.size();
    m_program.rules.appendVector(WTF::move(rules));
    m_program.patterns.appendVector(patterns);
    m_program.dependents.appendVector(WTF::move(dependents));
    ops.append(makeOp(OpCode::Object, ObjectBit, Keyword::Properties, m_program.objects.size()));
    m_program.objects.append(WTF::move(node));
    return true;
}

bool Compiler::compileArrayKeywords(const Keywords& given, DialectInUse inUse, Vector<Op, 16>& ops)
{
    bool isModern = inUse.dialect == Dialect::Draft2020;
    Keywords at = given;
    if (!(inUse.vocabularies & ValidationVocabulary))
        AT(MinItems) = AT(MaxItems) = AT(UniqueItems) = AT(MinContains) = AT(MaxContains) = none;
    ArrayNode node;
    if (AT(MinItems) != none && !readCount(AT(MinItems), node.minItems))
        return false;
    if (AT(MaxItems) != none && !readCount(AT(MaxItems), node.maxItems))
        return false;
    uint32_t prefix = isModern ? AT(PrefixItems) : (AT(Items) != none && m_pool[AT(Items)].kind == Kind::Array ? AT(Items) : none);
    uint32_t rest = isModern ? AT(Items) : (prefix != none ? AT(AdditionalItems) : AT(Items));
    if (prefix != none) {
        if (m_pool[prefix].kind != Kind::Array)
            return refuse(prefix, "an array of schemas"_s);
        if (m_pool[prefix].count) {
            node.firstPrefix = compileList(prefix, node.prefixCount);
            if (node.firstPrefix == none)
                return false;
        }
    }
    if (rest != none) {
        node.rest = compile(rest);
        if (node.rest == none)
            return false;
    }
    if (node.prefixCount || node.rest != none || node.minItems || node.maxItems != UINT32_MAX) {
        ops.append(makeOp(OpCode::Items, ArrayBit, Keyword::Items, m_program.arrays.size()));
        m_program.arrays.append(node);
    }

    if (AT(Contains) != none) {
        uint32_t schema = compile(AT(Contains));
        if (schema == none)
            return false;
        uint32_t minimum = 1;
        uint32_t maximum = UINT32_MAX;
        if (isModern && AT(MinContains) != none && !readCount(AT(MinContains), minimum))
            return false;
        if (isModern && AT(MaxContains) != none && !readCount(AT(MaxContains), maximum))
            return false;
        ops.append(makeOp(OpCode::Contains, ArrayBit, Keyword::Contains, schema, minimum, maximum));
    }
    if (AT(UniqueItems) != none) {
        if (m_pool[AT(UniqueItems)].kind == Kind::True)
            ops.append(makeOp(OpCode::UniqueItems, ArrayBit, Keyword::UniqueItems));
        else if (m_pool[AT(UniqueItems)].kind != Kind::False)
            return refuse(AT(UniqueItems), "a boolean"_s);
    }
    return true;
}

static bool isAnnotation(const AtomString& key)
{
    static constexpr ASCIILiteral annotations[] = { "description"_s, "default"_s, "examples"_s, "$comment"_s, "deprecated"_s, "readOnly"_s, "writeOnly"_s,
        "contentEncoding"_s, "contentMediaType"_s, "$vocabulary"_s };
    for (auto& annotation : annotations) {
        if (key == annotation)
            return true;
    }
    return key.startsWith("x-"_s);
}

// Strict mode refuses every keyword that would be ignored.
bool Compiler::checkNoKeywordIsIgnored(uint32_t data, const Keywords& at, uint32_t resource)
{
    bool isModern = m_resources[resource].inUse.dialect == Dialect::Draft2020;
    bool isBesideReference = !isModern && AT(Ref) != none;
    auto requireBeside = [&](const Member& member, ASCIILiteral other) {
        fail("Expected "_s, member.value, other);
        return false;
    };
    auto refuseInDialect = [&](const Member& member) {
        fail(isModern ? "Unknown draft 2020-12 keyword: "_s : "Unknown draft-07 keyword: "_s, member.value);
        return false;
    };
    for (auto& member : m_pool.membersOf(data)) {
        switch (member.keyword) {
        case Keyword::Unknown:
            if (!isAnnotation(member.key)) {
                fail("Unknown keyword: "_s, member.value);
                return false;
            }
            continue;
        case Keyword::Ref:
        case Keyword::Id:
        case Keyword::Defs:
        case Keyword::Definitions:
        case Keyword::Title:
        case Keyword::Extension:
        case Keyword::ContentSchema:
            continue;
        case Keyword::SchemaDialect:
            if (m_resources[resource].root != data)
                return requireBeside(member, " to be at the root of a schema or beside $id"_s);
            continue;
        case Keyword::Anchor:
        case Keyword::DynamicRef:
        case Keyword::DynamicAnchor:
        case Keyword::PrefixItems:
        case Keyword::DependentRequired:
        case Keyword::DependentSchemas:
        case Keyword::UnevaluatedProperties:
        case Keyword::UnevaluatedItems:
            if (!isModern)
                return refuseInDialect(member);
            break;
        case Keyword::MinContains:
        case Keyword::MaxContains:
            if (!isModern)
                return refuseInDialect(member);
            if (AT(Contains) == none)
                return requireBeside(member, " to be beside contains"_s);
            break;
        case Keyword::AdditionalItems:
            if (isModern)
                return refuseInDialect(member);
            if (AT(Items) == none || m_pool[AT(Items)].kind != Kind::Array)
                return requireBeside(member, " to be beside items that is an array"_s);
            break;
        case Keyword::Then:
        case Keyword::Else:
            if (AT(If) == none)
                return requireBeside(member, " to be beside if"_s);
            break;
        case Keyword::Nullable:
            if (AT(Type) == none)
                return requireBeside(member, " to be beside type"_s);
            break;
        default:
            break;
        }
        if (isBesideReference)
            return requireBeside(member, " not to be beside $ref (draft-07 ignores it there)"_s);
    }
    return true;
}

uint32_t Compiler::compile(uint32_t data)
{
    if (failed())
        return none;
    switch (m_pool[data].kind) {
    case Kind::True:
        return trueSchema;
    case Kind::False:
        return falseSchema;
    case Kind::Object:
        break;
    default:
        return expect(data, "an object or a boolean"_s);
    }
    if (!m_pool[data].count)
        return trueSchema;
    if (auto found = m_compiled.find(data); found != m_compiled.end())
        return found->value;
    if (!m_vm.isSafeToRecurse()) [[unlikely]]
        return fail(nestedTooDeeply);

    uint32_t index = m_program.schemas.size();
    m_program.schemas.append(Schema {});
    m_compiled.add(data, index);

    Keywords at = collectKeywords(data);
    uint32_t resource = findResource(data);
    if (const Problem& problem = m_resources[resource].problem; !problem.text.isNull())
        return problem.place == none ? fail(problem.text) : fail(makeString("Expected "_s, m_pool.pathTo(problem.place), problem.text));
    for (uint32_t name : { AT(Id), AT(Anchor), AT(DynamicAnchor) }) {
        if (name != none && m_pool[name].kind != Kind::String)
            return expect(name, "a string"_s);
    }
    if (m_isStrict && !checkNoKeywordIsIgnored(data, at, resource))
        return none;
    DialectInUse inUse = m_resources[resource].inUse;
    bool isModern = inUse.dialect != Dialect::Draft7;
    if (!(inUse.vocabularies & ValidationVocabulary)) {
        AT(Type) = AT(Enum) = AT(Const) = AT(MultipleOf) = AT(Maximum) = AT(ExclusiveMaximum) = AT(Minimum) = AT(ExclusiveMinimum) = none;
        AT(MaxLength) = AT(MinLength) = AT(Pattern) = none;
    }
    Vector<Op, 16> ops;
    uint8_t types = EveryJSONType;
    bool hasType = false;

    auto finish = [&]() -> uint32_t {
        // A schema of annotations, allOf, anyOf, oneOf and $ref alone says nothing of its own: its branches decide about what JSON cannot hold, as under `{}`.
        bool hasOnlyApplicators = !hasType && types == EveryJSONType;
        for (auto& op : ops)
            hasOnlyApplicators &= op.code == OpCode::AllOf || op.code == OpCode::AnyOf || op.code == OpCode::OneOf || op.code == OpCode::Ref;
        Schema& schema = m_program.schemas[index];
        schema.types = hasOnlyApplicators ? EveryType : types;
        schema.hasTitleOrExtension = AT(Title) != none || AT(Extension) != none;
        schema.firstOp = m_program.ops.size();
        schema.opCount = ops.size();
        schema.data = data;
        m_program.ops.appendVector(ops);
        return index;
    };

    auto compileRef = [&](uint32_t where, bool* isDynamic) -> bool {
        if (m_pool[where].kind != Kind::String)
            return refuse(where, "a string"_s);
        uint32_t target = resolve(where, m_pool[where].string, resource, isDynamic);
        if (target == none)
            return false;
        uint32_t schema = compile(target);
        if (schema == none)
            return false;
        ops.append(makeOp(OpCode::Ref, EveryType, Keyword::Ref, schema));
        return true;
    };

    if (!isModern && AT(Ref) != none) {
        if (!compileRef(AT(Ref), nullptr))
            return none;
        return finish();
    }

    if (isModern) {
        for (uint32_t unsupported : { AT(UnevaluatedProperties), AT(UnevaluatedItems) }) {
            if (unsupported != none)
                return fail("Unsupported keyword: "_s, unsupported);
        }
    }

    if (AT(Type) != none) {
        uint8_t bits = 0;
        if (m_pool[AT(Type)].kind == Kind::String)
            bits = parseTypeName(m_pool[AT(Type)].string);
        else if (m_pool[AT(Type)].kind == Kind::Array) {
            for (uint32_t element : m_pool.elementsOf(AT(Type))) {
                uint8_t bit = m_pool[element].kind == Kind::String ? parseTypeName(m_pool[element].string) : 0;
                if (!bit)
                    return expect(element, "\"string\", \"number\", \"integer\", \"boolean\", \"null\", \"array\" or \"object\""_s);
                bits |= bit;
            }
        }
        if (!bits)
            return expect(AT(Type), "\"string\", \"number\", \"integer\", \"boolean\", \"null\", \"array\" or \"object\", or an array of those"_s);
        if (AT(Nullable) != none) {
            if (m_pool[AT(Nullable)].kind == Kind::True)
                bits |= NullBit;
            else if (m_pool[AT(Nullable)].kind != Kind::False)
                return expect(AT(Nullable), "a boolean"_s);
        }
        types = bits;
        hasType = true;
    }

    auto numberOp = [&](uint32_t where, OpCode code, Keyword keyword) -> bool {
        if (where == none)
            return true;
        if (m_pool[where].kind != Kind::Number)
            return refuse(where, "a number"_s);
        ops.append(makeNumberOp(code, keyword, m_pool[where].number));
        return true;
    };
    if (!numberOp(AT(Minimum), OpCode::Minimum, Keyword::Minimum) || !numberOp(AT(Maximum), OpCode::Maximum, Keyword::Maximum)
        || !numberOp(AT(ExclusiveMinimum), OpCode::ExclusiveMinimum, Keyword::ExclusiveMinimum) || !numberOp(AT(ExclusiveMaximum), OpCode::ExclusiveMaximum, Keyword::ExclusiveMaximum)
        || !numberOp(AT(MultipleOf), OpCode::MultipleOf, Keyword::MultipleOf))
        return none;
    if (AT(MultipleOf) != none && !(m_pool[AT(MultipleOf)].number > 0))
        return expect(AT(MultipleOf), "greater than 0"_s);

    uint32_t count = 0;
    if (AT(MinLength) != none) {
        if (!readCount(AT(MinLength), count))
            return none;
        if (count)
            ops.append(makeOp(OpCode::MinLength, StringBit, Keyword::MinLength, count));
    }
    if (AT(MaxLength) != none) {
        if (!readCount(AT(MaxLength), count))
            return none;
        ops.append(makeOp(OpCode::MaxLength, StringBit, Keyword::MaxLength, count));
    }
    if (AT(Pattern) != none) {
        if (m_pool[AT(Pattern)].kind != Kind::String)
            return expect(AT(Pattern), "a string"_s);
        uint32_t regExp = compileRegExp(AT(Pattern), ""_s, m_pool[AT(Pattern)].string);
        if (regExp == none)
            return none;
        ops.append(makeOp(OpCode::Pattern, StringBit, Keyword::Pattern, regExp));
    }
    if (AT(Format) != none) {
        if (m_pool[AT(Format)].kind != Kind::String)
            return expect(AT(Format), "a string"_s);
        if (inUse.vocabularies & FormatAssertionVocabulary) {
            if (auto format = formatNamed(m_pool[AT(Format)].string))
                ops.append(makeOp(OpCode::Format, StringBit, Keyword::Format, static_cast<uint32_t>(*format)));
            else if (m_isStrict)
                return fail(makeString("Unknown format: "_s, m_pool[AT(Format)].string));
        }
    }

    if (AT(Const) != none || AT(Enum) != none) {
        auto constants = [&](Keyword keyword, std::span<const uint32_t> values) {
            uint8_t mask = 0;
            bool allStrings = true;
            bool needsComparison = false;
            for (uint32_t value : values) {
                mask |= getTypeBit(value);
                allStrings &= m_pool[value].kind == Kind::String;
                needsComparison |= m_pool[value].kind != Kind::Null;
            }
            types &= mask;
            if (!needsComparison)
                return;
            for (uint32_t value : values) {
                if (m_pool[value].kind == Kind::String)
                    m_pool.values[value].string = AtomString(m_pool[value].string).string();
            }
            uint32_t first = m_program.lists.size();
            m_program.lists.append(values);
            ops.append(makeOp(allStrings ? OpCode::StringEnum : OpCode::Enum, mask & ~NullBit, keyword, first, values.size()));
        };
        if (AT(Const) != none) {
            uint32_t value = AT(Const);
            constants(Keyword::Const, std::span { &value, 1 });
        }
        if (AT(Enum) != none) {
            if (m_pool[AT(Enum)].kind != Kind::Array)
                return expect(AT(Enum), "an array"_s);
            Vector<uint32_t, 16> values { m_pool.elementsOf(AT(Enum)) };
            constants(Keyword::Enum, values.span());
        }
    }

    if (!compileArrayKeywords(at, inUse, ops) || !compileObjectKeywords(at, inUse, ops))
        return none;

    if (AT(Ref) != none && !compileRef(AT(Ref), nullptr))
        return none;
    if (isModern && AT(DynamicRef) != none) {
        bool isDynamic = false;
        if (!compileRef(AT(DynamicRef), &isDynamic))
            return none;
        if (isDynamic)
            return fail("Unsupported keyword: "_s, AT(DynamicRef));
    }

    auto listOp = [&](uint32_t where, OpCode code, Keyword keyword) -> bool {
        if (where == none)
            return true;
        uint32_t length = 0;
        uint32_t first = compileList(where, length);
        if (first == none)
            return false;
        ops.append(makeOp(code, EveryType, keyword, first, length));
        return true;
    };
    if (!listOp(AT(AllOf), OpCode::AllOf, Keyword::AllOf))
        return none;
    if (AT(If) != none) {
        uint32_t condition = compile(AT(If));
        uint32_t consequent = AT(Then) != none ? compile(AT(Then)) : none;
        uint32_t alternative = AT(Else) != none ? compile(AT(Else)) : none;
        if (failed())
            return none;
        ops.append(makeOp(OpCode::If, EveryType, Keyword::If, condition, consequent, alternative));
    }
    if (!listOp(AT(AnyOf), OpCode::AnyOf, Keyword::AnyOf) || !listOp(AT(OneOf), OpCode::OneOf, Keyword::OneOf))
        return none;
    if (AT(Not) != none) {
        uint32_t schema = compile(AT(Not));
        if (schema == none)
            return none;
        ops.append(makeOp(OpCode::Not, EveryType, Keyword::Not, schema));
    }
    return finish();
}

// A schema that is only a "$ref" is replaced by its target.
void Compiler::collapseReferences()
{
    auto collapse = [&](uint32_t& index) {
        for (unsigned steps = 0; steps < 32 && index != none; ++steps) {
            const Schema& schema = m_program.schemas[index];
            if (schema.opCount != 1 || schema.types != EveryType || schema.hasTitleOrExtension || m_program.ops[schema.firstOp].code != OpCode::Ref)
                return;
            index = m_program.ops[schema.firstOp].a;
        }
    };
    for (auto& op : m_program.ops) {
        switch (op.code) {
        case OpCode::Ref:
        case OpCode::Not:
        case OpCode::Contains:
            collapse(op.a);
            break;
        case OpCode::If:
            collapse(op.a);
            collapse(op.b);
            collapse(op.c);
            break;
        case OpCode::AllOf:
        case OpCode::AnyOf:
        case OpCode::OneOf:
            for (uint32_t i = 0; i < op.b; ++i)
                collapse(m_program.lists[op.a + i]);
            break;
        default:
            break;
        }
    }
    for (auto& rule : m_program.rules)
        collapse(rule.schema);
    for (auto& pattern : m_program.patterns)
        collapse(pattern.schema);
    for (auto& dependent : m_program.dependents)
        collapse(dependent.schema);
    for (auto& node : m_program.objects) {
        collapse(node.additional);
        collapse(node.propertyNames);
    }
    for (auto& node : m_program.arrays) {
        collapse(node.rest);
        for (uint32_t i = 0; i < node.prefixCount; ++i)
            collapse(m_program.lists[node.firstPrefix + i]);
    }
    collapse(m_program.root);
}

// oneOf is anyOf when every branch takes only objects and requires one property to be a string that no other branch allows.
void Compiler::simplifyOneOf()
{
    static constexpr uint64_t maxSearchSteps = 1 << 22;
    uint64_t steps = 0;
    auto objectNodeOf = [&](uint32_t index) -> const ObjectNode* {
        const Schema& schema = m_program.schemas[index];
        for (uint32_t i = 0; i < schema.opCount; ++i) {
            const Op& op = m_program.ops[schema.firstOp + i];
            if (op.code == OpCode::Object)
                return &m_program.objects[op.a];
        }
        return nullptr;
    };
    auto tagsOf = [&](uint32_t index, const AtomString& key) -> const Op* {
        const ObjectNode* node = m_program.schemas[index].types == ObjectBit ? objectNodeOf(index) : nullptr;
        if (!node)
            return nullptr;
        auto found = node->ruleByKey.find(key.impl());
        if (found == node->ruleByKey.end())
            return nullptr;
        const PropertyRule& rule = m_program.rules[node->firstRule + found->value];
        if (!rule.required || rule.schema == none)
            return nullptr;
        const Schema& property = m_program.schemas[rule.schema];
        if (property.types != StringBit || property.opCount != 1 || property.hasTitleOrExtension)
            return nullptr;
        const Op& op = m_program.ops[property.firstOp];
        return op.code == OpCode::StringEnum ? &op : nullptr;
    };
    for (auto& op : m_program.ops) {
        if (op.code != OpCode::OneOf || op.b < 2)
            continue;
        const ObjectNode* first = objectNodeOf(m_program.lists[op.a]);
        if (!first)
            continue;
        for (uint32_t i = 0; i < first->ruleCount; ++i) {
            const AtomString& key = m_program.rules[first->firstRule + i].key;
            HashSet<const StringImpl*> seen;
            bool isExclusive = true;
            for (uint32_t branch = 0; branch < op.b && isExclusive; ++branch) {
                const Op* tags = tagsOf(m_program.lists[op.a + branch], key);
                steps += 1 + (tags ? tags->b : 0);
                isExclusive = !!tags;
                for (uint32_t j = 0; isExclusive && j < tags->b; ++j)
                    isExclusive = seen.add(m_pool[m_program.lists[tags->a + j]].string.impl()).isNewEntry;
            }
            if (steps > maxSearchSteps)
                return;
            if (isExclusive) {
                op.code = OpCode::AnyOf;
                break;
            }
        }
    }
}

bool Compiler::run()
{
    m_program.schemas.append(Schema {});
    Schema never;
    never.types = 0;
    m_program.schemas.append(never);

    for (auto& document : m_pool.documents)
        scanDocument(document);
    if (failed())
        return false;
    m_program.root = compile(m_pool.documents[0].root);
    if (failed())
        return false;
    collapseReferences();
    simplifyOneOf();
    return true;
}

#undef AT

struct ReaderOptions {
    Dialect dialect { Dialect::Draft2020 };
    bool assertsFormats { true };
    bool isStrict { true };
    JSValue schemas;
};

static bool readOptions(JSGlobalObject* globalObject, JSValue value, ReaderOptions& options)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (value.isUndefinedOrNull())
        return true;
    if (!isPlainObject(value)) {
        throwTypeError(globalObject, scope, "Expected options to be an object"_s);
        return false;
    }
    JSObject* object = asObject(value);
    PropertyNameArrayBuilder names(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
    object->methodTable()->getOwnPropertyNames(object, globalObject, names, DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(scope, false);
    for (auto& name : names) {
        JSValue option = object->get(globalObject, name);
        RETURN_IF_EXCEPTION(scope, false);
        if (option.isUndefined())
            continue;
        bool* flag = name.string() == "formats"_s ? &options.assertsFormats : name.string() == "strict"_s ? &options.isStrict
                                                                                                          : nullptr;
        if (flag) {
            if (!option.isBoolean()) {
                throwTypeError(globalObject, scope, makeString("Expected options."_s, name.string(), " to be a boolean"_s));
                return false;
            }
            *flag = option.asBoolean();
        } else if (name.string() == "draft"_s) {
            bool isKnown = option.isString();
            if (isKnown) {
                String draft = asString(option)->value(globalObject);
                RETURN_IF_EXCEPTION(scope, false);
                isKnown = draft == "2020-12"_s || draft == "draft-07"_s;
                if (draft == "draft-07"_s)
                    options.dialect = Dialect::Draft7;
            }
            if (!isKnown) {
                throwTypeError(globalObject, scope, "Expected options.draft to be \"2020-12\" or \"draft-07\""_s);
                return false;
            }
        } else if (name.string() == "schemas"_s)
            options.schemas = option;
        else {
            throwTypeError(globalObject, scope, makeString("Unknown option: "_s, name.string()));
            return false;
        }
    }
    return true;
}

// An array of schemas that have an "$id", or an object whose keys are their URIs.
static void importOtherSchemas(JSGlobalObject* globalObject, Importer& importer, JSValue schemas)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!schemas || schemas.isNull())
        return;
    if (!isJSArray(schemas) && !isPlainObject(schemas)) {
        throwTypeError(globalObject, scope, "Expected options.schemas to be an array or an object"_s);
        return;
    }
    JSObject* object = asObject(schemas);
    if (isJSArray(object)) {
        unsigned length = asArray(object)->length();
        for (unsigned i = 0; i < length; ++i) {
            JSValue schema = object->getIndex(globalObject, i);
            RETURN_IF_EXCEPTION(scope, );
            importer.importDocument(schema, String());
            RETURN_IF_EXCEPTION(scope, );
        }
        return;
    }
    PropertyNameArrayBuilder names(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
    object->methodTable()->getOwnPropertyNames(object, globalObject, names, DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(scope, );
    for (auto& name : names) {
        JSValue schema = object->get(globalObject, name);
        RETURN_IF_EXCEPTION(scope, );
        importer.importDocument(schema, name.string());
        RETURN_IF_EXCEPTION(scope, );
    }
}

} // namespace Bun::JSONSchema

namespace Bun {

std::optional<ValidatorNodes> readJSONSchema(JSC::JSGlobalObject* globalObject, JSC::JSValue schema, JSC::JSValue optionsValue)
{
    using namespace JSC;
    using namespace JSONSchema;
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    ReaderOptions options;
    bool hasOptions = readOptions(globalObject, optionsValue, options);
    RETURN_IF_EXCEPTION(scope, std::nullopt);
    ASSERT_UNUSED(hasOptions, hasOptions);

    Program program;
    Importer importer(vm, globalObject, program.pool);
    importer.importDocument(schema, String());
    RETURN_IF_EXCEPTION(scope, std::nullopt);
    importOtherSchemas(globalObject, importer, options.schemas);
    RETURN_IF_EXCEPTION(scope, std::nullopt);

    MarkedArgumentBuffer cells;
    Compiler compiler(vm, program, cells, options.dialect, options.assertsFormats, options.isStrict);
    if (!compiler.run()) {
        throwTypeError(globalObject, scope, compiler.error());
        return std::nullopt;
    }
    if (program.pool.firstNotJSON != none) {
        throwTypeError(globalObject, scope, makeString("Expected "_s, program.pool.pathTo(program.pool.firstNotJSON), " to be plain JSON data"_s));
        return std::nullopt;
    }

    setValidationFormatChecker([](VM& vm, unsigned format, StringView text) {
        return matchesFormat(vm, static_cast<JSONSchema::Format>(format), text);
    });
    RELEASE_AND_RETURN(scope, writeNodes(globalObject, program));
}

} // namespace Bun
