#include "root.h"

#include "JSONSchemaValidator.h"
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/YarrFlags.h>
#include <wtf/SetForScope.h>
#include <wtf/text/MakeString.h>
#include <wtf/text/StringBuilder.h>

namespace Bun::JSONSchema {

using namespace JSC;
using namespace WTF;

using Plan = JSC::ValidationPlan;
using Shape = Plan::Shape;
using RuleKind = Plan::RuleKind;

// Writes a compiled schema as validation nodes.
class NodeWriter {
public:
    NodeWriter(VM& vm, const Program& program)
        : m_vm(vm)
        , m_program(program)
        , m_pool(program.pool)
        , m_plan(Plan::create())
    {
        m_nodeBySchema.fill(none, program.schemas.size());
        m_unknown = add(Shape::Unknown);
    }

    std::optional<ValidatorNodes> run()
    {
        m_plan->root = writeNode(m_program.root);
        m_plan->treatsUndefinedAsMissing = !m_isTypeScript;
        if (m_isTypeScript && !failed())
            markMembersThatMustBeOwn();
        m_visits.fill(Visit::New, m_plan->nodes.size());
        for (uint32_t i = 0; i < m_plan->nodes.size() && !failed(); ++i)
            refuseLoops(i);
        if (failed())
            return std::nullopt;
        return ValidatorNodes { WTF::move(m_plan), WTF::move(m_titles), WTF::move(m_messages) };
    }

    const String& error() const { return m_error; }

private:
    static constexpr uint32_t maxNodes = 1 << 18;
    static constexpr unsigned maxDepth = 1024;

    bool failed() const { return !m_error.isNull(); }

    // Returns a node, so that callers need no special case. The nodes of a failed run are thrown away.
    uint32_t fail(const String& message)
    {
        if (!failed())
            m_error = message;
        return 0;
    }

    uint32_t fail(ASCIILiteral prefix, uint32_t data, ASCIILiteral suffix = ""_s)
    {
        return failed() ? 0 : fail(makeString(prefix, m_pool.pathTo(data), suffix));
    }

    void expect(uint32_t data, ASCIILiteral what)
    {
        if (!failed())
            fail(makeString("Expected "_s, m_pool.pathTo(data), " to be "_s, what));
    }

    bool canGoDeeper()
    {
        if (m_depth <= maxDepth && m_vm.isSafeToRecurse()) [[likely]]
            return true;
        fail("Schema is nested too deeply"_s);
        return false;
    }

    uint32_t add(Shape shape)
    {
        if (m_plan->nodes.size() >= maxNodes)
            return fail("Too many subschemas in schema (limit 262144)"_s);
        m_plan->nodes.append(Plan::Node {});
        m_plan->nodes.last().shape = shape;
        m_titles.append(String());
        m_messages.append(String());
        m_dataByNode.append(m_currentData);
        return m_plan->nodes.size() - 1;
    }

    Plan::Node& at(uint32_t index) { return m_plan->nodes[index]; }

    static Plan::Rule makeRule(RuleKind kind, double number = 0, uint32_t count = 0)
    {
        Plan::Rule result;
        result.kind = kind;
        result.number = number;
        result.count = count;
        return result;
    }

    static Plan::Rule makeRuleOverNode(RuleKind kind, uint32_t node)
    {
        Plan::Rule result = makeRule(kind);
        result.nodes.append(node);
        return result;
    }

    Plan::Rule makeRuleOverSchemas(RuleKind kind, std::span<const uint32_t> schemas)
    {
        Plan::Rule result = makeRule(kind);
        for (uint32_t schema : schemas)
            result.nodes.append(schema == none ? m_unknown : writeNode(schema));
        return result;
    }

    uint32_t writeUnion(Vector<uint32_t>&& arms)
    {
        uint32_t index = add(Shape::Union);
        at(index).children = WTF::move(arms);
        return index;
    }

    Vector<uint32_t> writeNodeList(std::span<const uint32_t> schemas)
    {
        Vector<uint32_t> nodes;
        for (uint32_t schema : schemas)
            nodes.append(writeNode(schema));
        return nodes;
    }

