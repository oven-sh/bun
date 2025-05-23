#include "JSCommonJSExtensions.h"
#include "ZigGlobalObject.h"
#include "BunProcess.h"
#include "ModuleLoader.h"
#include "JSCommonJSModule.h"

namespace Bun {
using namespace JSC;

const JSC::ClassInfo JSCommonJSExtensions::s_info = { "CommonJSExtensions"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSCommonJSExtensions) };

JSC::EncodedJSValue builtinLoader(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame, BunLoaderType loaderType);

// These functions are separate so that assigning one to the other can be
// detected and use the corresponding loader.
JSC_DEFINE_HOST_FUNCTION(jsLoaderJS, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return builtinLoader(globalObject, callFrame, BunLoaderTypeJS);
}
JSC_DEFINE_HOST_FUNCTION(jsLoaderTS, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return builtinLoader(globalObject, callFrame, BunLoaderTypeTS);
}
JSC_DEFINE_HOST_FUNCTION(jsLoaderJSON, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return builtinLoader(globalObject, callFrame, BunLoaderTypeJSON);
}
#define jsLoaderNode Process_functionDlopen

// The few places that call the above functions directly are usually because the
// developer is using a package to allow injecting a transpiler into Node.js. An
// example is the Next.js require extensions hook:
//
//     const oldJSHook = require.extensions['.js'];
//     require.extensions['.js'] = function(mod, filename) {
//         try {
//             return oldJSHook(mod, filename);
//         } catch (error) {
//             if (error.code !== 'ERR_REQUIRE_ESM') {
//                 throw error;
//             }
//             const content = readFileSync(filename, 'utf8');
//             const { code } = transformSync(content, swcOptions);
//             mod._compile(code, filename);
//         }
//     };
//
// These sorts of hooks don't do their intended purpose. Since Bun has always
// supported requiring ESM+TypeScript+JSX, errors are never thrown. This
// is just asking to make the developer experience worse.
//
// Since developers are not even aware of some of these hooks, some are disabled
// automatically. Some hooks have genuine use cases, such as adding new loaders.
bool isAllowedToMutateExtensions(JSC::JSGlobalObject* globalObject)
{
    JSC::VM& vm = globalObject->vm();
    WTF::Vector<JSC::StackFrame> stackFrames;
    vm.interpreter.getStackTrace(globalObject, stackFrames, 0, 1);
    if (stackFrames.size() == 0) return true;
    JSC::StackFrame& frame = stackFrames[0];

    WTF::String url = frame.sourceURL(vm);
    if (!url) return true;

#if OS(WINDOWS)
#define CHECK_PATH(url, _, windows) (url.contains(windows))
#else
#define CHECK_PATH(url, posix, _) (url.contains(posix))
#endif

    // When adding to this list, please comment why the package is using extensions incorrectly.
    if (CHECK_PATH(url, "dist/build/next-config-ts/"_s, "dist\\build\\next-config-ts\\"_s))
        return false; // Next.js adds SWC support to add features Bun already has.
    if (CHECK_PATH(url, "@meteorjs/babel"_s, "@meteorjs\\babel"_s))
        return false; // Wraps existing loaders to use Babel.
    // NOTE: @babel/core is not on this list because it checks if extensions[".ts"] exists
    //       before adding it's own.
    // NOTE: vitest uses extensions correctly
    // NOTE: vite doesn't need to use extensions, but blocking them would make
    //       it slower as they already bundle the code before injecting the hook.

#undef CHECK_PATH
    return true;
}

