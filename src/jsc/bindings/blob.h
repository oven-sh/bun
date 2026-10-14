#pragma once

#include "root.h"
#include "JSDOMGlobalObject.h"
#include "BunClientData.h"

namespace WebCore {

// Mirrors `BlobPayloadState` in Blob.rs.
enum class BlobPayloadState : uint8_t {
    InMemory = 0,
    // The store is a file or an S3 object: the bytes need an asynchronous read.
    NeedsAsyncRead = 1,
};

// Mirrors `BlobPayload` in Blob.rs.
struct BlobPayload {
    const uint8_t* ptr { nullptr };
    size_t len { 0 };
};

extern "C" void* Blob__dupeFromJS(JSC::EncodedJSValue impl);
extern "C" void* Blob__dupe(void* impl);
// `payload` is null and 0 for a zero-length Blob and for NeedsAsyncRead: check the state.
extern "C" BlobPayloadState Blob__getPayload(void* impl, BlobPayload* payload);
extern "C" void* Blob__fromBytes(JSC::JSGlobalObject* globalThis, const void* ptr, size_t len);
extern "C" void Blob__ref(void* impl);
extern "C" void Blob__deref(void* impl);

// Opaque type corresponding to `bun.webcore.Blob`.
class BlobImpl;

struct BlobImplRefDerefTraits {
    static ALWAYS_INLINE BlobImpl* refIfNotNull(BlobImpl* ptr)
    {
        if (ptr) [[likely]]
            Blob__ref(ptr);
        return ptr;
    }

    static ALWAYS_INLINE BlobImpl& ref(BlobImpl& ref)
    {
        Blob__ref(&ref);
        return ref;
    }

    static ALWAYS_INLINE void derefIfNotNull(BlobImpl* ptr)
    {
        if (ptr) [[likely]]
            Blob__deref(ptr);
    }
};

using BlobRefPtr = RefPtr<BlobImpl, RawPtrTraits<BlobImpl>, BlobImplRefDerefTraits>;

// TODO: Now that `bun.webcore.Blob` is ref-counted, can `RefPtr<Blob>` be replaced with `Blob`?
class Blob : public RefCounted<Blob> {
public:
    BlobImpl* impl() const
    {
        return m_impl.get();
    }

    static RefPtr<Blob> create(JSC::JSValue impl)
    {
        return createAdopted(Blob__dupeFromJS(JSValue::encode(impl)));
    }

    static RefPtr<Blob> create(std::span<const uint8_t> bytes, JSC::JSGlobalObject* globalThis)
    {
        return createAdopted(Blob__fromBytes(globalThis, bytes.data(), bytes.size()));
    }

    static RefPtr<Blob> create(void* ptr)
    {
        return createAdopted(Blob__dupe(ptr));
    }

    String fileName()
    {
        return m_fileName;
    }

    void setFileName(String fileName)
    {
        m_fileName = fileName;
    }

    size_t memoryCost() const;

private:
    Blob(void* impl, String fileName = String())
        : m_impl(adoptRef<BlobImpl, RawPtrTraits<BlobImpl>, BlobImplRefDerefTraits>(
              static_cast<BlobImpl*>(impl)))
        , m_fileName(std::move(fileName))
    {
    }

    static RefPtr<Blob> createAdopted(void* ptr)
    {
        if (!ptr)
            return nullptr;
        return adoptRef(new Blob(ptr));
    }

    BlobRefPtr m_impl;
    String m_fileName;
};

JSC::JSValue toJS(JSC::JSGlobalObject*, JSDOMGlobalObject*, Blob&);
inline JSC::JSValue toJS(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, Blob* impl) { return impl ? toJS(lexicalGlobalObject, globalObject, *impl) : JSC::jsNull(); }
JSC::JSValue toJSNewlyCreated(JSC::JSGlobalObject*, JSDOMGlobalObject*, Ref<Blob>&&);
inline JSC::JSValue toJSNewlyCreated(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, RefPtr<Blob>&& impl) { return impl ? toJSNewlyCreated(lexicalGlobalObject, globalObject, impl.releaseNonNull()) : JSC::jsNull(); }

}