    uint32_t writeLiteral(const Data& constant)
    {
        SetForScope depth(m_depth, m_depth + 1);
        if (failed() || !canGoDeeper())
            return 0;
        uint32_t index;
        switch (constant.kind) {
        case Kind::Null:
            return add(Shape::Null);
        case Kind::False:
        case Kind::True:
            index = add(Shape::BooleanLiteral);
            at(index).boolean = constant.kind == Kind::True;
            return index;
        case Kind::Number:
            index = add(Shape::NumberLiteral);
            at(index).number = constant.number;
            return index;
        case Kind::String:
            index = add(Shape::StringLiteral);
            at(index).string = constant.string;
            return index;
        case Kind::Array: {
            Vector<uint32_t> children;
            for (uint32_t i = 0; i < constant.count; ++i)
                children.append(writeLiteral(m_pool[m_pool.elements[constant.first + i]]));
            index = add(Shape::Tuple);
            at(index).required = children.size();
            at(index).children = WTF::move(children);
            return index;
        }
        case Kind::Object: {
            Vector<Plan::Member> members;
            for (uint32_t i = 0; i < constant.count; ++i) {
                const Member& member = m_pool.members[constant.first + i];
                members.append(Plan::Member { member.key, writeLiteral(m_pool[member.value]), false });
            }
            index = add(Shape::Object);
            at(index).undeclared = Plan::Undeclared::Rejected;
            at(index).members = WTF::move(members);
            return index;
        }
        case Kind::NotJSON:
            break;
        }
        return fail("Expected every constant in schema to be plain JSON data"_s);
    }

    static uint8_t getTypeBit(const Data& constant)
    {
        switch (constant.kind) {
        case Kind::Null:
            return NullBit;
        case Kind::False:
        case Kind::True:
            return BooleanBit;
        case Kind::Number:
            return constant.number == std::trunc(constant.number) ? IntegerBit : NumberBit;
        case Kind::String:
            return StringBit;
        case Kind::Array:
            return ArrayBit;
        case Kind::Object:
            return ObjectBit;
        case Kind::NotJSON:
            break;
        }
        return OtherBit;
    }

    uint32_t findKeyword(uint32_t data, Keyword keyword) const
    {
        for (auto& member : m_pool.membersOf(data)) {
            if (member.keyword == keyword)
                return member.value;
        }
        return data;
    }

    static bool isListOfConstants(const Op& op) { return op.code == OpCode::Enum || op.code == OpCode::StringEnum; }

    Vector<uint32_t> writeLiterals(const Op& constants, uint8_t types)
    {
        Vector<uint32_t> literals;
        for (uint32_t i = 0; i < constants.b; ++i) {
            const Data& constant = m_pool[m_program.lists[constants.a + i]];
            if (getTypeBit(constant) & types)
                literals.append(writeLiteral(constant));
        }
        return literals;
    }

