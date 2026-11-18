#include "root.h"
#include "Bindgen/DOMJIT.h"
#include "GeneratedBindings+Interfaces.h"
#include "RemovableFeatures.h"
#include <JavaScriptCore/JSCInlines.h>

// `Layout` in src/dom/api/core/node.rs. The offsets are in the cell of a node, or else in its arena.
struct NodeLayout {
    uint32_t head;
    uint32_t kind;
    uint32_t nodeType;
    uint32_t edge;
    uint32_t bitsOfKind;
    uint32_t flags;
    uint32_t placesOfEdgesInArena;
    uint32_t namesInArena;
    uint32_t isConnected;
    uint32_t isXML;
    uint32_t bitsBeforeName;
    uint32_t firstHTMLKind;
    uint32_t manyEdges;
    uint32_t childNodes, children, classList, attributes, style, dataset, rows, implementation;
};
extern "C" const NodeLayout Bun__DOM__nodeLayout;

namespace Bun::Bindgen::DOMJIT {
using namespace JSC;
using Generated::JSNode;
using Address = CCallHelpers::Address;
using BaseIndex = CCallHelpers::BaseIndex;
using JumpList = CCallHelpers::JumpList;
using TrustedImm32 = CCallHelpers::TrustedImm32;

static constexpr const NodeLayout& layout = Bun__DOM__nodeLayout;
static constexpr TrustedImm32 elementNode { 1 };
static constexpr TrustedImm32 textNode { 3 };

static void loadArena(CCallHelpers& jit, GPRReg node, GPRReg result)
{
    jit.load64(Address(node, layout.head), result);
    jit.urshift64(TrustedImm32(24), result);
    jit.lshift64(TrustedImm32(8), result);
}

static JumpList loadEdge(CCallHelpers& jit, GPRReg result, GPRReg node, GPRReg scratch, uint32_t edge)
{
    JumpList hasFailed;
    jit.load8(Address(node, layout.edge), scratch);
    jit.load64(Address(node, OBJECT_OFFSETOF(JSNode, m_rare)), result);
    auto isOnly = jit.branch32(CCallHelpers::Equal, scratch, TrustedImm32(edge + 1));
    hasFailed.append(jit.branch32(CCallHelpers::NotEqual, scratch, TrustedImm32(layout.manyEdges)));
    jit.load8(Address(result, JSCell::indexingTypeAndMiscOffset()), scratch);
    jit.and32(TrustedImm32(IndexingShapeMask), scratch);
    hasFailed.append(jit.branch32(CCallHelpers::NotEqual, scratch, TrustedImm32(ContiguousShape)));
    jit.loadPtr(Address(result, JSObject::butterflyOffset()), result);
    loadArena(jit, node, scratch);
    jit.load8(Address(scratch, layout.placesOfEdgesInArena + edge), scratch);
    jit.add32(scratch, scratch);
    hasFailed.append(jit.branch32(CCallHelpers::BelowOrEqual, Address(result, Butterfly::offsetOfPublicLength()), scratch));
    jit.getEffectiveAddress(BaseIndex(result, scratch, CCallHelpers::TimesEight), result);
    hasFailed.append(jit.branch32(CCallHelpers::NotEqual, Address(result), TrustedImm32(edge)));
    jit.load64(Address(result, sizeof(JSValue)), result);
    isOnly.link(&jit);
    hasFailed.append(jit.branchIfEmpty(result));
    return hasFailed;
}

static JumpList findElement(CCallHelpers& jit, GPRReg result, GPRReg node, ptrdiff_t first, ptrdiff_t next)
{
    jit.load64(Address(node, first), result);
    auto again = jit.label();
    auto isBare = jit.branchIfEmpty(result);
    auto isNone = jit.branchIfNull(result);
    auto isElement = jit.branch8(CCallHelpers::Equal, Address(result, layout.nodeType), elementNode);
    jit.load64(Address(result, next), result);
    jit.jump().linkTo(again, &jit);
    isNone.link(&jit);
    isElement.link(&jit);
    return isBare;
}

enum class Case : bool { AsItIs,
    OfTagNames };

static JumpList loadName(CCallHelpers& jit, GPRReg result, GPRReg node, GPRReg scratch, Case nameCase)
{
    jit.load16(Address(node, layout.bitsOfKind), result);
    jit.urshift32(TrustedImm32(layout.bitsBeforeName), result);
    jit.add32(result, result);
    if (nameCase == Case::OfTagNames) {
        jit.load8(Address(node, layout.kind), scratch);
        auto isForeign = jit.branch32(CCallHelpers::Below, scratch, TrustedImm32(layout.firstHTMLKind));
        jit.loadPtr(Address(node, OBJECT_OFFSETOF(JSNode, m_document)), scratch);
        jit.load16(Address(scratch, layout.bitsOfKind), scratch);
        auto isInXML = jit.branchTest32(CCallHelpers::NonZero, scratch, TrustedImm32(layout.isXML));
        jit.add32(TrustedImm32(1), result);
        isForeign.link(&jit);
        isInXML.link(&jit);
    }
    loadArena(jit, node, scratch);
    jit.loadPtr(Address(scratch, layout.namesInArena), scratch);
    jit.load64(BaseIndex(scratch, result, CCallHelpers::TimesEight), result);
    return jit.branchIfEmpty(result);
}

#define DEFINE_SHORTCUT(name)                                                                 \
    Shortcut name;                                                                            \
    static ALWAYS_INLINE JumpList name##Body(CCallHelpers&, GPRReg, GPRReg, GPRReg);          \
    NEVER_INLINE JumpList name(CCallHelpers& jit, GPRReg result, GPRReg node, GPRReg scratch) \
    {                                                                                         \
        BUN_REMOVABLE_DEFINITION(JIT, name);                                                  \
        return name##Body(jit, result, node, scratch);                                        \
    }                                                                                         \
    static ALWAYS_INLINE JumpList name##Body(CCallHelpers& jit, GPRReg result, GPRReg node, [[maybe_unused]] GPRReg scratch)

#define DEFINE_EDGE_SHORTCUT(edge) \
    DEFINE_SHORTCUT(edge##Edge) { return loadEdge(jit, result, node, scratch, layout.edge); }

DEFINE_EDGE_SHORTCUT(childNodes)
DEFINE_EDGE_SHORTCUT(children)
DEFINE_EDGE_SHORTCUT(classList)
DEFINE_EDGE_SHORTCUT(attributes)
DEFINE_EDGE_SHORTCUT(style)
DEFINE_EDGE_SHORTCUT(dataset)
DEFINE_EDGE_SHORTCUT(rows)
DEFINE_EDGE_SHORTCUT(implementation)

DEFINE_SHORTCUT(isConnected)
{
    jit.test32(CCallHelpers::NonZero, Address(node, layout.flags), TrustedImm32(layout.isConnected), result);
    jit.boxBoolean(result, result);
    return {};
}

DEFINE_SHORTCUT(ownerDocument)
{
    jit.load64(Address(node, OBJECT_OFFSETOF(JSNode, m_document)), result);
    auto isOther = jit.branchPtr(CCallHelpers::NotEqual, result, node);
    jit.moveTrustedValue(jsNull(), result);
    isOther.link(&jit);
    return {};
}

DEFINE_SHORTCUT(parentElement)
{
    jit.load64(Address(node, OBJECT_OFFSETOF(JSNode, m_parent)), result);
    auto isNone = jit.branchIfNull(result);
    auto isElement = jit.branch8(CCallHelpers::Equal, Address(result, layout.nodeType), elementNode);
    jit.moveTrustedValue(jsNull(), result);
    isNone.link(&jit);
    isElement.link(&jit);
    return {};
}

DEFINE_SHORTCUT(firstElementChild) { return findElement(jit, result, node, OBJECT_OFFSETOF(JSNode, m_first), OBJECT_OFFSETOF(JSNode, m_next)); }
DEFINE_SHORTCUT(lastElementChild) { return findElement(jit, result, node, OBJECT_OFFSETOF(JSNode, m_last), OBJECT_OFFSETOF(JSNode, m_previous)); }
DEFINE_SHORTCUT(nextElementSibling) { return findElement(jit, result, node, OBJECT_OFFSETOF(JSNode, m_next), OBJECT_OFFSETOF(JSNode, m_next)); }
DEFINE_SHORTCUT(previousElementSibling) { return findElement(jit, result, node, OBJECT_OFFSETOF(JSNode, m_previous), OBJECT_OFFSETOF(JSNode, m_previous)); }

DEFINE_SHORTCUT(localName) { return loadName(jit, result, node, scratch, Case::AsItIs); }
DEFINE_SHORTCUT(tagName) { return loadName(jit, result, node, scratch, Case::OfTagNames); }

DEFINE_SHORTCUT(nodeName)
{
    jit.load8(Address(node, layout.nodeType), scratch);
    auto isElement = jit.branch32(CCallHelpers::Equal, scratch, elementNode);
    JumpList hasFailed = jit.branch32(CCallHelpers::NotEqual, scratch, textNode);
    isElement.link(&jit);
    hasFailed.append(loadName(jit, result, node, scratch, Case::OfTagNames));
    return hasFailed;
}

}
