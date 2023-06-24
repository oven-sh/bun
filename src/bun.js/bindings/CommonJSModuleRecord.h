#include "root.h"
#include "headers-handwritten.h"

namespace Zig {
class GlobalObject;
}
namespace JSC {
class SourceCode;
class JSSourceCode;
class ProgramExecutable;
class AbstractModuleRecord;
}

namespace Bun {

JSC_DECLARE_HOST_FUNCTION(jsFunctionCreateCommonJSModule);
JSC_DECLARE_HOST_FUNCTION(jsFunctionLoadModule);

class JSCommonJSModule final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags | JSC::OverridesPut;

    mutable JSC::WriteBarrier<JSC::JSString> m_id;
    mutable JSC::WriteBarrier<JSC::JSString> m_filename;
    mutable JSC::WriteBarrier<JSC::JSString> m_dirname;
    mutable JSC::WriteBarrier<JSC::JSSourceCode> sourceCode;

    static void destroy(JSC::JSCell*);
    ~JSCommonJSModule();

    void finishCreation(JSC::VM& vm,
        JSC::JSString* id, JSC::JSString* filename,
        JSC::JSString* dirname, JSC::JSSourceCode* sourceCode);

    static JSC::Structure* createStructure(JSC::JSGlobalObject* globalObject);

    JSFunction* compile(JSC::VM& vm, JSC::JSGlobalObject* globalObject);

    static JSCommonJSModule* create(JSC::VM& vm, JSC::Structure* structure,
        JSC::JSString* id,
        JSC::JSString* filename,
        JSC::JSString* dirname, JSC::JSSourceCode* sourceCode);

    static JSCommonJSModule* create(
        Zig::GlobalObject* globalObject,
        const WTF::String& key,
        JSValue exportsObject,
        bool hasEvaluated = false);

    static JSCommonJSModule* create(
        Zig::GlobalObject* globalObject,
        const WTF::String& key,
        ResolvedSource resolvedSource);

    static JSCommonJSModule* create(Zig::GlobalObject* globalObject, const WTF::String& key,
        const WTF::String& dirname,
        const SyntheticSourceProvider::SyntheticSourceGenerator& generator);

    void toSyntheticSource(JSC::JSGlobalObject* globalObject,
        JSC::Identifier moduleKey,
        Vector<JSC::Identifier, 4>& exportNames,
        JSC::MarkedArgumentBuffer& exportValues);

    JSValue exportsObject();
    JSValue id();

    DECLARE_VISIT_CHILDREN;

    static bool put(JSC::JSCell* cell, JSC::JSGlobalObject* globalObject,
        JSC::PropertyName propertyName, JSC::JSValue value,
        JSC::PutPropertySlot& slot);

    DECLARE_INFO;
    template<typename, SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm);

    bool hasEvaluated = false;

    JSCommonJSModule(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }
};

JSCommonJSModule* createCommonJSModuleWithoutRunning(
    Zig::GlobalObject* globalObject,
    Ref<Zig::SourceProvider> sourceProvider,
    const WTF::String& sourceURL,
    ResolvedSource source);

JSC::Structure* createCommonJSModuleStructure(
    Zig::GlobalObject* globalObject);

std::optional<JSC::SourceCode> createCommonJSModule(
    Zig::GlobalObject* globalObject,
    ResolvedSource source);

} // namespace Bun