    void fillObject(uint32_t index, const ObjectNode& object)
    {
        bool restrictsAdditional = object.additional != none && object.additional != trueSchema;
        // A key that is only required is an undeclared key: patternProperties and additionalProperties apply to it.
        // Members skip additionalProperties, so with patterns such a key is required by a node of its own.
        bool separatesRequiredKeys = restrictsAdditional && object.patternCount;
        Vector<Plan::Member> members;
        Vector<Plan::Member> requiredKeys;
        for (uint32_t i = 0; i < object.ruleCount; ++i) {
            const PropertyRule& one = m_program.rules[object.firstRule + i];
            if (one.schema != none)
                members.append(Plan::Member { one.key, writeNode(one.schema), !one.required });
            else if (separatesRequiredKeys)
                requiredKeys.append(Plan::Member { one.key, m_unknown, false });
            else
                members.append(Plan::Member { one.key, restrictsAdditional ? writeNode(object.additional) : m_unknown, false });
        }
        Vector<Plan::Rule> rules;
        if (object.minProperties)
            rules.append(makeRule(RuleKind::MinimumMembers, 0, object.minProperties));
        if (object.maxProperties != UINT32_MAX)
            rules.append(makeRule(RuleKind::MaximumMembers, 0, object.maxProperties));
        for (uint32_t i = 0; i < object.dependentCount; ++i) {
            const DependentRule& dependent = m_program.dependents[object.firstDependent + i];
            Plan::Rule one = makeRule(dependent.schema != none ? RuleKind::DependentNode : RuleKind::DependentMembers);
            one.text = dependent.key.string();
            if (dependent.schema != none)
                one.nodes.append(writeNode(dependent.schema));
            else {
                for (uint32_t j = 0; j < dependent.nameCount; ++j)
                    one.texts.append(m_program.names[dependent.firstName + j].string());
            }
            rules.append(WTF::move(one));
        }
        if (object.propertyNames != none)
            rules.append(makeRuleOverSchemas(RuleKind::MemberNames, std::span { &object.propertyNames, 1 }));
        if (!requiredKeys.isEmpty()) {
            uint32_t holder = add(Shape::Object);
            at(holder).members = WTF::move(requiredKeys);
            rules.append(makeRuleOverNode(RuleKind::Every, holder));
        }

        // One rule has one set of flags: [0] has the patterns that are valid with the "u" flag, [1] the others.
        Plan::Rule patterns[2] = { makeRule(RuleKind::PatternMembers), makeRule(RuleKind::PatternMembers) };
        for (uint32_t i = 0; i < object.patternCount; ++i) {
            const PatternRule& pattern = m_program.patterns[object.firstPattern + i];
            RegExp* regExp = m_program.regExps[pattern.regExp];
            Plan::Rule& group = patterns[regExp->flags().isEmpty()];
            group.flags = regExp->flags().toRaw();
            group.texts.append(regExp->pattern());
            group.nodes.append(writeNode(pattern.schema));
        }
        bool hasBothGroups = !patterns[0].nodes.isEmpty() && !patterns[1].nodes.isEmpty();
        if (hasBothGroups && restrictsAdditional)
            fail("Expected every key of "_s, findKeyword(m_currentData, Keyword::PatternProperties), " to be valid with the \"u\" flag, or none of them, beside additionalProperties"_s);
        else if (hasBothGroups) {
            uint32_t holder = add(Shape::Dictionary);
            at(holder).child = m_unknown;
            at(holder).rules.append(WTF::move(patterns[1]));
            rules.append(makeRuleOverNode(RuleKind::Every, holder));
        }
        if (object.patternCount)
            rules.append(WTF::move(patterns[patterns[0].nodes.isEmpty()]));

        uint32_t child = none;
        auto undeclared = Plan::Undeclared::Allowed;
        if (object.additional == falseSchema)
            undeclared = Plan::Undeclared::Rejected;
        else if (restrictsAdditional) {
            undeclared = Plan::Undeclared::Validated;
            child = writeNode(object.additional);
        }
        Plan::Node& node = at(index);
        if (members.isEmpty() && undeclared != Plan::Undeclared::Rejected) {
            node.shape = Shape::Dictionary;
            node.child = child == none ? m_unknown : child;
        } else {
            node.shape = Shape::Object;
            node.members = WTF::move(members);
            node.undeclared = undeclared;
            node.child = child;
        }
        node.rules.appendVector(WTF::move(rules));
    }

    void fillArray(uint32_t index, const ArrayNode& array)
    {
        Vector<uint32_t> children = writeNodeList(m_program.lists.span().subspan(array.firstPrefix, array.prefixCount));
        uint32_t rest = array.rest == none ? m_unknown : array.rest == falseSchema && array.prefixCount ? none
                                                                                                        : writeNode(array.rest);
        Plan::Node& node = at(index);
        node.shape = array.prefixCount ? Shape::Tuple : Shape::Array;
        node.required = std::min(array.minItems, array.prefixCount);
        node.children = WTF::move(children);
        node.child = rest;
        if (array.minItems > array.prefixCount)
            node.rules.append(makeRule(RuleKind::MinimumLength, 0, array.minItems));
        if (array.maxItems != UINT32_MAX)
            node.rules.append(makeRule(RuleKind::MaximumLength, 0, array.maxItems));
    }

