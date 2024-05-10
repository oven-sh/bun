#pragma once

#include "root.h"
#include <JavaScriptCore/Weak.h>
#include <JavaScriptCore/Strong.h>

namespace Bun {

class WeakRef : public JSC::WeakHandleOwner {
    WTF_MAKE_ISO_ALLOCATED(WeakRef);

public:
    WeakRef(JSC::VM& vm, JSC::JSValue value, void (*finalize_callback)(void*, JSC::JSValue) = nullptr, void* ctx = nullptr)
    {

        JSC::JSObject* object = value.getObject();
        if (object->type() == JSC::JSType::GlobalProxyType)
            object = jsCast<JSC::JSGlobalProxy*>(object)->target();

        this->m_cell = JSC::Weak<JSC::JSObject>(object, this, ctx);
        this->callback = finalize_callback;
    }

    WeakRef()
    {
    }

    void finalize(JSC::Handle<JSC::Unknown> handle, void* context) final
    {
        if (this->callback) {
            this->callback(context, handle.asObject().get());
        }
    }

    JSC::Weak<JSC::JSObject> m_cell;
    void (*callback)(void*, JSC::JSValue) = nullptr;
};

}