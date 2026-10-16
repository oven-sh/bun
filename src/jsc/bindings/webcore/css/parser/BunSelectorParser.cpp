#include "config.h"
#include "BunSelectorParser.h"

#include "CommonAtomStrings.h"
#include "HTMLNames.h"
#include "MutableCSSSelector.h"
#include "QualifiedName.h"
#include <wtf/Scope.h>
#include <wtf/StdLibExtras.h>
#include <wtf/text/AtomString.h>
#include <wtf/text/WTFString.h>

namespace WebCore {

// The C ABI of src/css/selectors/dom.rs, which documents it. The numbers are Bun's own: WebCore's depend on ENABLE() flags.

enum class BunSelectorOpKind : uint8_t {
    Tag = 0,
    Id = 1,
    Class = 2,
    AttributeSet = 3,
    AttributeExact = 4,
    AttributeList = 5,
    AttributeHyphen = 6,
    AttributeBegin = 7,
    AttributeEnd = 8,
    AttributeContain = 9,
    PseudoClass = 10,
    HasScope = 11,
    String = 12,
    Integer = 13,
};

enum class BunSelectorRelation : uint8_t {
    Subselector = 0,
    Descendant = 1,
    Child = 2,
    DirectAdjacent = 3,
    IndirectAdjacent = 4,
    End = 255,
};

enum class BunSelectorNamespace : uint8_t {
    Unspecified = 0,
    Any = 1,
    None = 2,
};

enum class BunSelectorAttributeCase : uint8_t {
    Sensitive = 0,
    Insensitive = 1,
    InsensitiveInHTML = 2,
};

enum class BunSelectorPseudoClass : uint8_t {
    Root = 0,
    Empty = 1,
    Scope = 2,
    FirstChild = 3,
    LastChild = 4,
    OnlyChild = 5,
    FirstOfType = 6,
    LastOfType = 7,
    OnlyOfType = 8,
    NthChild = 9,
    NthLastChild = 10,
    NthOfType = 11,
    NthLastOfType = 12,
    Not = 13,
    Is = 14,
    Where = 15,
    WebKitAny = 16,
    Has = 17,
    Host = 18,
    Lang = 19,
    Dir = 20,
    State = 21,
    Hover = 22,
    Active = 23,
    Focus = 24,
    FocusVisible = 25,
    FocusWithin = 26,
    AnyLink = 27,
    Link = 28,
    Visited = 29,
    Target = 30,
    Enabled = 31,
    Disabled = 32,
    ReadOnly = 33,
    ReadWrite = 34,
    PlaceholderShown = 35,
    Default = 36,
    Checked = 37,
    Indeterminate = 38,
    Valid = 39,
    Invalid = 40,
    InRange = 41,
    OutOfRange = 42,
    Required = 43,
    Optional = 44,
    UserValid = 45,
    UserInvalid = 46,
    Open = 47,
    Modal = 48,
    PopoverOpen = 49,
    Defined = 50,
    Heading = 51,
};

struct BunSelectorString {
    const uint8_t* data;
    size_t length;
};

struct BunSelectorOp {
    BunSelectorOpKind kind;
    BunSelectorRelation relation;
    uint8_t detail;
    BunSelectorNamespace nameSpace;
    uint32_t nestedCount;
    int32_t a;
    int32_t b;
    BunSelectorString name;
    BunSelectorString value;
};

struct BunSelectorOpList {
    BunSelectorOp* ops;
    size_t opCount;
    uint8_t* strings;
    size_t stringsLength;
};

static_assert(sizeof(BunSelectorString) == 2 * sizeof(void*));
static_assert(offsetof(BunSelectorOp, nestedCount) == 4);
static_assert(offsetof(BunSelectorOp, a) == 8);
static_assert(offsetof(BunSelectorOp, name) == 16);
static_assert(sizeof(BunSelectorOp) == 16 + 2 * sizeof(BunSelectorString));

extern "C" bool Bun__CSS__parseSelectorListForDOM(const uint8_t* utf8, size_t length, BunSelectorOpList* result);
extern "C" void Bun__CSS__freeSelectorListForDOM(BunSelectorOpList*);

static CSSSelector::PseudoClass toPseudoClass(BunSelectorPseudoClass pseudoClass)
{
    switch (pseudoClass) {
    case BunSelectorPseudoClass::Root:
        return CSSSelector::PseudoClass::Root;
    case BunSelectorPseudoClass::Empty:
        return CSSSelector::PseudoClass::Empty;
    case BunSelectorPseudoClass::Scope:
        return CSSSelector::PseudoClass::Scope;
    case BunSelectorPseudoClass::FirstChild:
        return CSSSelector::PseudoClass::FirstChild;
    case BunSelectorPseudoClass::LastChild:
        return CSSSelector::PseudoClass::LastChild;
    case BunSelectorPseudoClass::OnlyChild:
        return CSSSelector::PseudoClass::OnlyChild;
    case BunSelectorPseudoClass::FirstOfType:
        return CSSSelector::PseudoClass::FirstOfType;
    case BunSelectorPseudoClass::LastOfType:
        return CSSSelector::PseudoClass::LastOfType;
    case BunSelectorPseudoClass::OnlyOfType:
        return CSSSelector::PseudoClass::OnlyOfType;
    case BunSelectorPseudoClass::NthChild:
        return CSSSelector::PseudoClass::NthChild;
    case BunSelectorPseudoClass::NthLastChild:
        return CSSSelector::PseudoClass::NthLastChild;
    case BunSelectorPseudoClass::NthOfType:
        return CSSSelector::PseudoClass::NthOfType;
    case BunSelectorPseudoClass::NthLastOfType:
        return CSSSelector::PseudoClass::NthLastOfType;
    case BunSelectorPseudoClass::Not:
        return CSSSelector::PseudoClass::Not;
    case BunSelectorPseudoClass::Is:
        return CSSSelector::PseudoClass::Is;
    case BunSelectorPseudoClass::Where:
        return CSSSelector::PseudoClass::Where;
    case BunSelectorPseudoClass::WebKitAny:
        return CSSSelector::PseudoClass::WebKitAny;
    case BunSelectorPseudoClass::Has:
        return CSSSelector::PseudoClass::Has;
    case BunSelectorPseudoClass::Host:
        return CSSSelector::PseudoClass::Host;
    case BunSelectorPseudoClass::Lang:
        return CSSSelector::PseudoClass::Lang;
    case BunSelectorPseudoClass::Dir:
        return CSSSelector::PseudoClass::Dir;
    case BunSelectorPseudoClass::State:
        return CSSSelector::PseudoClass::State;
    case BunSelectorPseudoClass::Hover:
        return CSSSelector::PseudoClass::Hover;
    case BunSelectorPseudoClass::Active:
        return CSSSelector::PseudoClass::Active;
    case BunSelectorPseudoClass::Focus:
        return CSSSelector::PseudoClass::Focus;
    case BunSelectorPseudoClass::FocusVisible:
        return CSSSelector::PseudoClass::FocusVisible;
    case BunSelectorPseudoClass::FocusWithin:
        return CSSSelector::PseudoClass::FocusWithin;
    case BunSelectorPseudoClass::AnyLink:
        return CSSSelector::PseudoClass::AnyLink;
    case BunSelectorPseudoClass::Link:
        return CSSSelector::PseudoClass::Link;
    case BunSelectorPseudoClass::Visited:
        return CSSSelector::PseudoClass::Visited;
    case BunSelectorPseudoClass::Target:
        return CSSSelector::PseudoClass::Target;
    case BunSelectorPseudoClass::Enabled:
        return CSSSelector::PseudoClass::Enabled;
    case BunSelectorPseudoClass::Disabled:
        return CSSSelector::PseudoClass::Disabled;
    case BunSelectorPseudoClass::ReadOnly:
        return CSSSelector::PseudoClass::ReadOnly;
    case BunSelectorPseudoClass::ReadWrite:
        return CSSSelector::PseudoClass::ReadWrite;
    case BunSelectorPseudoClass::PlaceholderShown:
        return CSSSelector::PseudoClass::PlaceholderShown;
    case BunSelectorPseudoClass::Default:
        return CSSSelector::PseudoClass::Default;
    case BunSelectorPseudoClass::Checked:
        return CSSSelector::PseudoClass::Checked;
    case BunSelectorPseudoClass::Indeterminate:
        return CSSSelector::PseudoClass::Indeterminate;
    case BunSelectorPseudoClass::Valid:
        return CSSSelector::PseudoClass::Valid;
    case BunSelectorPseudoClass::Invalid:
        return CSSSelector::PseudoClass::Invalid;
    case BunSelectorPseudoClass::InRange:
        return CSSSelector::PseudoClass::InRange;
    case BunSelectorPseudoClass::OutOfRange:
        return CSSSelector::PseudoClass::OutOfRange;
    case BunSelectorPseudoClass::Required:
        return CSSSelector::PseudoClass::Required;
    case BunSelectorPseudoClass::Optional:
        return CSSSelector::PseudoClass::Optional;
    case BunSelectorPseudoClass::UserValid:
        return CSSSelector::PseudoClass::UserValid;
    case BunSelectorPseudoClass::UserInvalid:
        return CSSSelector::PseudoClass::UserInvalid;
    case BunSelectorPseudoClass::Open:
        return CSSSelector::PseudoClass::Open;
    case BunSelectorPseudoClass::Modal:
        return CSSSelector::PseudoClass::Modal;
    case BunSelectorPseudoClass::PopoverOpen:
        return CSSSelector::PseudoClass::PopoverOpen;
    case BunSelectorPseudoClass::Defined:
        return CSSSelector::PseudoClass::Defined;
    case BunSelectorPseudoClass::Heading:
        return CSSSelector::PseudoClass::Heading;
    }
    RELEASE_ASSERT_NOT_REACHED();
}

static CSSSelector::Relation toRelation(BunSelectorRelation relation)
{
    switch (relation) {
    case BunSelectorRelation::Subselector:
        return CSSSelector::Relation::Subselector;
    case BunSelectorRelation::Descendant:
        return CSSSelector::Relation::DescendantSpace;
    case BunSelectorRelation::Child:
        return CSSSelector::Relation::Child;
    case BunSelectorRelation::DirectAdjacent:
        return CSSSelector::Relation::DirectAdjacent;
    case BunSelectorRelation::IndirectAdjacent:
        return CSSSelector::Relation::IndirectAdjacent;
    case BunSelectorRelation::End:
        break;
    }
    RELEASE_ASSERT_NOT_REACHED();
}

static CSSSelector::Match toAttributeMatch(BunSelectorOpKind kind)
{
    switch (kind) {
    case BunSelectorOpKind::AttributeSet:
        return CSSSelector::Match::Set;
    case BunSelectorOpKind::AttributeExact:
        return CSSSelector::Match::Exact;
    case BunSelectorOpKind::AttributeList:
        return CSSSelector::Match::List;
    case BunSelectorOpKind::AttributeHyphen:
        return CSSSelector::Match::Hyphen;
    case BunSelectorOpKind::AttributeBegin:
        return CSSSelector::Match::Begin;
    case BunSelectorOpKind::AttributeEnd:
        return CSSSelector::Match::End;
    case BunSelectorOpKind::AttributeContain:
        return CSSSelector::Match::Contain;
    default:
        break;
    }
    RELEASE_ASSERT_NOT_REACHED();
}

static CSSSelector::AttributeMatchType toAttributeMatchType(BunSelectorAttributeCase attributeCase)
{
    switch (attributeCase) {
    case BunSelectorAttributeCase::Sensitive:
        return CSSSelector::AttributeMatchType::CaseSensitive;
    case BunSelectorAttributeCase::Insensitive:
        return CSSSelector::AttributeMatchType::CaseInsensitive;
    case BunSelectorAttributeCase::InsensitiveInHTML:
        return CSSSelector::AttributeMatchType::Default;
    }
    RELEASE_ASSERT_NOT_REACHED();
}

// [class~="foo"] selects the same elements as .foo, so matching can use the tokenized ElementData::classNames().
static bool isEquivalentToClassSelector(const CSSSelector& selector, bool inQuirksMode)
{
    // Quirks mode ASCII-lowercases the class list while [class~=] stays case-sensitive.
    if (inQuirksMode)
        return false;

    if (selector.match() != CSSSelector::Match::List)
        return false;

    // [CLASS~=foo] and [*|class~=foo] stay on the general attribute path.
    if (selector.attribute() != HTMLNames::classAttr)
        return false;

    if (selector.attributeMatchType() == CSSSelector::AttributeMatchType::CaseInsensitive)
        return false;

    // Neither [class~=""] nor a value with whitespace can match anything, unlike a class selector.
    auto& value = selector.value();
    return !value.isEmpty() && value.find(isASCIIWhitespace<char16_t>) == notFound;
}

// SelectorChecker, SelectorQuery and SelectorFilter trust the shape of the list: each RELEASE_ASSERT here stands for a bad read there.
class BunSelectorListBuilder {
public:
    explicit BunSelectorListBuilder(bool inQuirksMode)
        : m_inQuirksMode(inQuirksMode)
    {
    }