    // What the schema says about values of one type.
    uint32_t writeNodeForType(const Schema& schema, uint8_t family)
    {
        std::span<const Op> ops = m_program.ops.span().subspan(schema.firstOp, schema.opCount);
        uint32_t index;
        switch (family) {
        case NullBit:
            return add(Shape::Null);
        case BooleanBit:
            return add(Shape::Boolean);
        case StringBit:
            index = add(Shape::String);
            break;
        case NumberBit:
            index = add(Shape::Number);
            if (!(schema.types & NumberBit))
                at(index).rules.append(makeRule(RuleKind::Integer));
            break;
        case ArrayBit:
            index = add(Shape::Array);
            at(index).child = m_unknown;
            break;
        default:
            index = add(Shape::Dictionary);
            at(index).child = m_unknown;
            break;
        }
        uint8_t bits = family == NumberBit ? NumberBit | IntegerBit : family;
        for (const Op& op : ops) {
            if (!(op.applies & bits) || op.applies == EveryType || isListOfConstants(op))
                continue;
            switch (op.code) {
            case OpCode::Minimum:
                at(index).rules.append(makeRule(RuleKind::Minimum, op.number));
                break;
            case OpCode::Maximum:
                at(index).rules.append(makeRule(RuleKind::Maximum, op.number));
                break;
            case OpCode::ExclusiveMinimum:
                at(index).rules.append(makeRule(RuleKind::ExclusiveMinimum, op.number));
                break;
            case OpCode::ExclusiveMaximum:
                at(index).rules.append(makeRule(RuleKind::ExclusiveMaximum, op.number));
                break;
            case OpCode::MultipleOf:
                at(index).rules.append(makeRule(RuleKind::MultipleOf, op.number));
                at(index).rules.last().flags = Plan::compareAsDecimals;
                break;
            case OpCode::MinLength:
                at(index).rules.append(makeRule(RuleKind::MinimumLength, 0, op.a));
                break;
            case OpCode::MaxLength:
                at(index).rules.append(makeRule(RuleKind::MaximumLength, 0, op.a));
                break;
            case OpCode::Pattern: {
                Plan::Rule pattern = makeRule(RuleKind::Pattern);
                pattern.text = m_program.regExps[op.a]->pattern();
                pattern.flags = m_program.regExps[op.a]->flags().toRaw();
                at(index).rules.append(WTF::move(pattern));
                break;
            }
            case OpCode::Format:
                if (static_cast<Format>(op.a) == Format::URL)
                    at(index).rules.append(makeRule(RuleKind::Url));
                else
                    at(index).rules.append(makeRule(RuleKind::Format, 0, op.a));
                break;
            case OpCode::Object:
                fillObject(index, m_program.objects[op.a]);
                break;
            case OpCode::Items:
                fillArray(index, m_program.arrays[op.a]);
                break;
            case OpCode::UniqueItems:
                at(index).rules.append(makeRule(RuleKind::UniqueItems));
                break;
            case OpCode::Contains: {
                Plan::Rule contains = makeRuleOverSchemas(RuleKind::Contains, std::span { &op.a, 1 });
                contains.count = op.b;
                contains.maxCount = op.c;
                at(index).rules.append(WTF::move(contains));
                break;
            }
            default:
                return fail(makeString("Unsupported keyword: "_s, nameOf(op.keyword)));
            }
        }
        return index;
    }

