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
}

namespace Bun {
class JSModuleGraph;

using namespace JSC;

class JSCommonJSModule;

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
    // Backs `value.sourceText.string` when `contents` is a typed array.
    // No inline capacity, so moving the struct doesn't invalidate the pointer.
    WTF::Vector<uint8_t> sourceTextCopy;
};

extern "C" bool isBunTest;

class PendingVirtualModuleResult : public JSC::JSInternalFieldObjectImpl<8> {
public:
    using Base = JSC::JSInternalFieldObjectImpl<8>;

    // Fields 0 to 2 are the specifier, the referrer and the promise. These are empty when unused.
    enum Field : unsigned {
        TypeAttribute = 3,
        ModuleGraph,
        OnLoadPath, // Set while waiting on an onLoad callback's promise.
        OnLoadCallbacks, // The callbacks to try next if that one declines.
        ModuleMock, // Set while waiting for Bun::runModuleMock().
    };

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<PendingVirtualModuleResult, WebCore::UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForPendingVirtualModuleResult, m_subspaceForPendingVirtualModuleResult));
    }

    JS_EXPORT_PRIVATE static PendingVirtualModuleResult* create(VM&, Structure*);
    static PendingVirtualModuleResult* create(JSC::JSGlobalObject* globalObject, const WTF::String& specifier, const WTF::String& referrer);
    static Structure* createStructure(VM&, JSGlobalObject*, JSValue);

    JSC::JSPromise* internalPromise();

    DECLARE_EXPORT_INFO;
    DECLARE_VISIT_CHILDREN;

    PendingVirtualModuleResult(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&, const WTF::String& specifier, const WTF::String& referrer);
};

// `graph`: the Bun.ModuleGraph whose loader is fetching, or null. A CommonJS file
// becomes a module of that graph's require cache.
JSValue fetchESMSourceCodeSync(
    Zig::GlobalObject* globalObject,
    Bun::JSModuleGraph* graph,
    JSString* spceifierJS,
    ErrorableResolvedSource* res,
    BunString* specifier,
    BunString* referrer,
    BunString* typeAttribute);

JSValue fetchESMSourceCodeAsync(
    Zig::GlobalObject* globalObject,
    Bun::JSModuleGraph* graph,
    JSString* spceifierJS,
    ErrorableResolvedSource* res,
    BunString* specifier,
    BunString* referrer,
    BunString* typeAttribute);

// Appends { ...object, default: object }. Returns object if any export was deferred (its value is empty), null otherwise or on exception.
JSC::JSObject* appendInternalModuleExports(Zig::GlobalObject*, JSC::JSObject* object, WTF::Vector<JSC::Identifier, 4>& exportNames, JSC::MarkedArgumentBuffer& exportValues);
// Appends what an `import` of a module in NativeModuleList.h gets. Returns the object that a deferred export (its value is empty) is read from, null for a module that never defers or on exception.
JSC::JSObject* appendNativeModuleExports(Zig::GlobalObject*, uint32_t registryID, WTF::Vector<JSC::Identifier, 4>& exportNames, JSC::MarkedArgumentBuffer& exportValues);

JSC::JSObject* createAsyncModuleRequiredError(JSC::JSGlobalObject*, const WTF::String& specifier);

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
    JSC::ThrowScope& scope,
    const CodeString* pluginContents = nullptr);

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

// What has to be noted before a module body runs: bits of Bun::ModuleBodyNote. Zero in every VM but that of
// `bun test` and that of a Worker which starts.
extern "C" uint8_t Bun__VM__moduleBodyNotes(void* bunVM);
// The same for a CommonJS module, or EvalEntryPoint.
extern "C" uint8_t Bun__VM__commonJSModuleBodyNotes(void* bunVM, JSC::EncodedJSValue filename);
extern "C" bool Bun__VM__willRunModuleBody(void* bunVM, const BunString* key);
extern "C" void Bun__VM__didRunModuleBody(void* bunVM);

namespace Bun {

// `module_body_notes` in VirtualMachine.rs has the same values and says what each is for.
namespace ModuleBodyNote {
static constexpr uint8_t EntryOfWorker = 1 << 0;
static constexpr uint8_t TestFile = 1 << 1;
static constexpr uint8_t EvalEntryPoint = 1 << 7;
}

// Goes round the body of a module while ModuleBodyNote::TestFile is set.
class ModuleBodyOfTestFile {
    WTF_MAKE_NONCOPYABLE(ModuleBodyOfTestFile);
    WTF_FORBID_HEAP_ALLOCATION;

public:
    ModuleBodyOfTestFile(void* bunVM, const WTF::String& key)
        : m_bunVM(bunVM)
    {
        BunString borrowedKey = Bun::toString(key);
        m_isImport = Bun__VM__willRunModuleBody(bunVM, &borrowedKey);
    }

    ~ModuleBodyOfTestFile()
    {
        if (m_isImport)
            Bun__VM__didRunModuleBody(m_bunVM);
    }

private:
    void* m_bunVM;
    bool m_isImport;
};

} // namespace Bun
