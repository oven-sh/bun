#include "root.h"

#include "BunValidator.h"
#include "JSONSchemaValidator.h"
#include <JavaScriptCore/YarrFlags.h>
#include <algorithm>
#include <bit>
#include <cmath>
#include <functional>
#include <span>
#include <utility>
#include <wtf/BitVector.h>
#include <wtf/HashMap.h>
#include <wtf/text/AtomStringHash.h>
#include <wtf/text/StringBuilder.h>
#include <wtf/text/StringView.h>

namespace Bun {

namespace {

// Writes the text that writeValidationPlan() in JavaScriptCore's aot/passes/AOTValidationPlanText.cpp writes for the same nodes,
// so an error reads the same with and without --aot.
class PlanTextWriter {
    using Plan = JSC::ValidationPlan;
    using Node = Plan::Node;
    using Rule = Plan::Rule;
    using RuleKind = Plan::RuleKind;
    using Shape = Plan::Shape;

public:
    explicit PlanTextWriter(const ValidatorNodes& nodes)
        : m_nodes(nodes.plan->nodes)
        , m_titles(nodes.titles)
        , m_messages(nodes.messages)
        , m_root(nodes.plan->root)
    {
    }

    String write()
    {
        collectChildren();
        numberNodes();
        findCycles();
        findAcceptedValues();
        findTaggedArmsOfUnions();
        appendList(m_order, [&](uint32_t index) {
            appendNode(index);
        });
        // No reader takes the empty text, so the error falls back to its general message.
        if (m_isTooLong || m_text.hasOverflowed())
            return emptyString();
        return m_text.toString();
    }

private:
    enum class NumberSpelling : uint8_t { RoundTrip,
        Stringified };
    enum Accepted : uint8_t { AcceptsArrays = 1,
        AcceptsObjects = 2,
        AcceptsUndefined = 4 };

    struct TaggedArms {
        AtomString key;
        // The literal node of each tagged arm.
        Vector<uint32_t> tags;
        Vector<uint32_t> tagged;
        Vector<uint32_t> untagged;
    };

    // A key that tags at least one arm of a union.
    struct TagKey {
        AtomString key;
        // Indexes into the list of arms.
        Vector<uint32_t> positions;
        Vector<uint32_t> tags;
    };

    static constexpr unsigned maxLooks = 64;
    static constexpr unsigned maxLookDepth = 128;
    // Once these are spent, every union remembers.
    static constexpr unsigned maxLookSteps = 1 << 24;

    // The graph.

    std::span<const uint32_t> childrenOf(uint32_t index) const
    {
        return m_children.span().subspan(m_firstChild[index], m_firstChild[index + 1] - m_firstChild[index]);
    }

    void collectChildren()
    {
        for (const Node& node : m_nodes) {
            m_firstChild.append(m_children.size());
            m_children.appendVector(node.children);
            for (auto& member : node.members)
                m_children.append(member.node);
            if (node.child != Plan::none)
                m_children.append(node.child);
            for (auto& rule : node.rules)
                m_children.appendVector(rule.nodes);
        }
        m_firstChild.append(m_children.size());
    }

    // The root is 0. The other nodes it reaches follow in index order.
    void numberNodes()
    {
        BitVector isReachable(m_nodes.size());
        isReachable.set(m_root);
        Vector<uint32_t, 16> worklist { m_root };
        while (!worklist.isEmpty()) {
            for (uint32_t child : childrenOf(worklist.takeLast())) {
                if (isReachable.add(child))
                    worklist.append(child);
            }
        }
        m_order.append(m_root);
        for (size_t index : isReachable) {
            if (index != m_root)
                m_order.append(static_cast<uint32_t>(index));
        }
        m_numbers.fill(Plan::none, m_nodes.size());
        for (uint32_t number = 0; number < m_order.size(); ++number)
            m_numbers[m_order[number]] = number;
    }

