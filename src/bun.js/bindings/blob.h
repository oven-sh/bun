#pragma once

#include "root.h"
#include "JSDOMGlobalObject.h"
#include "BunClientData.h"

namespace WebCore {

extern "C" void* Blob__dupeFromJS(JSC::EncodedJSValue impl);
extern "C" void* Blob__dupe(void* impl);
extern "C" void Blob__destroy(void* impl);

class Blob : public RefCounted<Blob> {
public:
    void* impl()
    {
        return m_impl;
    }

    static RefPtr<Blob> create(JSC::JSValue impl)
    {
        void* implPtr = Blob__dupeFromJS(JSValue::encode(impl));
        if (!implPtr)
            return nullptr;

        return adoptRef(*new Blob(implPtr));
    }

    static RefPtr<Blob> create(void* ptr)
    {
        void* implPtr = Blob__dupe(ptr);
        if (!implPtr)
            return nullptr;

        return adoptRef(*new Blob(implPtr));
    }

    ~Blob()
    {
        Blob__destroy(m_impl);
    }

    String fileName()
    {
        return m_fileName;
    }

    void setFileName(String fileName)
    {
        m_fileName = fileName;
    }
    void* m_impl;

    size_t memoryCost() const;

private:
    Blob(void* impl, String fileName = String())
    {
        m_impl = impl;
        m_fileName = fileName;
    }

    String m_fileName;
};

JSC::JSValue toJS(JSC::JSGlobalObject*, JSDOMGlobalObject*, Blob&);
inline JSC::JSValue toJS(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, Blob* impl) { return impl ? toJS(lexicalGlobalObject, globalObject, *impl) : JSC::jsNull(); }
JSC::JSValue toJSNewlyCreated(JSC::JSGlobalObject*, JSDOMGlobalObject*, Ref<Blob>&&);
inline JSC::JSValue toJSNewlyCreated(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, RefPtr<Blob>&& impl) { return impl ? toJSNewlyCreated(lexicalGlobalObject, globalObject, impl.releaseNonNull()) : JSC::jsNull(); }

}
