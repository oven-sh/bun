// The C++ half of `Bun.reseedRandom()` (VirtualMachine::reseed_random_state):
// a new `Math.random` seed for every live global of a VM, and the post of the
// per-VM part to every other live VM in the process.

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

// Seeded from BoringSSL, not from WTF's `cryptographicallyRandomNumber`: WTF
// keeps a process-wide ARC4 keystream that a restored VM snapshot duplicates
// too, and it only re-stirs from the OS after 1.6 MB of output. BoringSSL's
// DRBG reseeds as soon as the fork generation moves.
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

// Every global Bun creates derives from Bun::GlobalScope and lives in one of
// three subspaces: Zig::GlobalObject (the main global, Workers, ShadowRealms,
// eval and standalone globals), NodeVMGlobalObject (vm.createContext), and the
// Bake global.
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