    // Marks every node that reaches itself (Tarjan's strongly connected components).
    void findCycles()
    {
        size_t count = m_nodes.size();
        m_isOnCycle.ensureSize(count);
        BitVector isVisited(count);
        BitVector isOnStack(count);
        Vector<uint32_t> order;
        order.fill(0, count);
        Vector<uint32_t> lowest = order;
        Vector<uint32_t> stack;
        Vector<std::pair<uint32_t, uint32_t>> walk;
        walk.append({ m_root, 0 });
        uint32_t visitedCount = 0;
        while (!walk.isEmpty()) {
            auto [node, nextChild] = walk.last();
            if (!nextChild) {
                order[node] = lowest[node] = visitedCount++;
                isVisited.quickSet(node);
                isOnStack.quickSet(node);
                stack.append(node);
            }
            auto children = childrenOf(node);
            if (nextChild < children.size()) {
                ++walk.last().second;
                uint32_t child = children[nextChild];
                if (child == node)
                    m_isOnCycle.quickSet(node);
                if (!isVisited.quickGet(child))
                    walk.append({ child, 0 });
                else if (isOnStack.quickGet(child))
                    lowest[node] = std::min(lowest[node], order[child]);
                continue;
            }
            walk.removeLast();
            if (!walk.isEmpty())
                lowest[walk.last().first] = std::min(lowest[walk.last().first], lowest[node]);
            if (lowest[node] != order[node])
                continue;
            bool hasSeveralNodes = stack.last() != node;
            for (;;) {
                uint32_t member = stack.takeLast();
                isOnStack.quickClear(member);
                if (hasSeveralNodes)
                    m_isOnCycle.quickSet(member);
                if (member == node)
                    break;
            }
        }
    }

    static bool hasDefault(const Node& node) { return node.defaultKind != Plan::Literal::None; }

    static uint8_t acceptedByShape(Shape shape)
    {
        switch (shape) {
        case Shape::Unknown:
            return AcceptsArrays | AcceptsObjects | AcceptsUndefined;
        case Shape::Undefined:
            return AcceptsUndefined;
        case Shape::AnyObject:
            return AcceptsArrays | AcceptsObjects;
        case Shape::Array:
        case Shape::Tuple:
            return AcceptsArrays;
        case Shape::Dictionary:
        case Shape::Object:
            return AcceptsObjects;
        default:
            return 0;
        }
    }

    // A union accepts what its arms accept. A node with a default takes undefined for "missing", not for a value.
    void findAcceptedValues()
    {
        auto withoutDefault = [&](uint32_t index, uint8_t accepted) -> uint8_t {
            return hasDefault(m_nodes[index]) ? accepted & ~AcceptsUndefined : accepted;
        };
        m_accepted.fill(0, m_nodes.size());
        Vector<std::pair<uint32_t, uint32_t>> unionsByArm;
        Vector<uint32_t> worklist;
        for (uint32_t index : m_order) {
            const Node& node = m_nodes[index];
            m_accepted[index] = withoutDefault(index, acceptedByShape(node.shape));
            if (m_accepted[index])
                worklist.append(index);
            if (node.shape != Shape::Union)
                continue;
            for (uint32_t arm : node.children)
                unionsByArm.append({ arm, index });
        }
        std::sort(unionsByArm.begin(), unionsByArm.end());
        while (!worklist.isEmpty()) {
            uint32_t arm = worklist.takeLast();
            auto holder = std::lower_bound(unionsByArm.begin(), unionsByArm.end(), std::pair<uint32_t, uint32_t> { arm, 0 });
            for (; holder != unionsByArm.end() && holder->first == arm; ++holder) {
                uint8_t& accepted = m_accepted[holder->second];
                uint8_t merged = accepted | withoutDefault(holder->second, m_accepted[arm]);
                if (merged == accepted)
                    continue;
                accepted = merged;
                worklist.append(holder->second);
            }
        }
    }

    // Discriminated unions.

    bool isTag(const Plan::Member& member) const
    {
        if (member.isOptional)
            return false;
        const Node& node = m_nodes[member.node];
        bool isLiteral = node.shape == Shape::Null || node.shape == Shape::BooleanLiteral || node.shape == Shape::NumberLiteral || node.shape == Shape::StringLiteral;
        return isLiteral && !hasDefault(node) && node.rules.isEmpty();
    }

