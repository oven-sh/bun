#include "root.h"

#if OS(WINDOWS)

#include "BunProcess.h"
#include "ZigGlobalObject.h"
#include "FormatStackTraceForJS.h"
#include "headers.h" // For Bun__Process__createExecArgv and other exports
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/JSObject.h"
#include "JavaScriptCore/JSString.h"
#include "JavaScriptCore/JSArray.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/JSGlobalObject.h"
#include "JavaScriptCore/TopExceptionScope.h"
#include "JavaScriptCore/VM.h"
#include "JavaScriptCore/NumberPrototype.h"
#include "wtf-bindings.h"

#define STRINGIFY_IMPL(x) #x
#define STRINGIFY(x) STRINGIFY_IMPL(x)
#include "wtf/text/WTFString.h"
#include "wtf/text/StringView.h"
#include "wtf/text/ASCIILiteral.h"
#include "wtf/Vector.h"
#include "wtf/StdLibExtras.h"
#include "JavaScriptCore/StackFrame.h"
#include "JavaScriptCore/Interpreter.h"
#include "wtf/text/OrdinalNumber.h"
#include <uv.h>
#include <windows.h>
#include <psapi.h>
#include <versionhelpers.h>
#include <time.h>

namespace Bun {

using namespace JSC;

// External functions
extern "C" EncodedJSValue Bun__Process__createExecArgv(JSGlobalObject*);
extern "C" EncodedJSValue Bun__Os__createReportCpus(JSGlobalObject*);
extern "C" EncodedJSValue Bun__Os__createReportNetworkInterfaces(JSGlobalObject*);

JSValue constructReportObjectWindows(VM& vm, Zig::GlobalObject* globalObject, Process* process)
{
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSObject* report = constructEmptyObject(globalObject, globalObject->objectPrototype());
    RETURN_IF_EXCEPTION(scope, {});

    // Header section
    {
        JSObject* header = constructEmptyObject(globalObject, globalObject->objectPrototype());
        RETURN_IF_EXCEPTION(scope, {});

        Bun::putDirectNamed(vm, header, "reportVersion"_s, jsNumber(3));
        Bun::putDirectNamed(vm, header, "event"_s, jsString(vm, String("JavaScript API"_s)));
        Bun::putDirectNamed(vm, header, "trigger"_s, jsString(vm, String("GetReport"_s)));
        Bun::putDirectNamed(vm, header, "filename"_s, jsNull());

        // Timestamps
        double time = WTF::jsCurrentTime();
        char timeBuf[64] = { 0 };
        Bun::toISOString(vm, time, timeBuf);

        Bun::putDirectNamed(vm, header, "dumpEventTime"_s, JSC::numberToString(vm, time, 10));
        Bun::putDirectNamed(vm, header, "dumpEventTimeStamp"_s, jsString(vm, String::fromLatin1(timeBuf)));

        // Process info
        Bun::putDirectNamed(vm, header, "processId"_s, jsNumber(GetCurrentProcessId()));
        Bun::putDirectNamed(vm, header, "threadId"_s, jsNumber(0));

        // Working directory
        {
            WCHAR cwd[MAX_PATH];
            DWORD len = GetCurrentDirectoryW(MAX_PATH, cwd);
            if (len > 0 && len < MAX_PATH) {
                Bun::putDirectNamed(vm, header, "cwd"_s, jsString(vm, String({ reinterpret_cast<const char16_t*>(cwd), static_cast<size_t>(len) })));
            } else {
                Bun::putDirectNamed(vm, header, "cwd"_s, jsString(vm, String("."_s)));
            }
        }

        // Command line
        JSValue commandLine = JSValue::decode(Bun__Process__createExecArgv(globalObject));
        RETURN_IF_EXCEPTION(scope, {});
        Bun::putDirectNamed(vm, header, "commandLine"_s, commandLine);

        // Node version
        Bun::putDirectNamed(vm, header, "nodejsVersion"_s, jsString(vm, String::fromLatin1(REPORTED_NODEJS_VERSION)));
        Bun::putDirectNamed(vm, header, "wordSize"_s, jsNumber(64));

        // Platform info
#if CPU(X86_64)
        Bun::putDirectNamed(vm, header, "arch"_s, jsString(vm, String("x64"_s)));
#elif CPU(ARM64)
        Bun::putDirectNamed(vm, header, "arch"_s, jsString(vm, String("arm64"_s)));
#endif
        Bun::putDirectNamed(vm, header, "platform"_s, jsString(vm, String("win32"_s)));

        // Component versions - just add the minimum needed
        JSObject* versions = constructEmptyObject(globalObject, globalObject->objectPrototype());
        Bun::putDirectNamed(vm, versions, "node"_s, jsString(vm, String(REPORTED_NODEJS_VERSION ""_s)));
        Bun::putDirectNamed(vm, versions, "v8"_s, jsString(vm, String(ASCIILiteral::fromLiteralUnsafe(REPORTED_NODEJS_V8_VERSION))));
        Bun::putDirectNamed(vm, versions, "uv"_s, jsString(vm, String::fromLatin1(uv_version_string())));
        Bun::putDirectNamed(vm, versions, "modules"_s, jsString(vm, String(ASCIILiteral::fromLiteralUnsafe(STRINGIFY(REPORTED_NODEJS_ABI_VERSION)))));
        Bun::putDirectNamed(vm, header, "componentVersions"_s, versions);
        RETURN_IF_EXCEPTION(scope, {});

        // Release info
        JSObject* release = constructEmptyObject(globalObject, globalObject->objectPrototype());
        RETURN_IF_EXCEPTION(scope, {});
        Bun::putDirectNamed(vm, release, "name"_s, jsString(vm, String("node"_s)));
        Bun::putDirectNamed(vm, release, "sourceUrl"_s, jsString(vm, String("https://nodejs.org/download/release/v" REPORTED_NODEJS_VERSION "/node-v" REPORTED_NODEJS_VERSION ".tar.gz"_s)));
        Bun::putDirectNamed(vm, release, "headersUrl"_s, jsString(vm, String("https://nodejs.org/download/release/v" REPORTED_NODEJS_VERSION "/node-v" REPORTED_NODEJS_VERSION "-headers.tar.gz"_s)));
#if CPU(X86_64)
        Bun::putDirectNamed(vm, release, "libUrl"_s, jsString(vm, String("https://nodejs.org/download/release/v" REPORTED_NODEJS_VERSION "/win-x64/node.lib"_s)));
#elif CPU(ARM64)
        Bun::putDirectNamed(vm, release, "libUrl"_s, jsString(vm, String("https://nodejs.org/download/release/v" REPORTED_NODEJS_VERSION "/win-arm64/node.lib"_s)));
#endif
        Bun::putDirectNamed(vm, header, "release"_s, release);

        // OS info
        Bun::putDirectNamed(vm, header, "osName"_s, jsString(vm, String("Windows_NT"_s)));

        // Windows version info
        OSVERSIONINFOEXW osvi;
        ZeroMemory(&osvi, sizeof(OSVERSIONINFOEXW));
        osvi.dwOSVersionInfoSize = sizeof(OSVERSIONINFOEXW);

        DWORDLONG conditionMask = 0;
        VER_SET_CONDITION(conditionMask, VER_MAJORVERSION, VER_GREATER_EQUAL);
        VER_SET_CONDITION(conditionMask, VER_MINORVERSION, VER_GREATER_EQUAL);
        VER_SET_CONDITION(conditionMask, VER_BUILDNUMBER, VER_GREATER_EQUAL);

        osvi.dwMajorVersion = 10;
        osvi.dwMinorVersion = 0;
        osvi.dwBuildNumber = 0;

        if (VerifyVersionInfoW(&osvi, VER_MAJORVERSION | VER_MINORVERSION | VER_BUILDNUMBER, conditionMask)) {
            Bun::putDirectNamed(vm, header, "osRelease"_s, jsString(vm, String("10.0"_s)));
        } else {
            Bun::putDirectNamed(vm, header, "osRelease"_s, jsString(vm, String("6.1"_s)));
        }

        Bun::putDirectNamed(vm, header, "osVersion"_s, jsString(vm, String("Windows"_s)));

        // Host name
        {
            WCHAR hostname[MAX_COMPUTERNAME_LENGTH + 1];
            DWORD size = static_cast<DWORD>(std::size(hostname));
            if (GetComputerNameW(hostname, &size)) {
                Bun::putDirectNamed(vm, header, "host"_s, jsString(vm, String({ reinterpret_cast<const char16_t*>(hostname), static_cast<size_t>(size) })));
            } else {
                Bun::putDirectNamed(vm, header, "host"_s, jsEmptyString(vm));
            }
        }

        JSValue cpus = JSValue::decode(Bun__Os__createReportCpus(globalObject));
        RETURN_IF_EXCEPTION(scope, {});
        Bun::putDirectNamed(vm, header, "cpus"_s, cpus);

        JSValue networkInterfaces = JSValue::decode(Bun__Os__createReportNetworkInterfaces(globalObject));
        RETURN_IF_EXCEPTION(scope, {});
        Bun::putDirectNamed(vm, header, "networkInterfaces"_s, networkInterfaces);

        Bun::putDirectNamed(vm, report, "header"_s, header);
        RETURN_IF_EXCEPTION(scope, {});
    }

    // JavaScript stack
    {
        JSObject* javascriptStack = constructEmptyObject(globalObject, globalObject->objectPrototype());
        RETURN_IF_EXCEPTION(scope, {});

        javascriptStack->putDirect(vm, vm.propertyNames->message, jsString(vm, String("Error [ERR_SYNTHETIC]: JavaScript Callstack"_s)), 0);

        WTF::Vector<StackFrame> stackFrames;
        vm.interpreter.getStackTrace(javascriptStack, stackFrames, 1);

        String name = "Error"_s;
        String message = "JavaScript Callstack"_s;
        OrdinalNumber line = OrdinalNumber::beforeFirst();
        OrdinalNumber column = OrdinalNumber::beforeFirst();
        WTF::String sourceURL;

        WTF::String stackProperty = Bun::formatStackTrace(
            vm, globalObject, globalObject, name, message,
            line, column,
            sourceURL, stackFrames, nullptr);
        RETURN_IF_EXCEPTION(scope, {});

        WTF::String stack;
        size_t firstLine = stackProperty.find('\n');
        if (firstLine != WTF::notFound) {
            stack = stackProperty.substring(firstLine + 1);
        }

        JSArray* stackArray = constructEmptyArray(globalObject, nullptr);
        RETURN_IF_EXCEPTION(scope, {});

        stack.split('\n', [&](const WTF::StringView& line) {
            stackArray->push(globalObject, jsString(vm, line.toString().trim(isASCIIWhitespace)));
            RETURN_IF_EXCEPTION(scope, );
        });
        RETURN_IF_EXCEPTION(scope, {});

        javascriptStack->putDirect(vm, vm.propertyNames->stack, stackArray, 0);

        JSObject* errorProperties = constructEmptyObject(globalObject, globalObject->objectPrototype());
        RETURN_IF_EXCEPTION(scope, {});
        Bun::putDirectNamed(vm, errorProperties, "code"_s, jsString(vm, String("ERR_SYNTHETIC"_s)));
        Bun::putDirectNamed(vm, javascriptStack, "errorProperties"_s, errorProperties);

        Bun::putDirectNamed(vm, report, "javascriptStack"_s, javascriptStack);
        RETURN_IF_EXCEPTION(scope, {});
    }

    // JavaScript heap
    {
        JSObject* heap = constructEmptyObject(globalObject, globalObject->objectPrototype());
        RETURN_IF_EXCEPTION(scope, {});

        JSObject* heapSpaces = constructEmptyObject(globalObject);
        Bun::putDirectNamed(vm, heapSpaces, "read_only_space"_s, constructEmptyObject(globalObject));
        Bun::putDirectNamed(vm, heapSpaces, "new_space"_s, constructEmptyObject(globalObject));
        Bun::putDirectNamed(vm, heapSpaces, "old_space"_s, constructEmptyObject(globalObject));
        Bun::putDirectNamed(vm, heapSpaces, "code_space"_s, constructEmptyObject(globalObject));
        Bun::putDirectNamed(vm, heapSpaces, "shared_space"_s, constructEmptyObject(globalObject));
        Bun::putDirectNamed(vm, heapSpaces, "trusted_space"_s, constructEmptyObject(globalObject));
        Bun::putDirectNamed(vm, heapSpaces, "new_large_object_space"_s, constructEmptyObject(globalObject));
        Bun::putDirectNamed(vm, heapSpaces, "large_object_space"_s, constructEmptyObject(globalObject));
        Bun::putDirectNamed(vm, heapSpaces, "code_large_object_space"_s, constructEmptyObject(globalObject));
        Bun::putDirectNamed(vm, heapSpaces, "shared_large_object_space"_s, constructEmptyObject(globalObject));
        Bun::putDirectNamed(vm, heapSpaces, "trusted_large_object_space"_s, constructEmptyObject(globalObject));

        Bun::putDirectNamed(vm, heap, "totalMemory"_s, jsNumber(WTF::ramSize()));
        Bun::putDirectNamed(vm, heap, "usedMemory"_s, jsNumber(vm.heap.size()));
        Bun::putDirectNamed(vm, heap, "memoryLimit"_s, jsNumber(WTF::ramSize()));
        Bun::putDirectNamed(vm, heap, "heapSpaces"_s, heapSpaces);

        Bun::putDirectNamed(vm, report, "javascriptHeap"_s, heap);
        RETURN_IF_EXCEPTION(scope, {});
    }

    // Resource usage
    {
        JSObject* resourceUsage = constructEmptyObject(globalObject, globalObject->objectPrototype());
        RETURN_IF_EXCEPTION(scope, {});

        HANDLE hProcess = GetCurrentProcess();
        PROCESS_MEMORY_COUNTERS_EX pmc;
        ZeroMemory(&pmc, sizeof(pmc));
        pmc.cb = sizeof(pmc);

        if (GetProcessMemoryInfo(hProcess, (PROCESS_MEMORY_COUNTERS*)&pmc, sizeof(pmc))) {
            Bun::putDirectNamed(vm, resourceUsage, "rss"_s, jsNumber(pmc.WorkingSetSize));
            Bun::putDirectNamed(vm, resourceUsage, "maxRss"_s, jsNumber(pmc.PeakWorkingSetSize));
        } else {
            Bun::putDirectNamed(vm, resourceUsage, "rss"_s, jsNumber(0));
            Bun::putDirectNamed(vm, resourceUsage, "maxRss"_s, jsNumber(0));
        }

        FILETIME createTime, exitTime, kernelTime, userTime;
        if (GetProcessTimes(hProcess, &createTime, &exitTime, &kernelTime, &userTime)) {
            ULARGE_INTEGER ul_user, ul_kernel;
            ul_user.LowPart = userTime.dwLowDateTime;
            ul_user.HighPart = userTime.dwHighDateTime;
            ul_kernel.LowPart = kernelTime.dwLowDateTime;
            ul_kernel.HighPart = kernelTime.dwHighDateTime;

            double userSeconds = ul_user.QuadPart / 10000000.0;
            double kernelSeconds = ul_kernel.QuadPart / 10000000.0;

            Bun::putDirectNamed(vm, resourceUsage, "userCpuSeconds"_s, jsNumber(userSeconds));
            Bun::putDirectNamed(vm, resourceUsage, "kernelCpuSeconds"_s, jsNumber(kernelSeconds));
        } else {
            Bun::putDirectNamed(vm, resourceUsage, "userCpuSeconds"_s, jsNumber(0));
            Bun::putDirectNamed(vm, resourceUsage, "kernelCpuSeconds"_s, jsNumber(0));
        }

        JSObject* pageFaults = constructEmptyObject(globalObject);
        Bun::putDirectNamed(vm, pageFaults, "IORequired"_s, jsNumber(pmc.PageFaultCount));
        Bun::putDirectNamed(vm, pageFaults, "IONotRequired"_s, jsNumber(0));
        Bun::putDirectNamed(vm, resourceUsage, "pageFaults"_s, pageFaults);

        Bun::putDirectNamed(vm, report, "resourceUsage"_s, resourceUsage);
        RETURN_IF_EXCEPTION(scope, {});
    }

    // Shared objects
    {
        JSArray* sharedObjects = constructEmptyArray(globalObject, nullptr);
        RETURN_IF_EXCEPTION(scope, {});

        HMODULE modules[1024];
        DWORD needed;
        if (EnumProcessModules(GetCurrentProcess(), modules, sizeof(modules), &needed)) {
            // EnumProcessModules sets *lpcbNeeded to the TOTAL bytes required for all modules,
            // which can exceed sizeof(modules). Clamp so we never read past the buffer.
            DWORD bytes = std::min(needed, static_cast<DWORD>(sizeof(modules)));
            int count = static_cast<int>(bytes / sizeof(HMODULE));
            for (int i = 0; i < count; i++) {
                WCHAR modName[MAX_PATH];
                DWORD len = GetModuleFileNameExW(GetCurrentProcess(), modules[i], modName, static_cast<DWORD>(std::size(modName)));
                if (len > 0) {
                    sharedObjects->push(globalObject, jsString(vm, String({ reinterpret_cast<const char16_t*>(modName), static_cast<size_t>(len) })));
                    RETURN_IF_EXCEPTION(scope, {});
                }
            }
        }

        Bun::putDirectNamed(vm, report, "sharedObjects"_s, sharedObjects);
        RETURN_IF_EXCEPTION(scope, {});
    }

    // Native stack (empty for now)
    JSArray* nativeStack = constructEmptyArray(globalObject, nullptr);
    RETURN_IF_EXCEPTION(scope, {});
    Bun::putDirectNamed(vm, report, "nativeStack"_s, nativeStack);

    // libuv (empty for now)
    JSArray* libuvArray = constructEmptyArray(globalObject, nullptr);
    RETURN_IF_EXCEPTION(scope, {});
    Bun::putDirectNamed(vm, report, "libuv"_s, libuvArray);

    // Workers (empty for now)
    JSArray* workersArray = constructEmptyArray(globalObject, nullptr);
    RETURN_IF_EXCEPTION(scope, {});
    Bun::putDirectNamed(vm, report, "workers"_s, workersArray);

    // Environment variables
    JSObject* env = globalObject->processEnvObject();
    RETURN_IF_EXCEPTION(scope, {});
    Bun::putDirectNamed(vm, report, "environmentVariables"_s, env);

    return report;
}

} // namespace Bun

#endif // OS(WINDOWS)
