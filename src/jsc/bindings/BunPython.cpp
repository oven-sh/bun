#include "root.h"

#include "Bindgen/JSWrapper.h"
#include "BunClientData.h"
#include "BunProcess.h"
#include "BunPython.h"
#include "python/BunPythonModule.h"
#include "BunString.h"
#include "JSEnvironmentVariableMap.h"
#include "ZigGlobalObject.h"
#include "headers.h"
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/PyCommandLine.h>
#include <JavaScriptCore/PyExec.h>
#include <JavaScriptCore/PyVirtualFiles.h>
#include <mutex>
#include <sys/stat.h>
#include <unistd.h>

// Python is a language of JavaScriptCore (vendor/WebKit/Source/JavaScriptCore/python). This is what Bun adds: running a file
// as the program, and files as modules.

extern "C" JSC::EncodedJSValue Bun__Process__createArgv(JSC::JSGlobalObject*);
extern "C" void Bun__setExitCode(void* bunVM, uint8_t);
// src/runtime/cli/python_command.rs
extern "C" BunString Bun__Python__linkToSelf();
extern "C" BunString Bun__Python__executedPath();
extern "C" const char* Bun__Python__originalArgument(size_t index);
extern "C" void Bun__Python__didChangeDirectory(JSC::JSGlobalObject*);
extern "C" int32_t bun_is_stdio_null[3];

