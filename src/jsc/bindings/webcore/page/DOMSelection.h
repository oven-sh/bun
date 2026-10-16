#pragma once

#include "ExceptionOr.h"
#include "ScriptWrappable.h"
#include "WindowProperty.h"
#include <wtf/RefCounted.h>

namespace WebCore {

class Node;
class Range;

struct BoundaryPoint;

// https://w3c.github.io/selection-api/#selection-interface
// Written from the standard, on top of Range. Upstream's sits on FrameSelection and the editing code.
class DOMSelection final : public ScriptWrappable, public RefCounted<DOMSelection>, public WindowProperty {
    WTF_MAKE_TZONE_ALLOCATED(DOMSelection);
public:
    static Ref<DOMSelection> create(Window& window) { return adoptRef(*new DOMSelection(window)); }
    ~DOMSelection();

    Node* anchorNode() const;
    unsigned anchorOffset() const;
    Node* focusNode() const;
    unsigned focusOffset() const;
    bool isCollapsed() const;
    unsigned rangeCount() const { return m_range ? 1 : 0; }
    String type() const;
    String direction() const;

    ExceptionOr<Ref<Range>> getRangeAt(unsigned index) const;
    void addRange(Range&);
    ExceptionOr<void> removeRange(Range&);
    void removeAllRanges();

    ExceptionOr<void> collapse(Node*, unsigned offset);
    ExceptionOr<void> collapseToStart();
    ExceptionOr<void> collapseToEnd();
    ExceptionOr<void> extend(Node&, unsigned offset);
    ExceptionOr<void> setBaseAndExtent(Node& anchorNode, unsigned anchorOffset, Node& focusNode, unsigned focusOffset);
    ExceptionOr<void> selectAllChildren(Node&);

    void deleteFromDocument();
    bool containsNode(Node&, bool allowPartialContainment) const;
    String toString() const;

private:
    explicit DOMSelection(Window&);

    bool isInDocument(const Node&) const;
    ExceptionOr<void> select(const BoundaryPoint& anchor, const BoundaryPoint& focus);
    void setRange(RefPtr<Range>&&, bool isBackward = false);

    RefPtr<Range> m_range;
    bool m_isBackward { false };
    bool m_hasScheduledSelectionChangeEvent { false };
};

} // namespace WebCore
