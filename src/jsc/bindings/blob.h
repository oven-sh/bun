#pragma once

#include "root.h"
#include "JSDOMGlobalObject.h"
#include "JSDOMWrapper.h"
#include "BunClientData.h"
#include <JavaScriptCore/Weak.h>
#include <JavaScriptCore/WeakInlines.h>

namespace WebCore {

// What `Blob__sharedView` found in a value. Rust: `BlobBytes` (Blob.rs).
enum class BlobBytes : uint8_t {
    // The value holds no Blob.
    NotABlob = 0,
    InMemory = 1,
    // A file- or S3-backed Blob, which has to be read first.
    NotInMemory = 2,
};

// Both copy a Blob into a File. A non-null `name` names the copy, an empty one too.
extern "C" void* Blob__dupeFromJSAsFile(JSC::EncodedJSValue value, const BunString* name);
extern "C" void* Blob__dupeAsFile(void* impl, const BunString* name);
// Borrows the bytes of the Blob that `value` holds: a Blob, or a `Bun.build()` output. Writes `ptr` and `len` only for `InMemory`. `ptr` is only valid while `value` is alive.
extern "C" BlobBytes Blob__sharedView(JSC::EncodedJSValue value, const uint8_t** ptr, size_t* len);
extern "C" void* Blob__fromBytes(JSC::JSGlobalObject* globalThis, const void* ptr, size_t len);
extern "C" void Blob__ref(void* impl);
extern "C" void Blob__deref(void* impl);

// False means that `value` holds no Blob, without a call into Rust: every wrapper that holds one has this cell type.
inline bool mayHoldBlob(JSC::JSValue value)
{
    return value.isCell() && value.asCell()->type() == JSC::JSType(JSDOMWrapperType);
}

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

    // The File of a FormData entry. Its `BlobImpl` holds the only record of its name. A null `fileName` keeps the name of `value`.
    static RefPtr<Blob> createEntry(JSC::JSValue value, const BunString* fileName)
    {
        return createAdopted(Blob__dupeFromJSAsFile(JSValue::encode(value), fileName));
    }

    static RefPtr<Blob> createEntry(void* impl, const BunString& fileName)
    {
        return createAdopted(Blob__dupeAsFile(impl, &fileName));
    }

    static RefPtr<Blob> create(std::span<const uint8_t> bytes, JSC::JSGlobalObject* globalThis)
    {
        return createAdopted(Blob__fromBytes(globalThis, bytes.data(), bytes.size()));
    }

    // The JS object handed out for this FormData entry, so reads keep returning the same one while script still holds it.
    JSC::JSObject* wrapper() const { return m_wrapper.get(); }
    void setWrapper(JSC::JSObject* wrapper) { m_wrapper = JSC::Weak<JSC::JSObject>(wrapper); }

    size_t memoryCost() const;

    // Out of line, so that `deref()` stays small enough to inline where a RefPtr<Blob> is dropped.
    NEVER_INLINE ~Blob();

private:
    explicit Blob(void* impl)
        : m_impl(adoptRef<BlobImpl, RawPtrTraits<BlobImpl>, BlobImplRefDerefTraits>(
              static_cast<BlobImpl*>(impl)))
    {
    }

    static RefPtr<Blob> createAdopted(void* ptr)
    {
        if (!ptr)
            return nullptr;
        return adoptRef(new Blob(ptr));
    }

    BlobRefPtr m_impl;
    JSC::Weak<JSC::JSObject> m_wrapper;
};

JSC::JSValue toJS(JSC::JSGlobalObject*, JSDOMGlobalObject*, Blob&);
inline JSC::JSValue toJS(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, Blob* impl) { return impl ? toJS(lexicalGlobalObject, globalObject, *impl) : JSC::jsNull(); }

}
