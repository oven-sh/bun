#pragma once

#include <memory>
#include <wtf/HashCountedSet.h>
#include <wtf/HashMap.h>
#include <wtf/HashSet.h>
#include <wtf/Noncopyable.h>
#include <wtf/TZoneMalloc.h>
#include <wtf/Threading.h>
#include <wtf/text/AtomStringHash.h>

namespace JSC {
class VM;
}

namespace WebCore {

class CSSParsedValueCache;
class ContainerChildRemovalScope;
class CustomElementReactionStack;
class Element;
class EventTarget;
class HTMLNameCache;
class NewlineThenWhitespaceStringsTable;
class QualifiedNameCache;
class ScopedEventQueue;
class SelectorQueryCache;
class SpaceSplitStringData;
class StaticNames;
class TreeScope;
struct ChildListMutationAccumulators;
struct FormAtomStrings;
struct HTMLTreeBuilderAttributeMaps;
struct MutationObserverAgentData;
struct WindowGlobalObjectRead;
enum class CSSPropertyID : uint16_t;

namespace Style {
class Scope;
}

// The DOM's per-VM state. Upstream keeps it in ThreadGlobalData or in process-wide statics, which
// only works with one DOM thread. Bun has a VM per thread, and each can have its own DOM.
// Created the first time a VM uses the DOM.
class DOMClientData {
    WTF_MAKE_TZONE_ALLOCATED(DOMClientData);
    WTF_MAKE_NONCOPYABLE(DOMClientData);

public:
    DOMClientData();
    ~DOMClientData();

    // Empties every member that holds nodes or names, in an order in which their destructors can still use the others.
    // A new member that holds either has to be added there.
    void willDestroyVM();

    CustomElementReactionStack*& customElementReactionStack() { return m_customElementReactionStack; }
    unsigned& customElementReactionDisallowedCount() { return m_customElementReactionDisallowedCount; }
    unsigned& documentTasksRunInLoopIteration(uint64_t);

    QualifiedNameCache& qualifiedNameCache();
    StaticNames& staticNames()
    {
        if (!m_staticNames) [[unlikely]]
            createStaticNames();
        return *m_staticNames;
    }
    HTMLNameCache& htmlNameCache();
    HTMLTreeBuilderAttributeMaps& treeBuilderAttributeMaps();
    NewlineThenWhitespaceStringsTable& newlineThenWhitespaceStringsTable();
    ScopedEventQueue& scopedEventQueue();
    SelectorQueryCache& selectorQueryCache();
    MutationObserverAgentData& mutationObserverAgentData();
    ChildListMutationAccumulators& childListMutationAccumulators();
    const FormAtomStrings& formAtomStrings();
    HashCountedSet<EventTarget*>& gcReachableRefs() { return m_gcReachableRefs; }

#if ASSERT_ENABLED
    unsigned& scriptDisallowedScopeCount() { return m_scriptDisallowedScopeCount; }
    void*& eventAllowedScope() { return m_eventAllowedScope; }
    ContainerChildRemovalScope*& containerChildRemovalScope() { return m_containerChildRemovalScope; }
#endif
    HashMap<AtomString, AtomString>& htmlEventHandlerNames() { return m_htmlEventHandlerNames; }
    HashSet<Ref<Element>>& elementsDispatchingSimulatedClicks() { return m_elementsDispatchingSimulatedClicks; }
    HashMap<AtomString, AtomString>& windowEventHandlerNames() { return m_windowEventHandlerNames; }
    HashMap<AtomString, SpaceSplitStringData*>& spaceSplitStrings() { return m_spaceSplitStrings; }
    CSSParsedValueCache& cssParsedValueCache();
    HashMap<AtomString, CSSPropertyID>& cssPropertyIDsByJavaScriptName();
    HashMap<const TreeScope*, std::unique_ptr<Style::Scope>>& styleScopes() { return m_styleScopes; }
    WindowGlobalObjectRead*& windowGlobalObjectRead() { return m_windowGlobalObjectRead; }

private:
    void createStaticNames();

    CustomElementReactionStack* m_customElementReactionStack { nullptr };
    unsigned m_customElementReactionDisallowedCount { 0 };
    uint64_t m_documentTaskLoopIteration { 0 };
    unsigned m_documentTasksRun { 0 };

    std::unique_ptr<QualifiedNameCache> m_qualifiedNameCache;
    std::unique_ptr<StaticNames> m_staticNames;
    std::unique_ptr<HTMLNameCache> m_htmlNameCache;
    std::unique_ptr<HTMLTreeBuilderAttributeMaps> m_treeBuilderAttributeMaps;
    std::unique_ptr<NewlineThenWhitespaceStringsTable> m_newlineThenWhitespaceStringsTable;
    HashCountedSet<EventTarget*> m_gcReachableRefs;
    std::unique_ptr<ScopedEventQueue> m_scopedEventQueue;
    std::unique_ptr<SelectorQueryCache> m_selectorQueryCache;
    std::unique_ptr<MutationObserverAgentData> m_mutationObserverAgentData;
    std::unique_ptr<ChildListMutationAccumulators> m_childListMutationAccumulators;
    std::unique_ptr<FormAtomStrings> m_formAtomStrings;

#if ASSERT_ENABLED
    unsigned m_scriptDisallowedScopeCount { 0 };
    void* m_eventAllowedScope { nullptr };
    ContainerChildRemovalScope* m_containerChildRemovalScope { nullptr };
#endif
    HashMap<AtomString, AtomString> m_htmlEventHandlerNames;
    HashSet<Ref<Element>> m_elementsDispatchingSimulatedClicks;
    HashMap<AtomString, AtomString> m_windowEventHandlerNames;
    HashMap<AtomString, SpaceSplitStringData*> m_spaceSplitStrings;
    std::unique_ptr<CSSParsedValueCache> m_cssParsedValueCache;
    std::unique_ptr<HashMap<AtomString, CSSPropertyID>> m_cssPropertyIDsByJavaScriptName;
    HashMap<const TreeScope*, std::unique_ptr<Style::Scope>> m_styleScopes;
    WindowGlobalObjectRead* m_windowGlobalObjectRead { nullptr };
};

DOMClientData& domClientData(JSC::VM&);

// What WTF::Thread::m_clientData holds on a thread that has used the DOM.
struct DOMClientDataThreadSlot final : Thread::ClientData {
    explicit DOMClientDataThreadSlot(DOMClientData& data)
        : ClientData(Type::WebCoreThreadGlobalData)
        , data(data)
    {
    }

    DOMClientData& data;
};

DOMClientData& domClientDataSlow();

// The current thread's.
inline DOMClientData& domClientData()
{
    if (auto* slot = static_cast<DOMClientDataThreadSlot*>(Thread::currentSingleton().m_clientData.get())) [[likely]]
        return slot->data;
    return domClientDataSlow();
}

} // namespace WebCore
