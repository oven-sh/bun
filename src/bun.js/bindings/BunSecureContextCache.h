#pragma once

// Thin wrapper around `WeakGCMap<uint64_t, JSObject>` so ZigGlobalObject.h
// can hold a `std::unique_ptr<SecureContextCache>` without pulling in
// WeakGCMap.h. The full type is needed in BunSecureContextCache.cpp and in
// ZigGlobalObject.cpp (for the unique_ptr destructor).
//
// Backs the JS-side dedup of `tls.createSecureContext()`: same config digest
// → same `JSSecureContext` cell while it's alive. The native `SSL_CTX*` cache
// (Zig `SSLContextCache`) is independent — BoringSSL's refcount is the single
// source of truth, so the two never need to coordinate.

#include "root.h"
#include <JavaScriptCore/WeakGCMap.h>

namespace Bun {

class SecureContextCache {
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED(SecureContextCache);

public:
    explicit SecureContextCache(JSC::VM& vm)
        : m_map(vm)
    {
    }

    JSC::JSObject* get(uint64_t key) { return m_map.get(key); }
    void set(uint64_t key, JSC::JSObject* value) { m_map.set(key, JSC::Weak<JSC::JSObject>(value)); }

private:
    JSC::WeakGCMap<uint64_t, JSC::JSObject, WTF::IntHash<uint64_t>, WTF::UnsignedWithZeroKeyHashTraits<uint64_t>> m_map;
};

} // namespace Bun
