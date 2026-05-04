#include "root.h"
#include "BunSecureContextCache.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/WeakGCMapInlines.h>

using namespace JSC;

// Called from Zig (`SecureContext.intern`). Returns the cached JSSecureContext
// for `key` (low 64 bits of the config digest) or jsEmpty() if none / GC'd.
// The full 32-byte digest lives on the Zig SecureContext, so the caller does
// a content-equality check on hit to handle the (~2⁻⁶⁴) key-collision case.
extern "C" JSC::EncodedJSValue Bun__SecureContextCache__get(Zig::GlobalObject* global, uint64_t key)
{
    auto& slot = global->m_secureContextCache;
    if (!slot) return JSValue::encode(JSValue());
    JSObject* obj = slot->get(key);
    return JSValue::encode(obj ? JSValue(obj) : JSValue());
}

extern "C" void Bun__SecureContextCache__set(Zig::GlobalObject* global, uint64_t key, JSC::EncodedJSValue value)
{
    auto& slot = global->m_secureContextCache;
    if (!slot) slot = makeUnique<Bun::SecureContextCache>(global->vm());
    JSObject* obj = JSValue::decode(value).getObject();
    if (obj) slot->set(key, obj);
}
