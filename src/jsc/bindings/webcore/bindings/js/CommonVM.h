#pragma once

#include <wtf/Forward.h>

namespace JSC {
class VM;
}

namespace WebCore {

// Bun has one VM per thread, so this is the current thread's VM.
JSC::VM& commonVM();

void addImpureProperty(const AtomString&);

} // namespace WebCore
