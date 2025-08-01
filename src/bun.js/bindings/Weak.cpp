#include "root.h"
#include <JavaScriptCore/StrongInlines.h>
#include "BunClientData.h"
#include <JavaScriptCore/Weak.h>
#include <JavaScriptCore/Strong.h>

namespace Bun {

enum class WeakRefType : uint32_t {
    None = 0,
    FetchResponse = 1,
    PostgreSQLQueryClient = 2,
};

typedef void (*WeakRefFinalizeFn)(void* context);

// clang-format off
#define FOR_EACH_WEAK_REF_TYPE(macro) \
    macro(FetchResponse) \
    macro(PostgreSQLQueryClient)

// clang-format on

#define DECLARE_WEAK_REF_OWNER(X) \
    extern "C" void Bun__##X##_finalize(void* context);

FOR_EACH_WEAK_REF_TYPE(DECLARE_WEAK_REF_OWNER);

template<WeakRefType T>
class WeakRefOwner : public JSC::WeakHandleOwner {
public:
    void finalize(JSC::Handle<JSC::Unknown> handle, void* context) final
    {
        if (context) [[likely]] {
            switch (T) {
            case WeakRefType::FetchResponse:
                Bun__FetchResponse_finalize(context);
                break;
            case WeakRefType::PostgreSQLQueryClient:
                // Bun__PostgreSQLQueryClient_finalize(context);
                break;
            default:
                break;
            }
        }
    }
};

template<WeakRefType T>
static JSC::WeakHandleOwner* getWeakRefOwner()
{
    static NeverDestroyed<WeakRefOwner<T>> owner;
    return &owner.get();
}

static JSC::WeakHandleOwner* getWeakRefOwner(WeakRefType type)
{
    switch (type) {
    case WeakRefType::FetchResponse: {
        return getWeakRefOwner<WeakRefType::FetchResponse>();
    }
    case WeakRefType::PostgreSQLQueryClient: {
        return getWeakRefOwner<WeakRefType::PostgreSQLQueryClient>();
    }
    default: {
        RELEASE_ASSERT_NOT_REACHED();
    }
    }

    return nullptr;
}

class WeakRef {
    WTF_MAKE_TZONE_ALLOCATED(WeakRef);

public:
    WeakRef(JSC::VM& vm, JSC::JSValue value, WeakRefType kind, void* ctx = nullptr)
    {

        JSC::JSObject* object = value.getObject();
        if (object->type() == JSC::JSType::GlobalProxyType)
            object = jsCast<JSC::JSGlobalProxy*>(object)->target();

        this->m_cell = JSC::Weak<JSC::JSObject>(object, getWeakRefOwner(kind), ctx);
    }

    WeakRef()
    {
    }

    JSC::Weak<JSC::JSObject> m_cell;
};

}

extern "C" void Bun__WeakRef__clear(Bun::WeakRef* weakRef)
{
    weakRef->m_cell.clear();
}

extern "C" void Bun__WeakRef__delete(Bun::WeakRef* weakRef)
{
    Bun__WeakRef__clear(weakRef);
    delete weakRef;
}

extern "C" Bun::WeakRef* Bun__WeakRef__new(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedValue, Bun::WeakRefType kind, void* ctx)
{
    return new Bun::WeakRef(globalObject->vm(), JSC::JSValue::decode(encodedValue), kind, ctx);
}

extern "C" JSC::EncodedJSValue Bun__WeakRef__get(Bun::WeakRef* weakRef)
{
    if (auto* cell = weakRef->m_cell.get()) {
        return JSC::JSValue::encode(cell);
    }
    return JSC::encodedJSValue();
}
