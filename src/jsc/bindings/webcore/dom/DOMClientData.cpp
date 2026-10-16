#include "config.h"
#include "DOMClientData.h"

#include "BunClientData.h"
#include "CSSParser.h"
#include "ChildListMutationScope.h"
#include "CommonVM.h"
#include "Event.h"
#include "HTMLDocumentParserFastPath.h"
#include "FormAtomStrings.h"
#include "HTMLNameCache.h"
#include "HTMLSlotElement.h"
#include "HTMLTreeBuilder.h"
#include "MutationObserver.h"
#include "QualifiedNameCache.h"
#include "ScopedEventQueue.h"
#include "SelectorQuery.h"
#include "StaticNames.h"
#include "StyleScope.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(DOMClientData);

DOMClientData::DOMClientData() = default;
DOMClientData::~DOMClientData() = default;

void DOMClientData::willDestroyVM()
{
    // Nodes first: their destructors use the GC-reachable set and the name cache.
    m_elementsDispatchingSimulatedClicks.clear();
    m_mutationObserverAgentData = nullptr;
    m_scopedEventQueue = nullptr;
    m_childListMutationAccumulators = nullptr;
    m_styleScopes.clear();
    m_cssParsedValueCache = nullptr;
    m_cssPropertyIDsByJavaScriptName = nullptr;

    // Then what holds a QualifiedName: the last reference removes it from the cache.
    m_selectorQueryCache = nullptr;
    m_htmlNameCache = nullptr;
    m_treeBuilderAttributeMaps = nullptr;
    m_staticNames = nullptr;
    m_qualifiedNameCache = nullptr;

    Thread::currentSingleton().m_clientData = nullptr;
}

void DOMClientData::createStaticNames()
{
    m_staticNames = makeUnique<StaticNames>();
}

CSSParsedValueCache& DOMClientData::cssParsedValueCache()
{
    if (!m_cssParsedValueCache)
        m_cssParsedValueCache = makeUnique<CSSParsedValueCache>();
    return *m_cssParsedValueCache;
}

HashMap<AtomString, CSSPropertyID>& DOMClientData::cssPropertyIDsByJavaScriptName()
{
    if (!m_cssPropertyIDsByJavaScriptName)
        m_cssPropertyIDsByJavaScriptName = makeUnique<HashMap<AtomString, CSSPropertyID>>();
    return *m_cssPropertyIDsByJavaScriptName;
}

QualifiedNameCache& DOMClientData::qualifiedNameCache()
{
    if (!m_qualifiedNameCache)
        m_qualifiedNameCache = makeUnique<QualifiedNameCache>();
    return *m_qualifiedNameCache;
}

HTMLNameCache& DOMClientData::htmlNameCache()
{
    if (!m_htmlNameCache)
        m_htmlNameCache = makeUnique<HTMLNameCache>();
    return *m_htmlNameCache;
}

HTMLTreeBuilderAttributeMaps& DOMClientData::treeBuilderAttributeMaps()
{
    if (!m_treeBuilderAttributeMaps)
        m_treeBuilderAttributeMaps = makeUnique<HTMLTreeBuilderAttributeMaps>();
    return *m_treeBuilderAttributeMaps;
}

NewlineThenWhitespaceStringsTable& DOMClientData::newlineThenWhitespaceStringsTable()
{
    if (!m_newlineThenWhitespaceStringsTable)
        m_newlineThenWhitespaceStringsTable = makeUnique<NewlineThenWhitespaceStringsTable>();
    return *m_newlineThenWhitespaceStringsTable;
}

ScopedEventQueue& DOMClientData::scopedEventQueue()
{
    if (!m_scopedEventQueue)
        m_scopedEventQueue = makeUnique<ScopedEventQueue>();
    return *m_scopedEventQueue;
}

MutationObserverAgentData& DOMClientData::mutationObserverAgentData()
{
    if (!m_mutationObserverAgentData)
        m_mutationObserverAgentData = makeUnique<MutationObserverAgentData>();
    return *m_mutationObserverAgentData;
}

SelectorQueryCache& DOMClientData::selectorQueryCache()
{
    if (!m_selectorQueryCache)
        m_selectorQueryCache = makeUnique<SelectorQueryCache>();
    return *m_selectorQueryCache;
}

ChildListMutationAccumulators& DOMClientData::childListMutationAccumulators()
{
    if (!m_childListMutationAccumulators)
        m_childListMutationAccumulators = makeUnique<ChildListMutationAccumulators>();
    return *m_childListMutationAccumulators;
}

const FormAtomStrings& DOMClientData::formAtomStrings()
{
    if (!m_formAtomStrings)
        m_formAtomStrings = makeUnique<FormAtomStrings>();
    return *m_formAtomStrings;
}

DOMClientData& domClientData(JSC::VM& vm)
{
    return clientData(vm)->domClientData();
}

DOMClientData& domClientDataSlow()
{
    auto& data = domClientData(commonVM());
    Thread::currentSingleton().m_clientData = adoptRef(*new DOMClientDataThreadSlot(data));
    return data;
}

} // namespace WebCore
