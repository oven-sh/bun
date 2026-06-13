#include "root.h"
#include "BunSecureContextCache.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/WeakGCMapInlines.h>

using namespace JSC;

// Called from Rust (`SecureContext::intern`). Returns the cached JSSecureContext
// for `key` (low 64 bits of the config digest) or jsEmpty() if none / GC'd.
// The full 32-byte digest lives on the Rust SecureContext, so the caller does
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

// Called from Rust (`SecureContext::add_ca_cert`) when a SecureContext mutates
// its SSL_CTX (e.g. addCACert): the cache should no longer hand back the
// mutated cell for fresh `createSecureContext(sameOptions)` calls, so drop the
// key. WeakGCMap takes no position on whether the cell is still reachable — the
// original handle keeps it alive via its JS ref.
extern "C" void Bun__SecureContextCache__remove(Zig::GlobalObject* global, uint64_t key)
{
    auto& slot = global->m_secureContextCache;
    if (!slot) return;
    slot->remove(key);
}
