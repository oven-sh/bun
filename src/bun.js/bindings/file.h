#pragma once

#include "root.h"
#include "JSDOMGlobalObject.h"
#include "BunClientData.h"
#include <iostream>

namespace WebCore {

extern "C" void* Blob__dupeFromJS(JSC::EncodedJSValue impl);
extern "C" void* Blob__dupe(void* impl);
extern "C" void Blob__destroy(void* impl);
extern "C" BunString Blob__getFileNameString(void* impl);
extern "C" void Blob__setFileNameString(void* impl, BunString* filename);
extern "C" void* Blob__setAsFile(void* impl, BunString* filename);
extern "C" void* File__dupeFromBlob(void* impl, BunString* filename);
extern "C" void* File__dupeFromJSBlob(JSC::EncodedJSValue impl, BunString* filename);

class File : public RefCounted<File> {
public:
    void* impl()
    {
        return m_impl;
    }

    static RefPtr<File> create(JSC::JSValue impl)
    {
        void* implPtr = Blob__dupeFromJS(JSValue::encode(impl));
        if (!implPtr)
            return nullptr;

        return adoptRef(*new File(implPtr));
    }

    static RefPtr<File> create(void* ptr)
    {
        void* implPtr = Blob__dupe(ptr);
        if (!implPtr)
            return nullptr;

        return adoptRef(*new File(implPtr));
    }

    static RefPtr<File> fromBlob(void* impl, BunString* filename)
    {
        void* implPtr = File__dupeFromBlob(impl, filename);
        if (!implPtr)
            return nullptr;

        return adoptRef(*new File(implPtr));
    }

    static RefPtr<File> fromJSBlob(JSC::JSValue impl, BunString* filename)
    {
        void* implPtr = File__dupeFromJSBlob(JSValue::encode(impl), filename);

        return adoptRef(*new File(implPtr));
    }

    ~File()
    {
        Blob__destroy(m_impl);
    }

    String fileName()
    {
        return Bun::toWTFString(Blob__getFileNameString(m_impl));
    }

    void setFileName(String fileName)
    {
        BunString filename = Bun::toString(fileName);
        Blob__setFileNameString(m_impl, &filename);
    }
    void* m_impl;

private:
    File(void* impl)
    {
        m_impl = impl;
    }
};

JSC::JSValue toJS(JSC::JSGlobalObject*, JSDOMGlobalObject*, File&);
inline JSC::JSValue toJS(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, File* impl) { return impl ? toJS(lexicalGlobalObject, globalObject, *impl) : JSC::jsNull(); }
JSC::JSValue toJSNewlyCreated(JSC::JSGlobalObject*, JSDOMGlobalObject*, Ref<File>&&);
inline JSC::JSValue toJSNewlyCreated(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, RefPtr<File>&& impl) { return impl ? toJSNewlyCreated(lexicalGlobalObject, globalObject, impl.releaseNonNull()) : JSC::jsNull(); }

}
