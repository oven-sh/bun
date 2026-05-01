
using namespace JSC;
using namespace WebCore;

namespace Zig {
inline void
generateNativeModule_UTF8Validate(JSC::JSGlobalObject* globalObject,
    JSC::Identifier moduleKey,
    Vector<JSC::Identifier, 4>& exportNames,
    JSC::MarkedArgumentBuffer& exportValues)
{
    auto& vm = JSC::getVM(globalObject);

    exportNames.append(vm.propertyNames->defaultKeyword);
    exportValues.append(JSC::JSFunction::create(
        vm, globalObject, 1, "utf8Validate"_s, jsBufferConstructorFunction_isUtf8,
        ImplementationVisibility::Public, NoIntrinsic,
        jsBufferConstructorFunction_isUtf8));
}

} // namespace Zig
