#include "root.h"
#include "BunClientData.h"
#include <JavaScriptCore/Weak.h>
#include <JavaScriptCore/WeakInlines.h>

namespace Bun {
using WeakRefFinalizerTag = uintptr_t;

template<void (*finalizer)(void*)>
class WeakRefFinalizerClass : public JSC::WeakHandleOwner {
public:
    WeakRefFinalizerClass()
        : JSC::WeakHandleOwner()
    {
    }

    void finalize(JSC::Handle<JSC::Unknown>, void* context)
    {
        finalizer(context);
    }

    static WeakHandleOwner& singleton()
    {
        static NeverDestroyed<WeakRefFinalizerClass<finalizer>> s_singleton;
        return s_singleton;
    }
};

extern "C" void Bun__PostgreSQLQueryClient__target_onFinalize(void*);

using PostgreSQLQueryClient__targetWeakRefFinalizer = WeakRefFinalizerClass<Bun__PostgreSQLQueryClient__target_onFinalize>;

static inline JSC::WeakHandleOwner* getOwner(WeakRefFinalizerTag tag)
{
    if (tag == reinterpret_cast<uintptr_t>(Bun__PostgreSQLQueryClient__target_onFinalize))
        return &PostgreSQLQueryClient__targetWeakRefFinalizer::singleton();

    if (tag == 0)
        return nullptr;

    RELEASE_ASSERT_NOT_REACHED_WITH_MESSAGE("Unknown WeakRefFinalizerTag");
    return nullptr;
}

class WeakRef {
    WTF_MAKE_ISO_ALLOCATED(WeakRef);

public:
    WeakRef()
        : m_weak()
    {
    }

    static inline WeakRef* create(JSC::JSObject* value, WeakRefFinalizerTag tag, void* context)
    {
        return new WeakRef(value, tag, context);
    }

    WeakRef(JSC::JSObject* value, WeakRefFinalizerTag tag, void* context)
    {
        m_weak = JSC::Weak<JSC::JSObject>(value, getOwner(tag), context);
    }

    JSC::Weak<JSC::JSObject> m_weak;
};

WTF_MAKE_ISO_ALLOCATED_IMPL(WeakRef);

extern "C" void Bun__WeakRef__delete(Bun::WeakRef* ref)
{
    delete ref;
}

extern "C" Bun::WeakRef* Bun__WeakRef__new(JSC::EncodedJSValue encodedValue, WeakRefFinalizerTag tag, void* context)
{
    return Bun::WeakRef::create(JSC::JSValue::decode(encodedValue).getObject(), tag, context);
}

extern "C" JSC::EncodedJSValue Bun__WeakRef__get(Bun::WeakRef* weakRef)
{
    return JSC::JSValue::encode(weakRef->m_weak.get());
}

extern "C" void Bun__WeakRef__set(Bun::WeakRef* weakRef, JSC::EncodedJSValue encodedValue, WeakRefFinalizerTag tag, void* context)
{
    weakRef->m_weak = JSC::Weak<JSC::JSObject>(JSC::JSValue::decode(encodedValue).getObject(), getOwner(tag), context);
}

extern "C" void Bun__WeakRef__clear(Bun::WeakRef* weakRef)
{
    weakRef->m_weak.clear();
}

}