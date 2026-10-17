#pragma once

#include <memory>
#include <wtf/CheckedPtr.h>
#include <wtf/TZoneMalloc.h>
#include <wtf/Vector.h>
#include <wtf/WeakPtr.h>

namespace WebCore {

class CSSStyleSheet;
class Node;
class TreeScope;

namespace Style {

class RuleSet;

// The style sheets of a document or a shadow tree. There is none until the first <style> is inserted, and none after the last one has left,
// so a tree without style sheets costs one look at an empty table.
class Scope final : public CanMakeWeakPtr<Scope>, public CanMakeCheckedPtr<Scope> {
    WTF_MAKE_TZONE_ALLOCATED(Scope);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(Scope);
public:
    explicit Scope(const TreeScope&);
    ~Scope();

    static Scope& forNode(const Node&);
    static Scope* forNodeIfExists(const Node&);
    static Scope* forTreeScopeIfExists(const TreeScope&);

    void addStyleSheetCandidateNode(Node&, bool createdByParser);
    // May destroy the scope.
    void removeStyleSheetCandidateNode(Node&);

    void didChangeActiveStyleSheetCandidates();
    void didChangeStyleSheetContents();

    // In tree order.
    Vector<Ref<CSSStyleSheet>> styleSheetsForStyleSheetList() const;

    // Parses what has not been parsed yet.
    const RuleSet& ruleSet();

private:
    const TreeScope& m_treeScope;
    // In tree order. A node takes itself out before it dies.
    Vector<Node*> m_styleSheetCandidateNodes;
    std::unique_ptr<RuleSet> m_ruleSet;
};

} // namespace Style
} // namespace WebCore