namespace Bun {
using namespace JSC;

// src/jsc/JSType.rs
static_assert(PyObjectType == 103 && PyExceptionType == 121 && pyObjectTypes.first == PyObjectType && pyObjectTypes.last == PyExceptionType);

// ---- The configuration ----

static bool s_isPythonCommand;

// As CPython makes the path of the program absolute: the path is made normal, then put behind the working directory. So the `..` it
// begins with stay.
static String absolutePathOfProgram(const String& path)
{
    if (path.startsWith('/'))
        return Python::absolutePath(path);
    unsigned levelsUp = 0;
    Vector<StringView> parts;
    for (auto part : StringView(path).split('/')) {
        if (part == "."_s)
            continue;
        if (part != ".."_s)
            parts.append(part);
        else if (parts.isEmpty())
            ++levelsUp;
        else
            parts.removeLast();
    }
    if (!levelsUp)
        return Python::absolutePath(path);
    StringBuilder result;
    result.append(Python::absolutePath("."_s));
    for (unsigned i = 0; i < levelsUp; ++i)
        result.append("/.."_s);
    for (auto part : parts)
        result.append('/', part);
    return result.toString();
}

// Where a shell finds the program of that name. No link is followed: a virtual environment is known by where its link is.
static String findProgram(const String& name)
{
    auto isProgram = [](const String& path) {
        struct stat info;
        auto utf8 = path.utf8();
        const char* file = byteCast<char>(utf8.data());
        return !stat(file, &info) && S_ISREG(info.st_mode) && !access(file, X_OK);
    };
    if (name.contains('/'))
        return absolutePathOfProgram(name);
    const char* searchPath = getenv("PATH");
    if (!searchPath)
        return {};
    for (auto& directory : String::fromUTF8(searchPath).splitAllowingEmptyEntries(':')) {
        String candidate = absolutePathOfProgram(directory.isEmpty() ? name : makeString(directory, '/', name));
        if (isProgram(candidate))
            return candidate;
    }
    return {};
}

// `python3 ...`, before there is a VM. (src/runtime/cli/python_command.rs)
extern "C" int Bun__Python__readCommandLine(size_t argc, const char* const* argv)
{
    s_isPythonCommand = true;
    return Python::readCommandLine(Python::configuration(), std::span { argv, argc }).value_or(-1);
}

// os.chdir(). What process.chdir() does besides: the resolver and process.cwd() keep the name of the directory.
static void didChangeDirectory(JSGlobalObject* globalObject)
{
    Bun__Python__didChangeDirectory(globalObject);
    defaultGlobalObject(globalObject)->processObject()->clearCachedCwd();
}

// Before anything that may start Python.
static void preparePython()
{
    installPythonStandardLibrary();
    registerPythonModules();
    static std::once_flag once;
    std::call_once(once, [] {
        Python::setDidChangeDirectoryFunction(didChangeDirectory);
        Python::setHostEnvironment({ readProcessEnvForPython, writeProcessEnvFromPython });
        Python::setClassIsCalledFunction(Bun::Bindgen::isClassWithCall);
        auto& configuration = Python::configuration();
        if (!s_isPythonCommand) {
            for (size_t i = 0; const char* argument = Bun__Python__originalArgument(i); ++i)
                configuration.originalArguments.append(String::fromUTF8(argument));
            if (auto status = Python::readEnvironment(configuration))
                _exit(*status);
        }
        // Started as `python3`, the interpreter is the file that was executed, which stays where it is: virtual environments link to it.
        if (s_isPythonCommand) {
            BunString executed = Bun__Python__executedPath();
            configuration.executable = executed.transferToWTFString();
            configuration.executable = configuration.executable.isEmpty() ? findProgram(configuration.programName) : absolutePathOfProgram(configuration.executable);
        }
        if (configuration.executable.isEmpty()) {
            BunString link = Bun__Python__linkToSelf();
            configuration.baseExecutable = link.transferToWTFString();
            configuration.executable = configuration.baseExecutable;
        }
        configuration.interactiveModule = "_bun_repl"_s;
        for (unsigned i = 0; i < 3; ++i)
            configuration.standardStreamWasClosed[i] = bun_is_stdio_null[i];
    });
}

void PythonModules::exitWithPythonStatus(JSGlobalObject* globalObject, int status)
{
    if (status < 0) {
        Python::finalizeInterpreter(globalObject);
        Python::dieIfStatusIsSignal(status);
    }
    Bun__Process__exit(defaultGlobalObject(globalObject), static_cast<uint8_t>(status));
}

extern "C" bool Bun__Python__exitIfExceptionAsksTo(JSGlobalObject* globalObject, EncodedJSValue encodedException)
{
    JSValue exception = JSValue::decode(encodedException);
    if (!Python::endsProgram(globalObject, exception))
        return false;
    if (auto status = Python::mainModuleEnded(globalObject, exception))
        PythonModules::exitWithPythonStatus(globalObject, *status);
    return true;
}

// What nothing caught, wherever it surfaced, is reported as at the top level of a program: by sys.excepthook.
extern "C" bool Bun__Python__reportUncaught(JSGlobalObject* globalObject, EncodedJSValue exception)
{
    return Python::reportUncaughtException(globalObject, JSValue::decode(exception));
}

JSC_DEFINE_HOST_FUNCTION(mainModuleFulfilled, (JSGlobalObject * globalObject, CallFrame*))
{
    Python::mainModuleEnded(globalObject, {});
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(mainModuleRejected, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    if (auto status = Python::mainModuleEnded(globalObject, callFrame->argument(0)))
        PythonModules::exitWithPythonStatus(globalObject, *status);
    return JSValue::encode(jsUndefined());
}

// `bun main.py arguments...`
extern "C" JSPromise* Bun__Python__loadMain(Zig::GlobalObject* globalObject, const BunString* path)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    preparePython();

    String pathString = path->toWTFString(BunString::ZeroCopy).isolatedCopy();
    auto contents = Python::readFile(pathString);
    if (!contents) {
        auto message = makeString("bun: can't open file '"_s, pathString, "': "_s, String::fromUTF8(strerror(errno)), '\n').utf8();
        fwrite(message.data(), 1, message.length(), stderr);
        Bun__Process__exit(globalObject, 2);
        RELEASE_AND_RETURN(scope, JSPromise::resolvedPromise(globalObject, jsUndefined()));
    }

    // process.argv is [bun, the file, arguments...].
    Vector<String> arguments;
    if (auto* argv = dynamicDowncast<JSArray>(JSValue::decode(Bun__Process__createArgv(globalObject)))) {
        for (unsigned i = 2; i < argv->length(); ++i) {
            arguments.append(argv->getIndex(globalObject, i).toWTFString(globalObject));
            if (scope.exception()) [[unlikely]]
                return JSPromise::rejectedPromiseWithCaughtException(globalObject, scope);
        }
    }
    if (scope.exception()) [[unlikely]]
        return JSPromise::rejectedPromiseWithCaughtException(globalObject, scope);

    // An exception that ends the program ends the process, whatever the event loop still has to do.
    JSValue unfinished;
    if (auto status = Python::runMainModule(globalObject, pathString, contents->span(), arguments, &unfinished))
        PythonModules::exitWithPythonStatus(globalObject, *status);
    if (!unfinished)
        RELEASE_AND_RETURN(scope, JSPromise::resolvedPromise(globalObject, jsUndefined()));

    // It awaits at the top level.
    auto* promise = uncheckedDowncast<JSPromise>(unfinished.asCell());
    auto* fulfilled = JSFunction::create(vm, globalObject, 1, String(), mainModuleFulfilled, ImplementationVisibility::Private);
    auto* rejected = JSFunction::create(vm, globalObject, 1, String(), mainModuleRejected, ImplementationVisibility::Private);
    JSObject* ended = promise->then(globalObject, fulfilled, rejected);
    if (scope.exception()) [[unlikely]]
        return JSPromise::rejectedPromiseWithCaughtException(globalObject, scope);
    return uncheckedDowncast<JSPromise>(ended);
}

JSC_DEFINE_HOST_FUNCTION(commandLineProgramFulfilled, (JSGlobalObject * globalObject, CallFrame*))
{
    if (auto status = Python::commandLineProgramEnded(globalObject, {}))
        PythonModules::exitWithPythonStatus(globalObject, *status);
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(commandLineProgramRejected, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    if (auto status = Python::commandLineProgramEnded(globalObject, callFrame->argument(0)))
        PythonModules::exitWithPythonStatus(globalObject, *status);
    return JSValue::encode(jsUndefined());
}

// `python3 ...`: what Bun__Python__readCommandLine() has read.
extern "C" JSPromise* Bun__Python__runCommandLine(Zig::GlobalObject* globalObject)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    preparePython();

    JSValue unfinished;
    if (auto status = Python::runCommandLine(globalObject, &unfinished))
        PythonModules::exitWithPythonStatus(globalObject, *status);
    if (!unfinished)
        RELEASE_AND_RETURN(scope, JSPromise::resolvedPromise(globalObject, jsUndefined()));

    auto* promise = uncheckedDowncast<JSPromise>(unfinished.asCell());
    auto* fulfilled = JSFunction::create(vm, globalObject, 1, String(), commandLineProgramFulfilled, ImplementationVisibility::Private);
    auto* rejected = JSFunction::create(vm, globalObject, 1, String(), commandLineProgramRejected, ImplementationVisibility::Private);
    JSObject* ended = promise->then(globalObject, fulfilled, rejected);
    if (scope.exception()) [[unlikely]]
        return JSPromise::rejectedPromiseWithCaughtException(globalObject, scope);
    return uncheckedDowncast<JSPromise>(ended);
}

// `import "./file.py"`: the module object, whose attributes are the exports.
extern "C" EncodedJSValue Bun__Python__importFile(Zig::GlobalObject* globalObject, const BunString* path, const BunString* source)
{
    preparePython();
    return JSValue::encode(Python::importFileFromJS(globalObject, path->toWTFString(BunString::ZeroCopy).isolatedCopy(), source ? source->toWTFString(BunString::ZeroCopy).isolatedCopy() : String()));
}

// `bun:python` (src/js/bun/python.ts)
JSValue createPythonNamespace(Zig::GlobalObject* globalObject)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    preparePython();
    JSValue python = Python::importModuleFromJS(globalObject, "__python__"_s);
    RETURN_IF_EXCEPTION(scope, {});
    // src/python/_bun_python.py
    JSValue own = Python::importModuleFromJS(globalObject, "_bun_python"_s);
    RETURN_IF_EXCEPTION(scope, {});
    for (auto [name, nameInPython] : { std::pair { "with"_s, "with_"_s }, std::pair { "asyncWith"_s, "async_with"_s }, std::pair { "enter"_s, "enter"_s }, std::pair { "enterAsync"_s, "enter_async"_s } }) {
        JSValue function = own.get(globalObject, Identifier::fromString(vm, nameInPython));
        RETURN_IF_EXCEPTION(scope, {});
        asObject(python)->putDirect(vm, Identifier::fromString(vm, name), function);
    }
    return python;
}