    uint32_t writeNode(uint32_t schemaIndex)
    {
        if (failed() || schemaIndex == trueSchema)
            return m_unknown;
        if (m_nodeBySchema[schemaIndex] != none)
            return m_nodeBySchema[schemaIndex];
        SetForScope depth(m_depth, m_depth + 1);
        if (!canGoDeeper())
            return m_unknown;

        const Schema& schema = m_program.schemas[schemaIndex];
        SetForScope currentData(m_currentData, schema.data);
        uint32_t index = add(Shape::Never);
        m_nodeBySchema[schemaIndex] = index;
        if (schemaIndex == falseSchema)
            return index;

        std::span<const Op> ops = m_program.ops.span().subspan(schema.firstOp, schema.opCount);
        std::span<const uint32_t> lists = m_program.lists.span();
        bool hasOnlyApplicators = schema.types == EveryType;
        bool hasTypedOps = false;
        // The first list of constants, or else the first anyOf of a schema that has no types of its own, is the shape of the node. The rest are rules.
        const Op* constants = nullptr;
        const Op* choice = nullptr;
        bool isNever = false;
        for (const Op& op : ops) {
            isNever |= op.code == OpCode::Not && op.a == trueSchema;
            if (isListOfConstants(op))
                constants = constants ? constants : &op;
            else if (op.code == OpCode::AnyOf && hasOnlyApplicators)
                choice = choice ? choice : &op;
            else
                hasTypedOps |= op.applies != EveryType;
        }

        if (isNever) {
            if (schema.hasTitleOrExtension)
                applyTitleAndExtension(index, schema);
            return index;
        }

        Vector<uint32_t> arms;
        Vector<uint32_t> typedArms;
        if (constants)
            arms = writeLiterals(*constants, schema.types);
        else if (choice)
            arms = writeNodeList(lists.subspan(choice->a, choice->b));
        if (constants ? hasTypedOps : !hasOnlyApplicators) {
            for (uint8_t family : { ObjectBit, ArrayBit, StringBit, NumberBit, BooleanBit, NullBit }) {
                if (schema.types & (family == NumberBit ? NumberBit | IntegerBit : family))
                    (constants ? typedArms : arms).append(writeNodeForType(schema, family));
            }
        }

        Vector<Plan::Rule> rules;
        // One of the constants, and what the other keywords say about its type.
        if (!typedArms.isEmpty())
            rules.append(makeRuleOverNode(RuleKind::Every, writeUnion(WTF::move(typedArms))));
        for (const Op& op : ops) {
            if (&op == constants || &op == choice)
                continue;
            if (isListOfConstants(op)) {
                rules.append(makeRuleOverNode(RuleKind::Every, writeUnion(writeLiterals(op, EveryJSONType))));
                continue;
            }
            if (op.applies != EveryType)
                continue;
            switch (op.code) {
            case OpCode::Ref:
                rules.append(makeRuleOverSchemas(RuleKind::Every, std::span { &op.a, 1 }));
                break;
            case OpCode::AllOf:
                rules.append(makeRuleOverSchemas(RuleKind::Every, lists.subspan(op.a, op.b)));
                break;
            case OpCode::Not:
                rules.append(makeRuleOverSchemas(RuleKind::Not, std::span { &op.a, 1 }));
                break;
            case OpCode::If: {
                uint32_t parts[] = { op.a, op.b, op.c };
                rules.append(makeRuleOverSchemas(RuleKind::If, parts));
                break;
            }
            case OpCode::OneOf:
                rules.append(makeRuleOverSchemas(RuleKind::ExactlyOne, lists.subspan(op.a, op.b)));
                break;
            case OpCode::AnyOf:
                rules.append(makeRuleOverNode(RuleKind::Every, writeUnion(writeNodeList(lists.subspan(op.a, op.b)))));
                break;
            default:
                return fail(makeString("Unsupported keyword: "_s, nameOf(op.keyword)));
            }
        }
        if (failed())
            return m_unknown;

        if (choice) {
            at(index).shape = Shape::Union;
            at(index).children = WTF::move(arms);
        } else if (arms.size() == 1)
            at(index) = std::exchange(at(arms[0]), Plan::Node {});
        else if (!arms.isEmpty()) {
            at(index).shape = Shape::Union;
            at(index).children = WTF::move(arms);
        } else if (hasOnlyApplicators)
            at(index).shape = Shape::Unknown;
        at(index).rules.appendVector(WTF::move(rules));
        if (schema.hasTitleOrExtension)
            applyTitleAndExtension(index, schema);
        return index;
    }

    void applyTitleAndExtension(uint32_t index, const Schema& schema)
    {
        for (auto& member : m_pool.membersOf(schema.data)) {
            if (member.keyword == Keyword::Extension)
                applyExtension(index, schema, member.value);
            else if (member.keyword != Keyword::Title)
                continue;
            else if (m_pool[member.value].kind == Kind::String)
                m_titles[index] = m_pool[member.value].string;
            else
                expect(member.value, "a string"_s);
        }
    }

