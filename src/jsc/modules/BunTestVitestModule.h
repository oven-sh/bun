
extern "C" JSC::EncodedJSValue Bun__Jest__createVitestModuleObject(JSC::JSGlobalObject*);

namespace Zig {
// What `import "vitest"` resolves to under `bun test`.
void generateNativeModule_BunTestVitest(
    JSC::JSGlobalObject* lexicalGlobalObject,
    JSC::Identifier moduleKey,
    Vector<JSC::Identifier, 4>& exportNames,
    JSC::MarkedArgumentBuffer& exportValues)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto globalObject = uncheckedDowncast<Zig::GlobalObject>(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto& cached = globalObject->nativeModuleDefaultObject(NativeModuleDefaultSlot::BunTestVitest);
    JSObject* object = cached.get();
    if (!object) {
        JSValue created = JSValue::decode(Bun__Jest__createVitestModuleObject(globalObject));
        RETURN_IF_EXCEPTION(scope, );
        object = created.getObject();
        cached.set(vm, globalObject, object);
    }

    RELEASE_AND_RETURN(scope, exportTestModuleObject(lexicalGlobalObject, object, exportNames, exportValues));
}

} // namespace Zig
