
extern "C" JSC::EncodedJSValue Bun__Jest__vitestModuleObject(Zig::GlobalObject*);

namespace Zig {
// `import "vitest"` resolves to this under `bun test`.
void generateNativeModule_BunTestVitest(
    JSC::JSGlobalObject* lexicalGlobalObject,
    JSC::Identifier moduleKey,
    Vector<JSC::Identifier, 4>& exportNames,
    JSC::MarkedArgumentBuffer& exportValues)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto globalObject = uncheckedDowncast<Zig::GlobalObject>(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue object = JSValue::decode(Bun__Jest__vitestModuleObject(globalObject));
    RETURN_IF_EXCEPTION(scope, );

    RELEASE_AND_RETURN(scope, exportTestModuleObject(lexicalGlobalObject, object.getObject(), exportNames, exportValues));
}

} // namespace Zig
