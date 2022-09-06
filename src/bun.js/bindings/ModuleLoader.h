#include "root.h"
#include "headers-handwritten.h"

#include "JavaScriptCore/JSCInlines.h"
#include "BunClientData.h"

namespace Zig {
class GlobalObject;
}

namespace JSC {
class JSInternalPromise;
}

namespace Bun {
using namespace JSC;

typedef uint8_t OnLoadResultType;
const OnLoadResultType OnLoadResultTypeError = 0;
const OnLoadResultType OnLoadResultTypeCode = 1;
const OnLoadResultType OnLoadResultTypeObject = 2;
const OnLoadResultType OnLoadResultTypePromise = 3;

struct CodeString {
    ZigString string;
    JSC::JSValue value;
    BunLoaderType loader;
};

union OnLoadResultValue {
    CodeString sourceText;
    JSC::JSValue object;
    JSC::JSValue promise;
    JSC::JSValue error;
};

struct OnLoadResult {
    OnLoadResultValue value;
    OnLoadResultType type;
};

class PendingVirtualModuleResult : public JSC::JSInternalFieldObjectImpl<3> {
public:
    using Base = JSC::JSInternalFieldObjectImpl<3>;

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<PendingVirtualModuleResult, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForPendingVirtualModuleResult.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForPendingVirtualModuleResult = WTFMove(space); },
            [](auto& spaces) { return spaces.m_subspaceForPendingVirtualModuleResult.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForPendingVirtualModuleResult = WTFMove(space); });
    }

    JS_EXPORT_PRIVATE static PendingVirtualModuleResult* create(VM&, Structure*);
    static PendingVirtualModuleResult* create(JSC::JSGlobalObject* globalObject, const WTF::String& specifier, const WTF::String& referrer);
    static PendingVirtualModuleResult* createWithInitialValues(VM&, Structure*);
    static Structure* createStructure(VM&, JSGlobalObject*, JSValue);

    JSC::JSInternalPromise* internalPromise();

    static std::array<JSValue, numberOfInternalFields> initialValues()
    {
        return { {
            jsUndefined(),
            jsUndefined(),
            jsUndefined(),
        } };
    }

    DECLARE_EXPORT_INFO;
    DECLARE_VISIT_CHILDREN;

    PendingVirtualModuleResult(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&, const WTF::String& specifier, const WTF::String& referrer);
};

OnLoadResult handleOnLoadResultNotPromise(Zig::GlobalObject* globalObject, JSC::JSValue objectValue);
JSValue fetchSourceCodeSync(
    Zig::GlobalObject* globalObject,
    ErrorableResolvedSource* res,
    ZigString* specifier,
    ZigString* referrer);

JSValue fetchSourceCodeAsync(
    Zig::GlobalObject* globalObject,
    ErrorableResolvedSource* res,
    ZigString* specifier,
    ZigString* referrer);

} // namespace Bun