    std::optional<CSSSelectorList> build(std::span<const BunSelectorOp> ops)
    {
        RELEASE_ASSERT(!ops.empty());
        auto list = buildSelectorList(ops, IsHasArgument::No);
        if (m_sawInvalidString)
            return std::nullopt;
        return CSSSelectorList { WTF::move(list) };
    }

private:
    enum class IsHasArgument : bool { No, Yes };

    AtomString toAtomString(const BunSelectorString& string)
    {
        if (!string.length)
            return emptyAtom();
        auto result = AtomString::fromUTF8(byteCast<char>(unsafeMakeSpan(string.data, string.length)));
        if (result.isNull()) {
            m_sawInvalidString = true;
            return emptyAtom();
        }
        return result;
    }

    MutableCSSSelectorList buildSelectorList(std::span<const BunSelectorOp> ops, IsHasArgument isHasArgument)
    {
        MutableCSSSelectorList list;
        while (!ops.empty())
            list.append(buildComplexSelector(ops, isHasArgument));
        return list;
    }

    std::unique_ptr<CSSSelectorList> buildArgumentList(std::span<const BunSelectorOp> ops, IsHasArgument isHasArgument = IsHasArgument::No)
    {
        RELEASE_ASSERT(!ops.empty());
        return makeUnique<CSSSelectorList>(buildSelectorList(ops, isHasArgument));
    }

