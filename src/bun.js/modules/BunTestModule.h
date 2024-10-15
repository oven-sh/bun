
namespace Zig {
void generateNativeModule_BunTest(
    JSC::JSGlobalObject* lexicalGlobalObject,
    JSC::Identifier moduleKey,
    Vector<JSC::Identifier, 4>& exportNames,
    JSC::MarkedArgumentBuffer& exportValues)
{
    JSC::VM& vm = lexicalGlobalObject->vm();
    auto globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);

    JSObject* object = globalObject->lazyPreloadTestModuleObject();

    exportNames.append(vm.propertyNames->defaultKeyword);
    exportValues.append(object);
}

} // namespace Zig