    // Any total order in which equal literals are neighbors. 0 and -0 are equal.
    static bool isLessLiteral(const Node& a, const Node& b)
    {
        auto bitsOf = [](double number) {
            return std::bit_cast<uint64_t>(number ? number : 0.0);
        };
        if (a.shape != b.shape)
            return a.shape < b.shape;
        if (a.shape == Shape::BooleanLiteral)
            return a.boolean < b.boolean;
        if (a.shape == Shape::NumberLiteral)
            return bitsOf(a.number) < bitsOf(b.number);
        if (a.shape == Shape::StringLiteral)
            return codePointCompareLessThan(a.string, b.string);
        return false;
    }

    bool hasEqualLiterals(Vector<uint32_t> literals) const
    {
        auto isLess = [&](uint32_t a, uint32_t b) {
            return isLessLiteral(m_nodes[a], m_nodes[b]);
        };
        std::sort(literals.begin(), literals.end(), isLess);
        return std::adjacent_find(literals.begin(), literals.end(), std::not_fn(isLess)) != literals.end();
    }

    // Picks the first key that gives every object arm a literal of its own. Failing that, the first key that gives one to two arms or more.
    std::optional<TaggedArms> findTaggedArms(const Vector<uint32_t>& arms) const
    {
        Vector<TagKey> keys;
        HashMap<AtomString, uint32_t> indexOfKey;
        uint32_t objectCount = 0;
        for (uint32_t position = 0; position < arms.size(); ++position) {
            const Node& arm = m_nodes[arms[position]];
            if (arm.shape != Shape::Object)
                continue;
            ++objectCount;
            for (auto& member : arm.members) {
                if (!isTag(member))
                    continue;
                uint32_t index = indexOfKey.add(member.key, keys.size()).iterator->value;
                if (index == keys.size())
                    keys.append(TagKey { member.key, {}, {} });
                keys[index].positions.append(position);
                keys[index].tags.append(member.node);
            }
        }

        const TagKey* chosen = nullptr;
        for (auto& key : keys) {
            if (key.positions.size() < 2 || hasEqualLiterals(key.tags))
                continue;
            if (key.positions.size() == objectCount) {
                chosen = &key;
                break;
            }
            if (!chosen)
                chosen = &key;
        }
        if (!chosen)
            return std::nullopt;

        TaggedArms result { chosen->key, chosen->tags, {}, {} };
        size_t next = 0;
        for (uint32_t position = 0; position < arms.size(); ++position) {
            bool isTagged = next < chosen->positions.size() && chosen->positions[next] == position;
            next += isTagged;
            (isTagged ? result.tagged : result.untagged).append(arms[position]);
        }
        return result;
    }

    void findTaggedArmsOfUnions()
    {
        m_taggedArmsOfUnion.fill(Plan::none, m_nodes.size());
        for (uint32_t index : m_order) {
            if (m_nodes[index].shape != Shape::Union)
                continue;
            if (auto arms = findTaggedArms(m_nodes[index].children)) {
                m_taggedArmsOfUnion[index] = m_taggedArms.size();
                m_taggedArms.append(WTF::move(*arms));
            }
        }
    }

    const TaggedArms* taggedArmsOf(uint32_t unionIndex) const
    {
        uint32_t index = m_taggedArmsOfUnion[unionIndex];
        return index == Plan::none ? nullptr : &m_taggedArms[index];
    }

    // Unions that remember their verdicts.

    // Counts how often one part of a value can be read below a node. Each arm that a union tries reads everything below it again, so unions below unions multiply.
    // Stops counting above maxLooks. A node that is met again below itself counts once.
    unsigned countLooks(uint32_t index, unsigned depth)
    {
        if (depth > maxLookDepth || !m_remainingLookSteps)
            return maxLooks + 1;
        --m_remainingLookSteps;
        if (m_lastCount[index] == m_count)
            return m_looks[index];
        m_lastCount[index] = m_count;
        m_looks[index] = 1;

        auto countBelow = [&](uint32_t child) {
            return countLooks(child, depth + 1);
        };
        const Node& node = m_nodes[index];
        unsigned looks = 1;
        if (node.shape != Shape::Union) {
            for (uint32_t child : childrenOf(index))
                looks = std::max(looks, countBelow(child));
        } else {
            unsigned looksAtArray = 0;
            for (uint32_t arm : node.children) {
                if (m_accepted[arm] & AcceptsArrays)
                    looksAtArray += countBelow(arm);
            }
            // The tag picks one of the tagged arms.
            const TaggedArms* arms = taggedArmsOf(index);
            unsigned looksAtObject = 0;
            if (arms) {
                for (uint32_t arm : arms->tagged)
                    looksAtObject = std::max(looksAtObject, countBelow(arm));
            }
            for (uint32_t arm : arms ? arms->untagged : node.children) {
                if (m_accepted[arm] & AcceptsObjects)
                    looksAtObject += countBelow(arm);
            }
            looks = std::max({ looks, looksAtArray, looksAtObject });
        }
        looks = std::min(looks, maxLooks + 1);
        m_looks[index] = static_cast<uint8_t>(looks);
        return looks;
    }