    // "x-bun": what a TypeScript type says and JSON Schema cannot.
    void applyExtension(uint32_t index, const Schema& schema, uint32_t extension)
    {
        if (m_pool[extension].kind != Kind::Object)
            return expect(extension, "an object"_s);
        // First, because the other members belong to the node that has this shape.
        for (auto& member : m_pool.membersOf(extension)) {
            if (member.key == "type"_s)
                applyType(index, member.value);
        }
        for (auto& member : m_pool.membersOf(extension)) {
            if (failed())
                return;
            if (member.key == "type"_s)
                continue;
            const Data& value = m_pool[member.value];
            bool isString = value.kind == Kind::String;
            if (member.key == "pattern"_s) {
                if (!isString)
                    return expect(member.value, "a string"_s);
                RegExp* regExp = RegExp::create(m_vm, value.string, {});
                if (!regExp->isValid())
                    return void(fail(makeString("Expected "_s, m_pool.pathTo(member.value), " to be a regular expression: "_s, regExp->errorMessage())));
                Plan::Rule pattern = makeRule(RuleKind::Pattern);
                pattern.text = value.string;
                addStringRule(index, member.value, WTF::move(pattern));
            } else if (member.key == "template"_s)
                applyTemplate(index, member.value);
            else if (member.key == "default"_s)
                applyDefault(at(index), member.value);
            else if (member.key == "message"_s) {
                if (!isString)
                    return expect(member.value, "a string"_s);
                m_messages[index] = value.string;
            } else if (member.key == "source"_s) {
                if (!isString || value.string != "typescript"_s)
                    return expect(member.value, "\"typescript\""_s);
                if (schema.data != m_pool.documents[0].root)
                    return expect(member.value, "in the root schema"_s);
                m_isTypeScript = true;
            } else
                fail("Unknown keyword: "_s, member.value);
        }
    }

    // The value has this type, and it passes the other keywords of the schema.
    void applyType(uint32_t index, uint32_t data)
    {
        const Data& value = m_pool[data];
        if (value.kind != Kind::String || (value.string != "undefined"_s && value.string != "bigint"_s && value.string != "object"_s))
            return expect(data, "\"undefined\", \"bigint\" or \"object\""_s);
        if (at(index).shape != Shape::Unknown || !at(index).rules.isEmpty()) {
            uint32_t rest = add(Shape::Unknown);
            at(rest) = std::exchange(at(index), Plan::Node {});
            at(index).rules.append(makeRuleOverNode(RuleKind::Every, rest));
        }
        at(index).shape = value.string == "undefined"_s ? Shape::Undefined : value.string == "bigint"_s ? Shape::BigInt
                                                                                                        : Shape::AnyObject;
    }

    void addStringRule(uint32_t index, uint32_t data, Plan::Rule&& rule)
    {
        if (at(index).shape != Shape::String)
            return expect(data, "beside \"type\": \"string\""_s);
        at(index).rules.append(WTF::move(rule));
    }

    void applyDefault(Plan::Node& node, uint32_t data)
    {
        const Data& value = m_pool[data];
        switch (value.kind) {
        case Kind::Null:
            node.defaultKind = Plan::Literal::Null;
            return;
        case Kind::False:
        case Kind::True:
            node.defaultKind = Plan::Literal::Boolean;
            node.defaultBoolean = value.kind == Kind::True;
            return;
        case Kind::Number:
            node.defaultKind = Plan::Literal::Number;
            node.defaultNumber = value.number;
            return;
        case Kind::String:
            node.defaultKind = Plan::Literal::String;
            node.defaultString = value.string;
            return;
        case Kind::Array:
        case Kind::Object:
        case Kind::NotJSON:
            break;
        }
        expect(data, "null, a boolean, a number or a string"_s);
    }

    // { texts: [head, ..], placeholders: ["string" | "number" | "bigint", ..] }, with one text more than placeholders.
    void applyTemplate(uint32_t index, uint32_t data)
    {
        if (m_pool[data].kind != Kind::Object)
            return expect(data, "an object"_s);
        uint32_t texts = none;
        uint32_t placeholders = none;
        for (auto& member : m_pool.membersOf(data)) {
            if (member.key != "texts"_s && member.key != "placeholders"_s)
                return void(fail("Unknown keyword: "_s, member.value));
            if (m_pool[member.value].kind != Kind::Array)
                return expect(member.value, "an array"_s);
            (member.key == "texts"_s ? texts : placeholders) = member.value;
        }
        if (texts == none || placeholders == none)
            return void(fail("Missing required property "_s, data, texts == none ? ".texts"_s : ".placeholders"_s));
        if (!m_pool[placeholders].count || m_pool[texts].count != m_pool[placeholders].count + 1)
            return void(fail("Expected "_s, texts, " to have one item more than placeholders, which has at least one"_s));

        Plan::Rule result = makeRule(RuleKind::Template);
        for (uint32_t element : m_pool.elementsOf(texts)) {
            if (m_pool[element].kind != Kind::String)
                return expect(element, "a string"_s);
            result.texts.append(m_pool[element].string);
        }
        StringBuilder letters;
        for (uint32_t element : m_pool.elementsOf(placeholders)) {
            const Data& name = m_pool[element];
            if (name.kind != Kind::String || (name.string != "string"_s && name.string != "number"_s && name.string != "bigint"_s))
                return expect(element, "\"string\", \"number\" or \"bigint\""_s);
            letters.append(name.string[0]);
        }
        result.text = letters.toString();
        addStringRule(index, data, WTF::move(result));
    }