    // Takes the ops of one complex selector off the front of `ops`.
    std::unique_ptr<MutableCSSSelector> buildComplexSelector(std::span<const BunSelectorOp>& ops, IsHasArgument isHasArgument)
    {
        std::unique_ptr<MutableCSSSelector> rightmost;
        MutableCSSSelector* leftmost = nullptr;
        bool isFirstInCompound = true;

        while (true) {
            RELEASE_ASSERT(!ops.empty());
            auto& op = ops.front();
            ops = ops.subspan(1);
            RELEASE_ASSERT(op.nestedCount <= ops.size());
            auto arguments = ops.first(op.nestedCount);
            ops = ops.subspan(op.nestedCount);

            bool isLeftmost = op.relation == BunSelectorRelation::End;

            // The fast paths of SelectorQuery and the quirks mode :hover check expect a tag at the start of its compound.
            RELEASE_ASSERT(op.kind != BunSelectorOpKind::Tag || isFirstInCompound);

            // An argument of :has() ends on the left in a HasScope of its own compound. The traversal :has() does is derived from the combinators up to it.
            RELEASE_ASSERT((op.kind == BunSelectorOpKind::HasScope) == (isHasArgument == IsHasArgument::Yes && isLeftmost));
            RELEASE_ASSERT(op.kind != BunSelectorOpKind::HasScope || (leftmost && isFirstInCompound));

            auto selector = buildSimpleSelector(op, arguments);
            if (!isLeftmost)
                selector->setRelation(toRelation(op.relation));

            auto* added = selector.get();
            if (leftmost)
                leftmost->setPrecedingInComplexSelector(WTF::move(selector));
            else
                rightmost = WTF::move(selector);
            leftmost = added;

            if (isLeftmost)
                return rightmost;
            isFirstInCompound = op.relation != BunSelectorRelation::Subselector;
        }
    }

