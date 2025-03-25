#include "root.h"
#include "BunClientData.h"
#include "JSDOMWrapper.h"

const WTF::RefCountedBase* Bun__refToInspect = nullptr;

extern "C" void Bun__inspectRef()
{
    fprintf(stderr, "\x1b[1;34mref %p %u -> %u\x1b[0m\n", Bun__refToInspect, Bun__refToInspect->refCount(), Bun__refToInspect->refCount() + 1);
    if (Bun__refToInspect->refCount() == 2) {
        fprintf(stderr, "breakpoint\n");
    }
    WTF::StackTrace::captureStackTrace(30, 2)->dump(WTF::dataFile());
}

extern "C" void Bun__inspectDeref()
{
    fprintf(stderr, "\x1b[1;34mderef %p %u -> %u\x1b[0m\n", Bun__refToInspect, Bun__refToInspect->refCount(), Bun__refToInspect->refCount() - 1);
    if (Bun__refToInspect->refCount() == 3) {
        fprintf(stderr, "breakpoint\n");
    }
    WTF::StackTrace::captureStackTrace(30, 2)->dump(WTF::dataFile());
}

extern "C" void Bun__testVMOnExit(JSC::VM* vm)
{
    // auto clientData = WebCore::clientData(*vm);
    // WTF::RefCountedBase* base = &clientData->normalWorld();
    // fprintf(stderr, "vm in refToInspect: %p\n", &static_cast<const WebCore::DOMWrapperWorld*>(Bun__refToInspect)->vm());
    // fprintf(stderr, "vm in testVMOnExit: %p\n", vm);
    // fprintf(stderr, "normalWorld %p %p refcount for vm %p = %u %u\n", Bun__refToInspect, base, vm, clientData->normalWorld().refCount(), Bun__refToInspect->refCount());
}
