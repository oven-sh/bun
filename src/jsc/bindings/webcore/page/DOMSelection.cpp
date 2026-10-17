#include "config.h"
#include "DOMSelection.h"

#include "BoundaryPoint.h"
#include "ContainerNodeInlines.h"
#include "Document.h"
#include "Event.h"
#include "EventNames.h"
#include "NodeInlines.h"
#include "Range.h"
#include "SimpleRange.h"
#include "TaskSource.h"
#include "Window.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(DOMSelection);

DOMSelection::DOMSelection(Window& window)
    : WindowProperty(window)
{
}

DOMSelection::~DOMSelection() = default;

Node* DOMSelection::anchorNode() const
{
    if (!m_range)
        return nullptr;
    return m_isBackward ? &m_range->endContainer() : &m_range->startContainer();
}

unsigned DOMSelection::anchorOffset() const
{
    if (!m_range)
        return 0;
    return m_isBackward ? m_range->endOffset() : m_range->startOffset();
}

Node* DOMSelection::focusNode() const
{
    if (!m_range)
        return nullptr;
    return m_isBackward ? &m_range->startContainer() : &m_range->endContainer();
}

unsigned DOMSelection::focusOffset() const
{
    if (!m_range)
        return 0;
    return m_isBackward ? m_range->startOffset() : m_range->endOffset();
}

bool DOMSelection::isCollapsed() const
{
    return !m_range || m_range->collapsed();
}

String DOMSelection::type() const
{
    if (!m_range)
        return "None"_s;
    return m_range->collapsed() ? "Caret"_s : "Range"_s;
}

String DOMSelection::direction() const
{
    if (isCollapsed())
        return "none"_s;
    return m_isBackward ? "backward"_s : "forward"_s;
}

bool DOMSelection::isInDocument(const Node& node) const
{
    return &node.rootNode() == document();
}

void DOMSelection::setRange(RefPtr<Range>&& range, bool isBackward)
{
    bool changed = !range != !m_range || (range && (makeSimpleRange(*range) != makeSimpleRange(*m_range)));
    m_range = WTF::move(range);
    m_isBackward = isBackward;

    RefPtr document = this->document();
    if (!changed || !document || std::exchange(m_hasScheduledSelectionChangeEvent, true))
        return;
    document->queueTask(TaskSource::UserInteraction, [protectedThis = Ref { *this }, document] {
        protectedThis->m_hasScheduledSelectionChangeEvent = false;
        if (!protectedThis->window() || protectedThis->window()->closed())
            return;
        document->dispatchEvent(Event::create(eventNames().selectionchangeEvent, Event::CanBubble::No, Event::IsCancelable::No));
    });
}

ExceptionOr<void> DOMSelection::select(const BoundaryPoint& anchor, const BoundaryPoint& focus)
{
    RefPtr document = this->document();
    if (!document)
        return { };

    auto order = treeOrder(anchor, focus);
    bool isBackward = is_gt(order);
    // An anchor that has left the document's tree does not count.
    auto& start = isBackward || order == std::partial_ordering::unordered ? focus : anchor;
    auto& end = isBackward ? anchor : focus;

    Ref range = Range::create(*document);
    if (auto result = range->setStart(start.container.copyRef(), start.offset); result.hasException())
        return result.releaseException();
    if (auto result = range->setEnd(end.container.copyRef(), end.offset); result.hasException())
        return result.releaseException();
    setRange(WTF::move(range), isBackward);
    return { };
}

ExceptionOr<Ref<Range>> DOMSelection::getRangeAt(unsigned index) const
{
    if (index || !m_range)
        return Exception { ExceptionCode::IndexSizeError };
    return Ref { *m_range };
}

void DOMSelection::addRange(Range& range)
{
    if (!m_range && isInDocument(range.startContainer()))
        setRange(&range);
}

ExceptionOr<void> DOMSelection::removeRange(Range& range)
{
    if (&range != m_range)
        return Exception { ExceptionCode::NotFoundError };
    setRange(nullptr);
    return { };
}

void DOMSelection::removeAllRanges()
{
    setRange(nullptr);
}

ExceptionOr<void> DOMSelection::collapse(Node* node, unsigned offset)
{
    if (!node) {
        removeAllRanges();
        return { };
    }
    if (auto result = Range::checkNodeOffsetPair(*node, offset); result.hasException())
        return result.releaseException();
    if (!isInDocument(*node))
        return { };
    BoundaryPoint point { *node, offset };
    return select(point, point);
}

ExceptionOr<void> DOMSelection::collapseToStart()
{
    if (!m_range)
        return Exception { ExceptionCode::InvalidStateError };
    BoundaryPoint point { m_range->startContainer(), m_range->startOffset() };
    return select(point, point);
}

ExceptionOr<void> DOMSelection::collapseToEnd()
{
    if (!m_range)
        return Exception { ExceptionCode::InvalidStateError };
    BoundaryPoint point { m_range->endContainer(), m_range->endOffset() };
    return select(point, point);
}

ExceptionOr<void> DOMSelection::extend(Node& node, unsigned offset)
{
    if (!isInDocument(node))
        return { };
    if (!m_range)
        return Exception { ExceptionCode::InvalidStateError };
    return select({ *anchorNode(), anchorOffset() }, { node, offset });
}

ExceptionOr<void> DOMSelection::setBaseAndExtent(Node& anchorNode, unsigned anchorOffset, Node& focusNode, unsigned focusOffset)
{
    if (anchorOffset > anchorNode.length() || focusOffset > focusNode.length())
        return Exception { ExceptionCode::IndexSizeError };
    if (!isInDocument(anchorNode) || !isInDocument(focusNode))
        return { };
    return select({ anchorNode, anchorOffset }, { focusNode, focusOffset });
}

ExceptionOr<void> DOMSelection::selectAllChildren(Node& node)
{
    if (node.isDocumentTypeNode())
        return Exception { ExceptionCode::InvalidNodeTypeError };
    if (!isInDocument(node))
        return { };
    return select({ node, 0 }, { node, node.countChildNodes() });
}

void DOMSelection::deleteFromDocument()
{
    if (RefPtr range = m_range)
        range->deleteContents();
}

bool DOMSelection::containsNode(Node& node, bool allowPartialContainment) const
{
    if (!m_range)
        return false;
    auto range = makeSimpleRange(*m_range);
    return allowPartialContainment ? intersects(range, node) : contains(range, node);
}

String DOMSelection::toString() const
{
    return m_range ? m_range->toString() : emptyString();
}

} // namespace WebCore
