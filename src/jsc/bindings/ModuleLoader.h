#pragma once

#include "root.h"
#include "headers-handwritten.h"

#include <JavaScriptCore/JSCInlines.h>
#include "BunClientData.h"

BUN_DECLARE_HOST_FUNCTION(jsFunctionOnLoadObjectResultResolve);
BUN_DECLARE_HOST_FUNCTION(jsFunctionOnLoadObjectResultReject);
BUN_DECLARE_HOST_FUNCTION(jsFunctionEvictIsolationSourceProviderCache);

namespace Zig {
class GlobalObject;
}

namespace JSC {
class JSPromise;
class AbstractModuleRecord;
}

namespace Bun {
using namespace JSC;

class JSCommonJSModule;

// A cyclic module evaluated without error, or a synthetic module that has been linked.
bool isModuleEvaluated(JSC::AbstractModuleRecord*);

typedef uint8_t OnLoadResultType;
const OnLoadResultType OnLoadResultTypeError = 0;
const OnLoadResultType OnLoadResultTypeCode = 1;
const OnLoadResultType OnLoadResultTypeObject = 2;
const OnLoadResultType OnLoadResultTypePromise = 3;

struct CodeString {
    EncodedSlice string;
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
    bool wasMock;
};

extern "C" bool isBunTest;

class PendingVirtualModuleResult : public JSC::JSInternalFieldObjectImpl<3> {
public:
    using Base = JSC::JSInternalFieldObjectImpl<3>;

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<PendingVirtualModuleResult, WebCore::UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForPendingVirtualModuleResult, m_subspaceForPendingVirtualModuleResult));
    }

    JS_EXPORT_PRIVATE static PendingVirtualModuleResult* create(VM&, Structure*);
    static PendingVirtualModuleResult* create(JSC::JSGlobalObject* globalObject, const WTF::String& specifier, const WTF::String& referrer, bool wasModuleMock);
    static Structure* createStructure(VM&, JSGlobalObject*, JSValue);

    JSC::JSPromise* internalPromise();

    DECLARE_EXPORT_INFO;
    DECLARE_VISIT_CHILDREN;

    PendingVirtualModuleResult(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&, const WTF::String& specifier, const WTF::String& referrer);

    bool wasModuleMock = false;
};

JSValue fetchESMSourceCodeSync(
    Zig::GlobalObject* globalObject,
    JSString* spceifierJS,
    ErrorableResolvedSource* res,
    BunString* specifier,
    BunString* referrer,
    BunString* typeAttribute);

JSValue fetchESMSourceCodeAsync(
    Zig::GlobalObject* globalObject,
    JSString* spceifierJS,
    ErrorableResolvedSource* res,
    BunString* specifier,
    BunString* referrer,
    BunString* typeAttribute);

JSValue fetchCommonJSModule(
    Zig::GlobalObject* globalObject,
    JSCommonJSModule* moduleObject,
    JSValue specifierValue,
    String specifier,
    BunString* referrer,
    BunString* typeAttribute);

template<bool isExtension>
JSValue fetchCommonJSModuleNonBuiltin(
    void* bunVM,
    JSC::VM& vm,
    Zig::GlobalObject* globalObject,
    BunString* specifier,
    JSC::JSValue specifierValue,
    BunString* referrer,
    BunString* typeAttribute,
    ErrorableResolvedSource* res,
    JSCommonJSModule* target,
    String specifierWtfString,
    BunLoaderType forceLoaderType,
    JSC::ThrowScope& scope);

JSValue resolveAndFetchBuiltinModule(
    Zig::GlobalObject* globalObject,
    const BunString* specifier);

struct BuiltinModule {
    enum class Kind : uint8_t {
        /// Not a builtin; `res` is untouched.
        None,
        /// `exports` is the module's exports value.
        Exports,
        /// `res` holds the module's source; the caller evaluates it.
        Source,
    };
    Kind kind = Kind::None;
    JSValue exports {};
};

BuiltinModule fetchBuiltinModuleWithoutResolution(
    Zig::GlobalObject* globalObject,
    const BunString* specifier,
    ErrorableResolvedSource* res);

} // namespace Bun