void JSCommonJSExtensions::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));

    Zig::GlobalObject* global = defaultGlobalObject(globalObject());
    JSC::JSFunction* fnLoadJS = JSC::JSFunction::create(
        vm,
        global,
        2,
        ""_s,
        jsLoaderJS,
        JSC::ImplementationVisibility::Public,
        JSC::Intrinsic::NoIntrinsic,
        JSC::callHostFunctionAsConstructor);
    JSC::JSFunction* fnLoadJSON = JSC::JSFunction::create(
        vm,
        global,
        2,
        ""_s,
        jsLoaderJSON,
        JSC::ImplementationVisibility::Public,
        JSC::Intrinsic::NoIntrinsic,
        JSC::callHostFunctionAsConstructor);
    JSC::JSFunction* fnLoadNode = JSC::JSFunction::create(
        vm,
        global,
        2,
        ""_s,
        jsLoaderNode,
        JSC::ImplementationVisibility::Public,
        JSC::Intrinsic::NoIntrinsic,
        JSC::callHostFunctionAsConstructor);
    JSC::JSFunction* fnLoadTS = JSC::JSFunction::create(
        vm,
        global,
        2,
        ""_s,
        jsLoaderTS,
        JSC::ImplementationVisibility::Public,
        JSC::Intrinsic::NoIntrinsic,
        JSC::callHostFunctionAsConstructor);

    this->putDirect(vm, JSC::Identifier::fromString(vm, ".js"_s), fnLoadJS, 0);
    this->putDirect(vm, JSC::Identifier::fromString(vm, ".json"_s), fnLoadJSON, 0);
    this->putDirect(vm, JSC::Identifier::fromString(vm, ".node"_s), fnLoadNode, 0);
    this->putDirect(vm, JSC::Identifier::fromString(vm, ".ts"_s), fnLoadTS, 0);
    this->putDirect(vm, JSC::Identifier::fromString(vm, ".cts"_s), fnLoadTS, 0);
    this->putDirect(vm, JSC::Identifier::fromString(vm, ".mjs"_s), fnLoadJS, 0);
    this->putDirect(vm, JSC::Identifier::fromString(vm, ".mts"_s), fnLoadTS, 0);
}

extern "C" void NodeModuleModule__onRequireExtensionModify(
    Zig::GlobalObject* globalObject,
    const BunString* key,
    uint32_t kind,
    JSC::JSValue value);

void onAssign(Zig::GlobalObject* globalObject, JSC::PropertyName propertyName, JSC::JSValue value)
{
    if (propertyName.isSymbol()) return;
    auto* name = propertyName.publicName();
    if (!name->startsWith('.')) return;
    BunString ext = Bun::toString(name);
    uint32_t kind = 0;
    JSC::CallData callData = JSC::getCallData(value);
    if (callData.type == JSC::CallData::Type::Native) {
        auto* untaggedPtr = callData.native.function.untaggedPtr();
        if (untaggedPtr == &jsLoaderJS) {
            kind = 1;
        } else if (untaggedPtr == &jsLoaderJSON) {
            kind = 2;
        } else if (untaggedPtr == &jsLoaderNode) {
            kind = 3;
        } else if (untaggedPtr == &jsLoaderTS) {
            kind = 4;
        }
    } else if (callData.type == JSC::CallData::Type::None) {
        kind = -1;
    }
    NodeModuleModule__onRequireExtensionModify(globalObject, &ext, kind, value);
}

bool JSCommonJSExtensions::defineOwnProperty(JSC::JSObject* object, JSC::JSGlobalObject* globalObject, JSC::PropertyName propertyName, const JSC::PropertyDescriptor& descriptor, bool shouldThrow)
{
    if (!isAllowedToMutateExtensions(globalObject)) return true;
    JSValue value = descriptor.value();
    if (value) {
        onAssign(defaultGlobalObject(globalObject), propertyName, value);
    } else {
        onAssign(defaultGlobalObject(globalObject), propertyName, JSC::jsUndefined());
    }
    return Base::defineOwnProperty(object, globalObject, propertyName, descriptor, shouldThrow);
}

bool JSCommonJSExtensions::put(JSC::JSCell* cell, JSC::JSGlobalObject* globalObject, JSC::PropertyName propertyName, JSC::JSValue value, JSC::PutPropertySlot& slot)
{
    if (!isAllowedToMutateExtensions(globalObject)) return true;
    onAssign(defaultGlobalObject(globalObject), propertyName, value);
    return Base::put(cell, globalObject, propertyName, value, slot);
}

bool JSCommonJSExtensions::deleteProperty(JSC::JSCell* cell, JSC::JSGlobalObject* globalObject, JSC::PropertyName propertyName, JSC::DeletePropertySlot& slot)
{
    if (!isAllowedToMutateExtensions(globalObject)) return true;
    bool deleted = Base::deleteProperty(cell, globalObject, propertyName, slot);
    if (deleted) {
        onAssign(defaultGlobalObject(globalObject), propertyName, JSC::jsUndefined());
    }
    return deleted;
}