    bool shouldRemember(uint32_t unionIndex)
    {
        if (m_isOnCycle.get(unionIndex))
            return true;
        if (m_looks.isEmpty()) {
            m_looks.fill(0, m_nodes.size());
            m_lastCount.fill(0, m_nodes.size());
        }
        ++m_count;
        return countLooks(unionIndex, 0) > maxLooks;
    }

    // The text.

    static ASCIILiteral nameOf(Shape shape)
    {
        switch (shape) {
        case Shape::Unknown:
            return "Unknown"_s;
        case Shape::Never:
            return "Never"_s;
        case Shape::Undefined:
            return "Undefined"_s;
        case Shape::Null:
            return "Null"_s;
        case Shape::AnyObject:
            return "AnyObject"_s;
        case Shape::String:
        case Shape::Number:
        case Shape::Boolean:
        case Shape::BigInt:
            return "Primitive"_s;
        case Shape::BooleanLiteral:
            return "BooleanLiteral"_s;
        case Shape::NumberLiteral:
            return "NumberLiteral"_s;
        case Shape::StringLiteral:
            return "StringLiteral"_s;
        case Shape::Array:
            return "Array"_s;
        case Shape::Tuple:
            return "Tuple"_s;
        case Shape::Dictionary:
            return "Dictionary"_s;
        case Shape::Object:
            return "Object"_s;
        case Shape::Union:
            return "Union"_s;
        }
        RELEASE_ASSERT_NOT_REACHED();
    }

    static ASCIILiteral typeofName(Shape primitive)
    {
        switch (primitive) {
        case Shape::String:
            return "string"_s;
        case Shape::Number:
            return "number"_s;
        case Shape::Boolean:
            return "boolean"_s;
        case Shape::BigInt:
            return "bigint"_s;
        default:
            RELEASE_ASSERT_NOT_REACHED();
        }
    }

    static ASCIILiteral nameOf(Plan::Undeclared undeclared)
    {
        switch (undeclared) {
        case Plan::Undeclared::Allowed:
            return "Allowed"_s;
        case Plan::Undeclared::Rejected:
            return "Rejected"_s;
        case Plan::Undeclared::Validated:
            return "Validated"_s;
        }
        RELEASE_ASSERT_NOT_REACHED();
    }

    static ASCIILiteral nameOf(RuleKind kind)
    {
        switch (kind) {
        case RuleKind::Integer:
            return "Integer"_s;
        case RuleKind::Minimum:
            return "Minimum"_s;
        case RuleKind::Maximum:
            return "Maximum"_s;
        case RuleKind::ExclusiveMinimum:
            return "ExclusiveMinimum"_s;
        case RuleKind::ExclusiveMaximum:
            return "ExclusiveMaximum"_s;
        case RuleKind::MultipleOf:
            return "MultipleOf"_s;
        case RuleKind::MinimumLength:
            return "MinimumLength"_s;
        case RuleKind::MaximumLength:
            return "MaximumLength"_s;
        case RuleKind::MinimumMembers:
            return "MinimumMembers"_s;
        case RuleKind::MaximumMembers:
            return "MaximumMembers"_s;
        case RuleKind::Pattern:
            return "Pattern"_s;
        case RuleKind::Format:
        case RuleKind::Url:
            return "Format"_s;
        case RuleKind::Template:
            return "Template"_s;
        case RuleKind::UniqueItems:
            return "UniqueItems"_s;
        case RuleKind::Contains:
            return "Contains"_s;
        case RuleKind::PatternMembers:
            return "PatternMembers"_s;
        case RuleKind::MemberNames:
            return "MemberNames"_s;
        case RuleKind::DependentMembers:
            return "DependentMembers"_s;
        case RuleKind::DependentNode:
            return "DependentNode"_s;
        case RuleKind::Not:
            return "Not"_s;
        case RuleKind::If:
            return "If"_s;
        case RuleKind::ExactlyOne:
            return "ExactlyOne"_s;
        case RuleKind::Every:
            return "Every"_s;
        }
        RELEASE_ASSERT_NOT_REACHED();
    }