    std::unique_ptr<MutableCSSSelector> buildSimpleSelector(const BunSelectorOp& op, std::span<const BunSelectorOp> arguments)
    {
        if (op.kind == BunSelectorOpKind::PseudoClass)
            return buildPseudoClass(op, arguments);

        RELEASE_ASSERT(arguments.empty());

        switch (op.kind) {
        case BunSelectorOpKind::Tag:
            return makeUnique<MutableCSSSelector>(tagName(op));
        case BunSelectorOpKind::Id:
        case BunSelectorOpKind::Class: {
            auto selector = makeUnique<MutableCSSSelector>();
            selector->setMatch(op.kind == BunSelectorOpKind::Id ? CSSSelector::Match::Id : CSSSelector::Match::Class);
            selector->setValue(toAtomString(op.name), m_inQuirksMode);
            return selector;
        }
        case BunSelectorOpKind::AttributeSet:
        case BunSelectorOpKind::AttributeExact:
        case BunSelectorOpKind::AttributeList:
        case BunSelectorOpKind::AttributeHyphen:
        case BunSelectorOpKind::AttributeBegin:
        case BunSelectorOpKind::AttributeEnd:
        case BunSelectorOpKind::AttributeContain: {
            auto selector = makeUnique<MutableCSSSelector>();
            selector->setMatch(toAttributeMatch(op.kind));
            if (op.kind != BunSelectorOpKind::AttributeSet)
                selector->setValue(toAtomString(op.value));
            selector->setAttribute(attributeName(op), toAttributeMatchType(static_cast<BunSelectorAttributeCase>(op.detail)));
            if (isEquivalentToClassSelector(selector->selector(), m_inQuirksMode))
                selector->setIsEquivalentToClassSelector();
            return selector;
        }
        case BunSelectorOpKind::HasScope: {
            auto selector = makeUnique<MutableCSSSelector>();
            selector->setMatch(CSSSelector::Match::HasScope);
            return selector;
        }
        case BunSelectorOpKind::PseudoClass:
        case BunSelectorOpKind::String:
        case BunSelectorOpKind::Integer:
            break;
        }
        RELEASE_ASSERT_NOT_REACHED();
    }

