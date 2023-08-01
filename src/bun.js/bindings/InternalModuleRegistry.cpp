#include "InternalModuleRegistry.h"

#include "ZigGlobalObject.h"
#include "JavaScriptCore/BuiltinUtils.h"
#include "JavaScriptCore/JSFunction.h"
#include "JavaScriptCore/LazyProperty.h"
#include "JavaScriptCore/LazyPropertyInlines.h"
#include "JavaScriptCore/VMTrapsInlines.h"
#include "JavaScriptCore/JSModuleLoader.h"

#include "InternalModuleRegistryConstants.h"

namespace Bun {

// The `INTERNAL_MODULE_REGISTRY_GENERATE` macro handles inlining code to compile and run a
// JS builtin that acts as a module. In debug mode, we use a different implementation that reads
// from the developer's filesystem. This allows reloading code without recompiling bindings.

#define INTERNAL_MODULE_REGISTRY_GENERATE_(globalObject, vm, SOURCE, id)                              \
    auto throwScope = DECLARE_THROW_SCOPE(vm);                                                        \
                                                                                                      \
    SourceCode source = JSC::makeSource(SOURCE, SourceOrigin(WTF::URL("builtin://hi"_s)), "hi.js"_s); \
                                                                                                      \
    JSFunction* func                                                                                  \
        = JSFunction::create(                                                                         \
            vm,                                                                                       \
            createBuiltinExecutable(                                                                  \
                vm, source,                                                                           \
                Identifier(),                                                                         \
                ImplementationVisibility::Public,                                                     \
                ConstructorKind::None,                                                                \
                ConstructAbility::CannotConstruct)                                                    \
                ->link(vm, nullptr, source),                                                          \
            static_cast<JSC::JSGlobalObject*>(globalObject));                                         \
                                                                                                      \
    JSC::MarkedArgumentBuffer argList;                                                                \
                                                                                                      \
    JSValue result = JSC::call(                                                                       \
        globalObject,                                                                                 \
        func,                                                                                         \
        JSC::getCallData(func),                                                                       \
        globalObject, JSC::MarkedArgumentBuffer());                                                   \
                                                                                                      \
    RETURN_IF_EXCEPTION(throwScope, {});                                                              \
    ASSERT_INTERNAL_MODULE(result, id);                                                               \
    return result;

#if BUN_DEBUG
#include "../../src/js/out/DebugPath.h"
#define ASSERT_INTERNAL_MODULE(result, moduleName)                                                        \
    if (!result || !result.isCell() || !jsDynamicCast<JSObject*>(result)) {                               \
        printf("Expected \"%s\" to export a JSObject. Bun is going to crash.", moduleName.utf8().data()); \
    }
JSValue initializeInternalModuleFromDisk(
    JSGlobalObject* globalObject,
    VM& vm,
    WTF::String moduleName,
    WTF::String fileBase,
    WTF::String fallback)
{
    WTF::String file = makeString(BUN_DYNAMIC_JS_LOAD_PATH, "modules_dev/"_s, fileBase);
    if (auto contents = WTF::FileSystemImpl::readEntireFile(file)) {
        auto string = WTF::String::fromUTF8(contents.value());
        INTERNAL_MODULE_REGISTRY_GENERATE_(globalObject, vm, string, moduleName);
    } else {
        printf("bun-debug failed to load bundled version of \"%s\" at \"%s\" (was it deleted?)\n"
               "Please run `make js` to rebundle these builtins.\n",
            moduleName.utf8().data(), file.utf8().data());
        // Fallback to embedded source
        INTERNAL_MODULE_REGISTRY_GENERATE_(globalObject, vm, fallback, moduleName);
    }
}
#define INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, moduleId, filename, SOURCE) \
    return initializeInternalModuleFromDisk(globalObject, vm, moduleId, filename, SOURCE)
#else

#define ASSERT_INTERNAL_MODULE(result, moduleName) \
    {                                              \
    }
#define INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, moduleId, filename, SOURCE) \
    INTERNAL_MODULE_REGISTRY_GENERATE_(globalObject, vm, SOURCE, moduleId)
#endif

const ClassInfo InternalModuleRegistry::s_info = { "InternalModuleRegistry"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(InternalModuleRegistry) };

InternalModuleRegistry::InternalModuleRegistry(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

template<typename Visitor>
void InternalModuleRegistry::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = jsCast<InternalModuleRegistry*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
}

DEFINE_VISIT_CHILDREN_WITH_MODIFIER(JS_EXPORT_PRIVATE, InternalModuleRegistry);

InternalModuleRegistry* InternalModuleRegistry::create(VM& vm, Structure* structure)
{
    InternalModuleRegistry* registry = new (NotNull, allocateCell<InternalModuleRegistry>(vm)) InternalModuleRegistry(vm, structure);
    for (uint8_t i = 0; i < BUN_INTERNAL_MODULE_COUNT; i++) {
        registry->internalField(static_cast<Field>(i))
            .set(vm, registry, jsUndefined());
    }
    return registry;
}

Structure* InternalModuleRegistry::createStructure(VM& vm, JSGlobalObject* globalObject)
{
    return Structure::create(vm, globalObject, jsNull(), TypeInfo(InternalFieldTupleType, StructureFlags), info(), 0, 48);
}

JSValue InternalModuleRegistry::requireId(JSGlobalObject* globalObject, VM& vm, Field id)
{
    auto value = internalField(id).get();
    if (!value || value.isUndefined()) {
        value = createInternalModuleById(globalObject, vm, id);
    }

    return value;
}

#include "../../../src/js/out/InternalModuleRegistry+createInternalModuleById.h"

// This is called like @getInternalField(@internalModuleRegistry, 1) ?? @createInternalModuleById(1)
// so we want to write it to the internal field when loaded.
JSC_DEFINE_HOST_FUNCTION(InternalModuleRegistry::jsCreateInternalModuleById, (JSGlobalObject * lexicalGlobalObject, CallFrame* callframe))
{
    auto id = callframe->argument(0).toUInt32(lexicalGlobalObject);
    auto registry = static_cast<Zig::GlobalObject*>(lexicalGlobalObject)->internalModuleRegistry();
    auto module = registry->createInternalModuleById(lexicalGlobalObject, lexicalGlobalObject->vm(), static_cast<Field>(id));
    registry->internalField(static_cast<Field>(id)).set(lexicalGlobalObject->vm(), registry, module);
    return JSValue::encode(module);
}

} // namespace Bun

#undef INTERNAL_MODULE_REGISTRY_GENERATE_
#undef INTERNAL_MODULE_REGISTRY_GENERATE