    static ASCIILiteral nameOf(JSONSchema::Format format)
    {
        using Format = JSONSchema::Format;
        switch (format) {
        case Format::DateTime:
            return "date-time"_s;
        case Format::Date:
            return "date"_s;
        case Format::Time:
            return "time"_s;
        case Format::Duration:
            return "duration"_s;
        case Format::Email:
            return "email"_s;
        case Format::Hostname:
            return "hostname"_s;
        case Format::IPv4:
            return "ipv4"_s;
        case Format::IPv6:
            return "ipv6"_s;
        case Format::URI:
            return "uri"_s;
        case Format::URIReference:
            return "uri-reference"_s;
        case Format::UUID:
            return "uuid"_s;
        case Format::RegularExpression:
            return "regex"_s;
        case Format::JSONPointer:
            return "json-pointer"_s;
        case Format::RelativeJSONPointer:
            return "relative-json-pointer"_s;
        case Format::URL:
            return "url"_s;
        }
        RELEASE_ASSERT_NOT_REACHED();
    }

    // Appends punctuation and names as they are, and every other part as the JSON text of its value.
    void append(const auto&... parts) { (appendPart(parts), ...); }

    void appendPart(ASCIILiteral punctuation) { m_text.append(punctuation); }
    void appendPart(char punctuation) { m_text.append(punctuation); }
    void appendPart(uint32_t integer) { m_text.append(integer); }
    void appendPart(bool boolean) { m_text.append(boolean ? "true"_s : "false"_s); }
    void appendPart(const String& string) { m_text.appendQuotedJSONString(string); }
    void appendPart(const AtomString& string) { m_text.appendQuotedJSONString(string.string()); }
    void appendPart(double number) { appendNumber(m_text, number, NumberSpelling::RoundTrip); }

    static void appendNumber(StringBuilder& text, double number, NumberSpelling spelling)
    {
        bool roundTrips = spelling == NumberSpelling::RoundTrip;
        if (roundTrips && std::isinf(number))
            text.append(number > 0 ? "1e999"_s : "-1e999"_s);
        else if (roundTrips && !number && std::signbit(number))
            text.append("-0"_s);
        else if (!std::isfinite(number))
            text.append("null"_s);
        else
            text.append(number);
    }

    static void appendLiteral(StringBuilder& text, const Node& literal, NumberSpelling spelling)
    {
        switch (literal.shape) {
        case Shape::BooleanLiteral:
            return text.append(literal.boolean ? "true"_s : "false"_s);
        case Shape::NumberLiteral:
            return appendNumber(text, literal.number, spelling);
        case Shape::StringLiteral:
            return text.appendQuotedJSONString(literal.string);
        default:
            return text.append("null"_s);
        }
    }

    void appendList(const auto& items, const auto& appendItem)
    {
        m_text.append('[');
        bool isFirst = true;
        for (const auto& item : items) {
            if (!std::exchange(isFirst, false))
                m_text.append(',');
            appendItem(item);
        }
        m_text.append(']');
    }

    uint32_t numberOf(uint32_t index) const { return m_numbers[index]; }

    void appendNumbers(ASCIILiteral name, const Vector<uint32_t>& indexes)
    {
        append(name);
        appendList(indexes, [&](uint32_t index) {
            append(numberOf(index));
        });
    }

    void appendStrings(ASCIILiteral name, const Vector<String>& strings)
    {
        append(name);
        appendList(strings, [&](const String& string) {
            append(string);
        });
    }