extern "C" uint32_t JSCommonJSExtensions__appendFunction(Zig::GlobalObject* globalObject, JSC::JSValue value)
{
    JSCommonJSExtensions* extensions = globalObject->lazyRequireExtensionsObject();
    extensions->m_registeredFunctions.append(JSC::WriteBarrier<Unknown>());
    extensions->m_registeredFunctions.last().set(globalObject->vm(), extensions, value);
    return extensions->m_registeredFunctions.size() - 1;
}

extern "C" void JSCommonJSExtensions__setFunction(Zig::GlobalObject* globalObject, uint32_t index, JSC::JSValue value)
{
    JSCommonJSExtensions* extensions = globalObject->lazyRequireExtensionsObject();
    extensions->m_registeredFunctions[index].set(globalObject->vm(), globalObject, value);
}

extern "C" uint32_t JSCommonJSExtensions__swapRemove(Zig::GlobalObject* globalObject, uint32_t index)
{
    JSCommonJSExtensions* extensions = globalObject->lazyRequireExtensionsObject();
    ASSERT(extensions->m_registeredFunctions.size() > 0);
    if (extensions->m_registeredFunctions.size() == 1) {
        extensions->m_registeredFunctions.clear();
        return index;
    }
    ASSERT(index < extensions->m_registeredFunctions.size());
    if (index < (extensions->m_registeredFunctions.size() - 1)) {
        JSValue last = extensions->m_registeredFunctions.takeLast().get();
        extensions->m_registeredFunctions[index].set(globalObject->vm(), globalObject, last);
        return extensions->m_registeredFunctions.size();
    } else {
        extensions->m_registeredFunctions.removeLast();
        return index;
    }
}

// This implements `Module._extensions['.js']`, which
// - Loads source code from a file
//     - [not supported] Calls `fs.readFileSync`, which is usually not overridden.
// - Evaluates the module
//     - Calls `module._compile(code, filename)`, which is often overridden.
// - Returns `undefined`
JSC::EncodedJSValue builtinLoader(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame, BunLoaderType loaderType)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    Zig::GlobalObject* global = defaultGlobalObject(globalObject);
    JSC::JSObject* modValue = callFrame->argument(0).getObject();
    if (!modValue) {
        throwTypeError(globalObject, scope, "Module._extensions['.js'] must be called with a CommonJS module object"_s);
        return JSC::JSValue::encode({});
    }
    Bun::JSCommonJSModule* mod = jsDynamicCast<Bun::JSCommonJSModule*>(modValue);
    if (!mod) {
        throwTypeError(globalObject, scope, "Module._extensions['.js'] must be called with a CommonJS module object"_s);
        return JSC::JSValue::encode({});
    }
    JSC::JSValue specifier = callFrame->argument(1);
    WTF::String specifierWtfString = specifier.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    BunString specifierBunString = Bun::toString(specifierWtfString);
    BunString empty = BunStringEmpty;
    JSC::VM& vm = globalObject->vm();
    ErrorableResolvedSource res;
    res.success = false;
    memset(&res.result, 0, sizeof res.result);

    JSValue result = fetchCommonJSModuleNonBuiltin<true>(
        global->bunVM(),
        vm,
        global,
        &specifierBunString,
        specifier,
        &empty,
        &empty,
        &res,
        mod,
        specifierWtfString,
        loaderType,
        scope);
    RETURN_IF_EXCEPTION(scope, {});
    if (result == jsNumber(-1)) {
        // ESM
        JSC::JSFunction* requireESM = global->requireESMFromHijackedExtension();
        JSC::MarkedArgumentBuffer args;
        args.append(specifier);
        JSC::CallData callData = JSC::getCallData(requireESM);
        ASSERT(callData.type == JSC::CallData::Type::JS);
        NakedPtr<JSC::Exception> returnedException = nullptr;
        JSC::profiledCall(global, JSC::ProfilingReason::API, requireESM, callData, mod, args, returnedException);
        if (returnedException) [[unlikely]] {
            throwException(globalObject, scope, returnedException->value());
            return JSC::JSValue::encode({});
        }
    }

    return JSC::JSValue::encode(jsUndefined());
}

template<typename Visitor>
void JSCommonJSExtensions::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSCommonJSExtensions* thisObject = jsCast<JSCommonJSExtensions*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);

    for (auto& func : thisObject->m_registeredFunctions) {
        visitor.append(func);
    }
}

DEFINE_VISIT_CHILDREN(JSCommonJSExtensions);

} // namespace Bun