    // An Unknown node with one Every rule over one node stands for that node.
    static uint32_t findAlias(const Plan::Node& node)
    {
        bool isAlias = node.shape == Shape::Unknown && node.rules.size() == 1 && node.rules[0].kind == RuleKind::Every && node.rules[0].nodes.size() == 1;
        return isAlias ? node.rules[0].nodes[0] : none;
    }

    // A required member whose type accepts undefined must be an own property.
    // A node accepts undefined if it is Unknown or Undefined, or a union with such an arm. A node with a default does not.
    void markMembersThatMustBeOwn()
    {
        size_t size = m_plan->nodes.size();
        Vector<bool> acceptsUndefined;
        acceptsUndefined.fill(false, size);
        Vector<Vector<uint32_t>> holders;
        holders.grow(size);
        Vector<uint32_t> worklist;
        for (uint32_t i = 0; i < size; ++i) {
            const Plan::Node& node = at(i);
            if (node.defaultKind != Plan::Literal::None)
                continue;
            if (uint32_t alias = findAlias(node); alias != none)
                holders[alias].append(i);
            else if (node.shape == Shape::Unknown || node.shape == Shape::Undefined) {
                acceptsUndefined[i] = true;
                worklist.append(i);
            } else if (node.shape == Shape::Union) {
                for (uint32_t arm : node.children)
                    holders[arm].append(i);
            }
        }
        while (!worklist.isEmpty()) {
            for (uint32_t holder : holders[worklist.takeLast()]) {
                if (acceptsUndefined[holder])
                    continue;
                acceptsUndefined[holder] = true;
                worklist.append(holder);
            }
        }
        for (auto& node : m_plan->nodes) {
            for (auto& member : node.members)
                member.mustBeOwn = !member.isOptional && acceptsUndefined[member.node];
        }
    }

    // A node that tests the same value by itself again, such as { "$ref": "#" } at the root, would never finish.
    void refuseLoops(uint32_t index)
    {
        if (failed() || m_visits[index] == Visit::Done)
            return;
        if (m_visits[index] == Visit::Open) {
            fail("Expected "_s, m_dataByNode[index], " not to refer to itself"_s);
            return;
        }
        SetForScope depth(m_depth, m_depth + 1);
        if (!canGoDeeper())
            return;
        m_visits[index] = Visit::Open;
        const Plan::Node& node = at(index);
        if (node.shape == Shape::Union) {
            for (uint32_t arm : node.children)
                refuseLoops(arm);
        }
        for (auto& rule : node.rules) {
            switch (rule.kind) {
            case RuleKind::Not:
            case RuleKind::If:
            case RuleKind::ExactlyOne:
            case RuleKind::Every:
            case RuleKind::DependentNode:
                for (uint32_t tested : rule.nodes)
                    refuseLoops(tested);
                break;
            default:
                break;
            }
        }
        m_visits[index] = Visit::Done;
    }

    enum class Visit : uint8_t { New,
        Open,
        Done };

    VM& m_vm;
    const Program& m_program;
    const Pool& m_pool;
    Ref<Plan> m_plan;
    Vector<String> m_titles;
    Vector<String> m_messages;
    // The schema that each node was written for.
    Vector<uint32_t> m_dataByNode;
    Vector<uint32_t> m_nodeBySchema;
    Vector<Visit> m_visits;
    String m_error;
    uint32_t m_unknown { 0 };
    uint32_t m_currentData { 0 };
    unsigned m_depth { 0 };
    bool m_isTypeScript { false };
};

std::optional<ValidatorNodes> writeNodes(JSGlobalObject* globalObject, const Program& program)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    NodeWriter writer(vm, program);
    std::optional<ValidatorNodes> nodes = writer.run();
    if (!nodes)
        throwTypeError(globalObject, scope, writer.error());
    return nodes;
}

} // namespace Bun::JSONSchema