    void appendRule(const Rule& rule)
    {
        append("{\"rule\":\""_s, nameOf(rule.kind), '"');
        switch (rule.kind) {
        case RuleKind::Integer:
        case RuleKind::UniqueItems:
            break;
        case RuleKind::Minimum:
        case RuleKind::Maximum:
        case RuleKind::ExclusiveMinimum:
        case RuleKind::ExclusiveMaximum:
            append(",\"bound\":"_s, rule.number);
            break;
        case RuleKind::MultipleOf:
            append(",\"divisor\":"_s, rule.number);
            break;
        case RuleKind::MinimumLength:
        case RuleKind::MaximumLength:
            append(",\"length\":"_s, rule.count);
            break;
        case RuleKind::MinimumMembers:
        case RuleKind::MaximumMembers:
            append(",\"count\":"_s, rule.count);
            break;
        case RuleKind::Pattern:
            append(",\"source\":"_s, rule.text);
            if (OptionSet<JSC::Yarr::Flags>::fromRaw(rule.flags).contains(JSC::Yarr::Flags::Unicode))
                append(",\"unicode\":true"_s);
            break;
        case RuleKind::Format:
            append(",\"format\":\""_s, nameOf(static_cast<JSONSchema::Format>(rule.count)), '"');
            break;
        case RuleKind::Url:
            append(",\"format\":\"url\""_s);
            break;
        case RuleKind::Template:
            appendStrings(",\"texts\":"_s, rule.texts);
            append(",\"placeholders\":"_s, rule.text);
            break;
        case RuleKind::Contains:
            append(",\"node\":"_s, numberOf(rule.nodes[0]), ",\"minimum\":"_s, rule.count);
            if (rule.maxCount != Plan::none)
                append(",\"maximum\":"_s, rule.maxCount);
            break;
        case RuleKind::Not:
        case RuleKind::MemberNames:
            append(",\"node\":"_s, numberOf(rule.nodes[0]));
            break;
        case RuleKind::If:
            append(",\"condition\":"_s, numberOf(rule.nodes[0]), ",\"then\":"_s, numberOf(rule.nodes[1]), ",\"otherwise\":"_s, numberOf(rule.nodes[2]));
            break;
        case RuleKind::ExactlyOne:
        case RuleKind::Every:
            appendNumbers(",\"nodes\":"_s, rule.nodes);
            break;
        case RuleKind::PatternMembers:
            appendStrings(",\"sources\":"_s, rule.texts);
            appendNumbers(",\"nodes\":"_s, rule.nodes);
            break;
        case RuleKind::DependentMembers:
            append(",\"key\":"_s, rule.text);
            appendStrings(",\"names\":"_s, rule.texts);
            break;
        case RuleKind::DependentNode:
            append(",\"key\":"_s, rule.text, ",\"node\":"_s, numberOf(rule.nodes[0]));
            break;
        }
        append('}');
    }

    void appendDiscriminant(const TaggedArms& arms)
    {
        StringBuilder expected(OverflowPolicy::RecordOverflow);
        for (uint32_t tag : arms.tags) {
            if (!expected.isEmpty())
                expected.append(" | "_s);
            appendLiteral(expected, m_nodes[tag], NumberSpelling::Stringified);
        }
        if (expected.hasOverflowed()) {
            m_isTooLong = true;
            return;
        }
        append(",\"discriminant\":{\"key\":"_s, arms.key, ",\"tags\":"_s);
        appendList(arms.tags, [&](uint32_t tag) {
            appendLiteral(m_text, m_nodes[tag], NumberSpelling::RoundTrip);
        });
        appendNumbers(",\"tagged\":"_s, arms.tagged);
        appendNumbers(",\"untagged\":"_s, arms.untagged);
        append(",\"expected\":"_s, expected.toString(), '}');
    }

    void appendMember(const Plan::Member& member)
    {
        bool mustBeOwn = !member.isOptional && (m_accepted[member.node] & AcceptsUndefined);
        append("{\"key\":"_s, member.key, ",\"node\":"_s, numberOf(member.node), ",\"isOptional\":"_s, member.isOptional, ",\"mustBeOwn\":"_s, mustBeOwn, '}');
    }

