#include "root.h"
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSString.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/ObjectConstructor.h>

namespace Bun {

using namespace JSC;

struct Bun__HTTPStats {
    std::atomic<uint64_t> total_requests;
    std::atomic<uint64_t> total_bytes_sent;
    std::atomic<uint64_t> total_bytes_received;
    std::atomic<uint64_t> total_requests_failed;
    std::atomic<uint64_t> total_requests_redirected;
    std::atomic<uint64_t> total_requests_succeeded;
    std::atomic<uint64_t> total_requests_timed_out;
    std::atomic<uint64_t> total_requests_connection_refused;
};
extern "C" Bun__HTTPStats Bun__HTTPStats;
static_assert(std::atomic<uint64_t>::is_always_lock_free, "Bun__HTTPStats must be lock-free");

// clang-format off
#define STATS_GETTER(name) \
    JSC_DEFINE_CUSTOM_GETTER(getStatsField_##name, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName)) \
    { \
        return JSValue::encode(jsNumber(Bun__HTTPStats.name)); \
    } \
    \

#define FOR_EACH_STATS_FIELD(macro) \
    macro(total_requests) \
    macro(total_bytes_sent) \
    macro(total_bytes_received) \
    macro(total_requests_failed) \
    macro(total_requests_redirected) \
    macro(total_requests_succeeded) \
    macro(total_requests_timed_out) \
    macro(total_requests_connection_refused)

// clang-format on

FOR_EACH_STATS_FIELD(STATS_GETTER)

#undef STATS_GETTER
#undef FOR_EACH_STATS_FIELD

extern "C" std::atomic<uint64_t> Bun__HTTPStats__total_requests_active;

JSC_DEFINE_CUSTOM_GETTER(getStatsField_total_requests_active, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    return JSValue::encode(jsNumber(Bun__HTTPStats__total_requests_active));
}

class JSHTTPStatsObject final : public JSNonFinalObject {
public:
    using Base = JSNonFinalObject;

    static constexpr unsigned StructureFlags = Base::StructureFlags | HasStaticPropertyTable;

    template<typename CellType, SubspaceAccess>
    static GCClient::IsoSubspace* subspaceFor(VM& vm)
    {
        return &vm.plainObjectSpace();
    }

    static JSHTTPStatsObject* create(VM& vm, Structure* structure)
    {
        JSHTTPStatsObject* object = new (NotNull, allocateCell<JSHTTPStatsObject>(vm)) JSHTTPStatsObject(vm, structure);
        object->finishCreation(vm);
        return object;
    }

    DECLARE_INFO;

    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
    {
        return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
    }

private:
    JSHTTPStatsObject(VM& vm, Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(VM& vm)
    {
        Base::finishCreation(vm);
    }
};

/* Source for JSHTTPStats.lut.h
@begin jsHTTPStatsObjectTable
    requests                      getStatsField_total_requests                    CustomAccessor|ReadOnly|DontDelete
    active                        getStatsField_total_requests_active              CustomAccessor|ReadOnly|DontDelete
    success                       getStatsField_total_requests_succeeded          CustomAccessor|ReadOnly|DontDelete
    bytesWritten                  getStatsField_total_bytes_sent                  CustomAccessor|ReadOnly|DontDelete
    bytesRead                     getStatsField_total_bytes_received              CustomAccessor|ReadOnly|DontDelete
    fail                        getStatsField_total_requests_failed             CustomAccessor|ReadOnly|DontDelete
    redirect                    getStatsField_total_requests_redirected         CustomAccessor|ReadOnly|DontDelete
    timeout                       getStatsField_total_requests_timed_out          CustomAccessor|ReadOnly|DontDelete
    refused                       getStatsField_total_requests_connection_refused  CustomAccessor|ReadOnly|DontDelete
@end
*/
#include "JSHTTPStats.lut.h"

const ClassInfo JSHTTPStatsObject::s_info = { "HTTPStats"_s, &Base::s_info, &jsHTTPStatsObjectTable, nullptr, CREATE_METHOD_TABLE(JSHTTPStatsObject) };

JSValue constructBunHTTPStatsObject(JSC::JSGlobalObject* globalObject)
{
    auto& vm = globalObject->vm();

    return JSHTTPStatsObject::create(vm, JSHTTPStatsObject::createStructure(vm, globalObject, globalObject->objectPrototype()));
}

}
