#include "root.h"
#include <JavaScriptCore/SourceProvider.h>

#include <wtf/Lock.h>

namespace JSC {

// SourceProvider::SourceProvider(const SourceOrigin&, String&& sourceURL, const TextPosition& startPosition, SourceProviderSourceType) {

// }


// SourceProvider::SourceProvider(const SourceOrigin& sourceOrigin, String&& sourceURL, const TextPosition& startPosition, SourceProviderSourceType sourceType)
//     : m_sourceType(sourceType)
//     , m_sourceOrigin(sourceOrigin)
//     , m_sourceURL(WTFMove(sourceURL))
//     , m_startPosition(startPosition)
// {
// }

// SourceProvider::~SourceProvider()
// {
// }

// static Lock providerIdLock;

// void SourceProvider::getID()
// {
//     Locker locker { providerIdLock };
//     if (!m_id) {
//         static intptr_t nextProviderID = 0;
//         m_id = ++nextProviderID;
//         RELEASE_ASSERT(m_id);
//     }
// }

} // namespace JSC