    // Without a style sheet there is no default namespace, so "a" and "*|a" are the same name.
    QualifiedName tagName(const BunSelectorOp& op)
    {
        switch (op.nameSpace) {
        case BunSelectorNamespace::Unspecified:
        case BunSelectorNamespace::Any:
            return { nullAtom(), toAtomString(op.name), starAtom() };
        case BunSelectorNamespace::None:
            return { emptyAtom(), toAtomString(op.name), emptyAtom() };
        }
        RELEASE_ASSERT_NOT_REACHED();
    }

    QualifiedName attributeName(const BunSelectorOp& op)
    {
        switch (op.nameSpace) {
        case BunSelectorNamespace::Unspecified:
        case BunSelectorNamespace::None:
            return { nullAtom(), toAtomString(op.name), nullAtom() };
        case BunSelectorNamespace::Any:
            return { starAtom(), toAtomString(op.name), starAtom() };
        }
        RELEASE_ASSERT_NOT_REACHED();
    }

    std::unique_ptr<MutableCSSSelector> buildPseudoClass(const BunSelectorOp& op, std::span<const BunSelectorOp> arguments)
    {
        auto pseudoClass = toPseudoClass(static_cast<BunSelectorPseudoClass>(op.detail));

        auto selector = makeUnique<MutableCSSSelector>();
        selector->setMatch(CSSSelector::Match::PseudoClass);
        selector->setPseudoClass(pseudoClass);

        switch (pseudoClass) {
        case CSSSelector::PseudoClass::Not:
            selector->setSelectorList(buildArgumentList(arguments));
            break;
        case CSSSelector::PseudoClass::Has:
            selector->setSelectorList(buildArgumentList(arguments, IsHasArgument::Yes));
            break;
        case CSSSelector::PseudoClass::Is:
        case CSSSelector::PseudoClass::Where:
        case CSSSelector::PseudoClass::WebKitAny:
            // The list may be empty but not null.
            selector->setSelectorList(arguments.empty() ? makeUnique<CSSSelectorList>() : buildArgumentList(arguments));
            break;
        case CSSSelector::PseudoClass::Host:
            if (!arguments.empty()) {
                auto list = buildArgumentList(arguments);
                RELEASE_ASSERT(list->size() == 1);
                selector->setSelectorList(WTF::move(list));
            }
            break;
        case CSSSelector::PseudoClass::NthChild:
        case CSSSelector::PseudoClass::NthLastChild:
            if (!arguments.empty())
                selector->setSelectorList(buildArgumentList(arguments));
            selector->setNth(op.a, op.b);
            break;
        case CSSSelector::PseudoClass::NthOfType:
        case CSSSelector::PseudoClass::NthLastOfType:
            RELEASE_ASSERT(arguments.empty());
            selector->setNth(op.a, op.b);
            break;
        case CSSSelector::PseudoClass::Lang:
            RELEASE_ASSERT(!arguments.empty());
            selector->setLangList(FixedVector<PossiblyQuotedIdentifier>::map(arguments, [&](auto& argument) {
                RELEASE_ASSERT(argument.kind == BunSelectorOpKind::String && !argument.nestedCount);
                return PossiblyQuotedIdentifier { toAtomString(argument.name) };
            }));
            break;
        case CSSSelector::PseudoClass::Heading:
            if (!arguments.empty()) {
                selector->setIntegerList(FixedVector<int>::map(arguments, [](auto& argument) {
                    RELEASE_ASSERT(argument.kind == BunSelectorOpKind::Integer && !argument.nestedCount);
                    return argument.a;
                }));
            }
            break;
        case CSSSelector::PseudoClass::Dir:
        case CSSSelector::PseudoClass::State:
            RELEASE_ASSERT(arguments.empty());
            selector->setArgument(toAtomString(op.name));
            break;
        default:
            RELEASE_ASSERT(arguments.empty());
            break;
        }
        return selector;
    }

    bool m_inQuirksMode;
    bool m_sawInvalidString { false };
};

std::optional<CSSSelectorList> parseCSSSelectorList(const String& string, bool inQuirksMode)
{
    auto result = string.tryGetUTF8([&](std::span<const char8_t> utf8) -> std::optional<CSSSelectorList> {
        BunSelectorOpList list;
        if (!Bun__CSS__parseSelectorListForDOM(byteCast<uint8_t>(utf8).data(), utf8.size(), &list))
            return std::nullopt;
        auto freeList = makeScopeExit([&] {
            Bun__CSS__freeSelectorListForDOM(&list);
        });
        return BunSelectorListBuilder { inQuirksMode }.build(unsafeMakeSpan(list.ops, list.opCount));
    }, StrictConversionReplacingUnpairedSurrogatesWithFFFD);

    if (!result)
        return std::nullopt;
    return WTF::move(*result);
}

} // namespace WebCore