    void appendNode(uint32_t index)
    {
        const Node& node = m_nodes[index];
        append("{\"shape\":\""_s, nameOf(node.shape), '"');
        switch (node.shape) {
        case Shape::String:
        case Shape::Number:
        case Shape::Boolean:
        case Shape::BigInt:
            append(",\"primitive\":\""_s, typeofName(node.shape), '"');
            break;
        case Shape::BooleanLiteral:
        case Shape::NumberLiteral:
        case Shape::StringLiteral:
            append(",\"value\":"_s);
            appendLiteral(m_text, node, NumberSpelling::RoundTrip);
            break;
        case Shape::Array:
        case Shape::Dictionary:
            append(",\"element\":"_s, numberOf(node.child));
            break;
        case Shape::Tuple:
            if (!node.children.isEmpty())
                appendNumbers(",\"elements\":"_s, node.children);
            append(",\"required\":"_s, node.required);
            if (node.child != Plan::none)
                append(",\"rest\":"_s, numberOf(node.child));
            break;
        case Shape::Object:
            if (!node.members.isEmpty()) {
                append(",\"members\":"_s);
                appendList(node.members, [&](const Plan::Member& member) {
                    appendMember(member);
                });
            }
            append(",\"undeclared\":\""_s, nameOf(node.undeclared), '"');
            if (node.undeclared == Plan::Undeclared::Validated)
                append(",\"undeclaredValue\":"_s, numberOf(node.child));
            break;
        case Shape::Union:
            if (!node.children.isEmpty())
                appendNumbers(",\"arms\":"_s, node.children);
            if (const TaggedArms* arms = taggedArmsOf(index))
                appendDiscriminant(*arms);
            if (shouldRemember(index))
                append(",\"remembers\":true"_s);
            break;
        case Shape::Unknown:
        case Shape::Never:
        case Shape::Undefined:
        case Shape::Null:
        case Shape::AnyObject:
            break;
        }

        if (!node.rules.isEmpty()) {
            append(",\"rules\":"_s);
            appendList(node.rules, [&](const Rule& rule) {
                appendRule(rule);
            });
        }
        if (index < m_messages.size() && !m_messages[index].isNull())
            append(",\"message\":"_s, m_messages[index]);
        switch (node.defaultKind) {
        case Plan::Literal::None:
            break;
        case Plan::Literal::Null:
            append(",\"default\":null"_s);
            break;
        case Plan::Literal::Boolean:
            append(",\"default\":"_s, node.defaultBoolean);
            break;
        case Plan::Literal::Number:
            append(",\"default\":"_s, node.defaultNumber);
            break;
        case Plan::Literal::String:
            append(",\"default\":"_s, node.defaultString);
            break;
        }
        if (index < m_titles.size() && !m_titles[index].isNull())
            append(",\"text\":"_s, m_titles[index]);
        append('}');
    }

    const Vector<Node>& m_nodes;
    const Vector<String>& m_titles;
    const Vector<String>& m_messages;
    uint32_t m_root;

    // The children of node i are m_children[m_firstChild[i]] up to m_children[m_firstChild[i + 1]].
    Vector<uint32_t> m_children;
    Vector<uint32_t> m_firstChild;
    // The nodes of the text in its order, and the number of each node in the text.
    Vector<uint32_t> m_order;
    Vector<uint32_t> m_numbers;
    BitVector m_isOnCycle;
    Vector<uint8_t> m_accepted;
    Vector<TaggedArms> m_taggedArms;
    Vector<uint32_t> m_taggedArmsOfUnion;

    // m_looks[i] belongs to the current count if m_lastCount[i] is m_count.
    Vector<uint8_t> m_looks;
    Vector<uint32_t> m_lastCount;
    uint32_t m_count { 0 };
    unsigned m_remainingLookSteps { maxLookSteps };

    StringBuilder m_text { OverflowPolicy::RecordOverflow };
    bool m_isTooLong { false };
};

} // namespace

String writeValidationPlanText(const ValidatorNodes& nodes)
{
    return PlanTextWriter(nodes).write();
}

} // namespace Bun