StringView pythonModuleNameOfSpecifier(StringView specifier)
{
    constexpr auto prefix = "python:"_s;
    return specifier.startsWith(prefix) ? specifier.substring(prefix.length()) : StringView();
}

JSValue importPythonModule(Zig::GlobalObject* globalObject, StringView name, bool isRequire)
{
    preparePython();
    return Python::importModuleFromJS(globalObject, name.toString(), isRequire ? "MODULE_NOT_FOUND"_s : "ERR_MODULE_NOT_FOUND"_s);
}

// The process, or the worker, is about to exit. First this, then the listeners of process.on("exit"), then Bun__Python__finalize().
extern "C" void Bun__Python__runExitHandlers(Zig::GlobalObject* globalObject)
{
    Python::runExitHandlers(globalObject);
}

extern "C" void Bun__Python__finalize(Zig::GlobalObject* globalObject)
{
    if (!Python::finalizeInterpreter(globalObject))
        Bun__setExitCode(globalObject->bunVM(), Python::statusIfNotFlushed);
}

// The VM is about to be destroyed, and script is forbidden.
extern "C" void Bun__Python__stopThreads(Zig::GlobalObject* globalObject)
{
    Python::stopThreads(globalObject->vm());
    // The loop that would have seen to it does not turn again.
    PythonModules::makeCallsForEventLoopThread(globalObject->vm());
}

} // namespace Bun
