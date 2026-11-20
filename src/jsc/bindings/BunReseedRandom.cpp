// The C++ half of `Bun.reseedRandom()` (VirtualMachine::reseed_random_state).

#include "root.h"
#include "ZigGlobalObject.h"
#include "BunClientData.h"
#include "BunGlobalScope.h"
#include "NodeVM.h"
#include "ScriptExecutionContext.h"
#include "webcore/DOMIsoSubspaces.h"
#include <JavaScriptCore/HeapIterationScope.h>
#include <JavaScriptCore/MarkedSpaceInlines.h>
#include <JavaScriptCore/SubspaceInlines.h>
#include <JavaScriptCore/Options.h>
#include <openssl/rand.h>

namespace Bun {

// Not WTF's `cryptographicallyRandomNumber`: its ARC4 stream is duplicated by a
// snapshot too, and it re-stirs only after 1.6 MB. BoringSSL reseeds on the bump.
unsigned freshWeakRandomSeed()
{
    unsigned seed;
    RAND_bytes(reinterpret_cast<uint8_t*>(&seed), sizeof(seed));
    return seed;
}

static void reseedLiveGlobals(JSC::IsoSubspace* subspace)
{
    if (!subspace)
        return;
    subspace->forEachLiveCell([](JSC::HeapCell* cell, JSC::HeapCell::Kind) {
        static_cast<JSC::JSGlobalObject*>(static_cast<JSC::JSCell*>(cell))->weakRandom().setSeed(freshWeakRandomSeed());
    });
}

} // namespace Bun

// Every global Bun creates lives in one of these three subspaces.
extern "C" void Bun__reseedMathRandomForAllGlobals(JSC::VM* vm)
{
    // BUN_JSC_forceWeakRandomSeed pins Math.random for reproduction; keep it pinned.
    if (JSC::Options::forceWeakRandomSeed())
        return;

    auto& subspaces = WebCore::clientData(*vm)->heapData().subspaces();
    JSC::HeapIterationScope iterationScope(vm->heap);
    Bun::reseedLiveGlobals(subspaces.m_subspaceForWorkerGlobalScope);
    Bun::reseedLiveGlobals(subspaces.m_subspaceForNodeVMGlobalObject);
    Bun::reseedLiveGlobals(subspaces.m_subspaceForBakeGlobalScope);
}

// bun_jsc::virtual_machine_exports: the per-VM part, run on the target VM's thread.
extern "C" void Bun__VM__rederiveLocalRandomState(void* bunVM);

static void rederiveLocalRandomState(WebCore::ScriptExecutionContext& context)
{
    Bun__VM__rederiveLocalRandomState(context.bunVM());
}

extern "C" void Bun__postReseedRandomToOtherVMs(JSC::VM* vm)
{
    WebCore::ScriptExecutionContext::postToEveryOtherVM(WebCore::clientData(*vm)->vmHandle, rederiveLocalRandomState);
}
