#include "root.h"
#include "headers-handwritten.h"

namespace Zig {
class GlobalObject;
}
namespace JSC {
class SourceCode;
}

namespace Bun {

class JSCommonJSModule final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags | JSC::OverridesPut;

    mutable JSC::WriteBarrier<JSC::Unknown> m_exportsObject;
    mutable JSC::WriteBarrier<JSC::JSString> m_id;

    void finishCreation(JSC::VM& vm, JSC::JSValue exportsObject,
        JSC::JSString* id, JSC::JSString* filename,
        JSC::JSString* dirname);

    static JSC::Structure* createStructure(JSC::JSGlobalObject* globalObject);

    static JSCommonJSModule* create(JSC::VM& vm, JSC::Structure* structure,
        JSC::JSValue exportsObject, JSC::JSString* id,
        JSC::JSString* filename,
        JSC::JSString* dirname);

    static JSCommonJSModule* create(
        Zig::GlobalObject* globalObject,
        const WTF::String& key,
        const WTF::String& dirname,
        JSC::JSObject* moduleNamespaceObject);

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

    JSCommonJSModule(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }
};

JSC::Structure* createCommonJSModuleStructure(
    Zig::GlobalObject* globalObject);

JSC::SourceCode createCommonJSModule(
    Zig::GlobalObject* globalObject,
    ResolvedSource source);

} // namespace Bun
