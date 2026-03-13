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

// Helper function to convert time to ISO string
static void toISOString(JSC::VM& vm, double time, char* buffer)
{
    time_t seconds = static_cast<time_t>(time / 1000);
    int milliseconds = static_cast<int>(time) % 1000;
    struct tm* timeinfo = gmtime(&seconds);

    sprintf(buffer, "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ",
        timeinfo->tm_year + 1900,
        timeinfo->tm_mon + 1,
        timeinfo->tm_mday,
        timeinfo->tm_hour,
        timeinfo->tm_min,
        timeinfo->tm_sec,
        milliseconds);
}

JSValue constructReportObjectWindows(VM& vm, Zig::GlobalObject* globalObject, Process* process)
{
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSObject* report = constructEmptyObject(globalObject, globalObject->objectPrototype());
    RETURN_IF_EXCEPTION(scope, {});

    // Header section
    {
        JSObject* header = constructEmptyObject(globalObject, globalObject->objectPrototype());
        RETURN_IF_EXCEPTION(scope, {});

        header->putDirect(vm, Identifier::fromString(vm, "reportVersion"_s), jsNumber(3), 0);
        header->putDirect(vm, Identifier::fromString(vm, "event"_s), jsString(vm, String("JavaScript API"_s)), 0);
        header->putDirect(vm, Identifier::fromString(vm, "trigger"_s), jsString(vm, String("GetReport"_s)), 0);
        header->putDirect(vm, Identifier::fromString(vm, "filename"_s), jsNull(), 0);

        // Timestamps
        double time = WTF::jsCurrentTime();
        header->putDirect(vm, Identifier::fromString(vm, "dumpEventTime"_s), jsString(vm, String::number(static_cast<long long>(time * 1000))), 0);

        char timeBuf[64] = { 0 };
        Bun::toISOString(vm, time, timeBuf);
        header->putDirect(vm, Identifier::fromString(vm, "dumpEventTimeStamp"_s), jsString(vm, String::fromLatin1(timeBuf)), 0);

        // Process info
        header->putDirect(vm, Identifier::fromString(vm, "processId"_s), jsNumber(GetCurrentProcessId()), 0);
        header->putDirect(vm, Identifier::fromString(vm, "threadId"_s), jsNumber(0), 0);

        // Working directory
        char cwd[MAX_PATH];
        if (GetCurrentDirectoryA(MAX_PATH, cwd)) {
            header->putDirect(vm, Identifier::fromString(vm, "cwd"_s), jsString(vm, String::fromUTF8(cwd)), 0);
        }

        // Command line
        header->putDirect(vm, Identifier::fromString(vm, "commandLine"_s), JSValue::decode(Bun__Process__createExecArgv(globalObject)), 0);
        RETURN_IF_EXCEPTION(scope, {});

        // Node version
        header->putDirect(vm, Identifier::fromString(vm, "nodejsVersion"_s), jsString(vm, String::fromLatin1(REPORTED_NODEJS_VERSION)), 0);
        header->putDirect(vm, Identifier::fromString(vm, "wordSize"_s), jsNumber(64), 0);

        // Platform info
#if CPU(X86_64)
        header->putDirect(vm, Identifier::fromString(vm, "arch"_s), jsString(vm, String("x64"_s)), 0);
#elif CPU(ARM64)
        header->putDirect(vm, Identifier::fromString(vm, "arch"_s), jsString(vm, String("arm64"_s)), 0);
#endif
        header->putDirect(vm, Identifier::fromString(vm, "platform"_s), jsString(vm, String("win32"_s)), 0);

        // Component versions - just add the minimum needed
        JSObject* versions = constructEmptyObject(globalObject, globalObject->objectPrototype());
        versions->putDirect(vm, Identifier::fromString(vm, "node"_s), jsString(vm, String(REPORTED_NODEJS_VERSION ""_s)), 0);
        versions->putDirect(vm, Identifier::fromString(vm, "v8"_s), jsString(vm, String("13.6.233.10-node.18"_s)), 0);
        versions->putDirect(vm, Identifier::fromString(vm, "uv"_s), jsString(vm, String::fromLatin1(uv_version_string())), 0);
        versions->putDirect(vm, Identifier::fromString(vm, "modules"_s), jsString(vm, String("137"_s)), 0);
        header->putDirect(vm, Identifier::fromString(vm, "componentVersions"_s), versions, 0);
        RETURN_IF_EXCEPTION(scope, {});

        // Release info
        JSObject* release = constructEmptyObject(globalObject, globalObject->objectPrototype());
        RETURN_IF_EXCEPTION(scope, {});
        release->putDirect(vm, Identifier::fromString(vm, "name"_s), jsString(vm, String("node"_s)), 0);
        release->putDirect(vm, Identifier::fromString(vm, "sourceUrl"_s), jsString(vm, String("https://nodejs.org/download/release/v" REPORTED_NODEJS_VERSION "/node-v" REPORTED_NODEJS_VERSION ".tar.gz"_s)), 0);
        release->putDirect(vm, Identifier::fromString(vm, "headersUrl"_s), jsString(vm, String("https://nodejs.org/download/release/v" REPORTED_NODEJS_VERSION "/node-v" REPORTED_NODEJS_VERSION "-headers.tar.gz"_s)), 0);
#if CPU(X86_64)
        release->putDirect(vm, Identifier::fromString(vm, "libUrl"_s), jsString(vm, String("https://nodejs.org/download/release/v" REPORTED_NODEJS_VERSION "/win-x64/node.lib"_s)), 0);
#elif CPU(ARM64)
        release->putDirect(vm, Identifier::fromString(vm, "libUrl"_s), jsString(vm, String("https://nodejs.org/download/release/v" REPORTED_NODEJS_VERSION "/win-arm64/node.lib"_s)), 0);
#endif
        header->putDirect(vm, Identifier::fromString(vm, "release"_s), release, 0);

        // OS info
        header->putDirect(vm, Identifier::fromString(vm, "osName"_s), jsString(vm, String("Windows_NT"_s)), 0);

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
            header->putDirect(vm, Identifier::fromString(vm, "osRelease"_s), jsString(vm, String("10.0"_s)), 0);
        } else {
            header->putDirect(vm, Identifier::fromString(vm, "osRelease"_s), jsString(vm, String("6.1"_s)), 0);
        }

        header->putDirect(vm, Identifier::fromString(vm, "osVersion"_s), jsString(vm, String("Windows"_s)), 0);

        // Host name
        char hostname[256];
        DWORD size = sizeof(hostname);
        if (GetComputerNameA(hostname, &size)) {
            header->putDirect(vm, Identifier::fromString(vm, "host"_s), jsString(vm, String::fromUTF8(hostname)), 0);
        }

        // CPU info using libuv
        uv_cpu_info_t* cpu_infos;
        int count;
        if (uv_cpu_info(&cpu_infos, &count) == 0) {
            JSArray* cpuArray = constructEmptyArray(globalObject, nullptr, count);
            RETURN_IF_EXCEPTION(scope, {});

            for (int i = 0; i < count; i++) {
                JSObject* cpu = constructEmptyObject(globalObject);
                cpu->putDirect(vm, Identifier::fromString(vm, "model"_s), jsString(vm, String::fromUTF8(cpu_infos[i].model)), 0);
                cpu->putDirect(vm, Identifier::fromString(vm, "speed"_s), jsNumber(cpu_infos[i].speed), 0);
                cpu->putDirect(vm, Identifier::fromString(vm, "user"_s), jsNumber(cpu_infos[i].cpu_times.user), 0);
                cpu->putDirect(vm, Identifier::fromString(vm, "nice"_s), jsNumber(cpu_infos[i].cpu_times.nice), 0);
                cpu->putDirect(vm, Identifier::fromString(vm, "sys"_s), jsNumber(cpu_infos[i].cpu_times.sys), 0);
                cpu->putDirect(vm, Identifier::fromString(vm, "idle"_s), jsNumber(cpu_infos[i].cpu_times.idle), 0);
                cpu->putDirect(vm, Identifier::fromString(vm, "irq"_s), jsNumber(cpu_infos[i].cpu_times.irq), 0);
                cpuArray->putDirectIndex(globalObject, i, cpu);
            }
            header->putDirect(vm, Identifier::fromString(vm, "cpus"_s), cpuArray, 0);
            uv_free_cpu_info(cpu_infos, count);
        } else {
            header->putDirect(vm, Identifier::fromString(vm, "cpus"_s), constructEmptyArray(globalObject, nullptr), 0);
        }
        RETURN_IF_EXCEPTION(scope, {});

        // Network interfaces using libuv
        uv_interface_address_t* interfaces;
        if (uv_interface_addresses(&interfaces, &count) == 0) {
            JSArray* interfacesArray = constructEmptyArray(globalObject, nullptr, count);
            RETURN_IF_EXCEPTION(scope, {});

            for (int i = 0; i < count; i++) {
                JSObject* iface = constructEmptyObject(globalObject);
                iface->putDirect(vm, Identifier::fromString(vm, "name"_s), jsString(vm, String::fromUTF8(interfaces[i].name)), 0);
                iface->putDirect(vm, Identifier::fromString(vm, "internal"_s), jsBoolean(interfaces[i].is_internal), 0);

                char addr[INET6_ADDRSTRLEN];
                if (interfaces[i].address.address4.sin_family == AF_INET) {
                    uv_inet_ntop(AF_INET, &interfaces[i].address.address4.sin_addr, addr, sizeof(addr));
                    iface->putDirect(vm, Identifier::fromString(vm, "address"_s), jsString(vm, String::fromUTF8(addr)), 0);

                    char netmask[INET_ADDRSTRLEN];
                    uv_inet_ntop(AF_INET, &interfaces[i].netmask.netmask4.sin_addr, netmask, sizeof(netmask));
                    iface->putDirect(vm, Identifier::fromString(vm, "netmask"_s), jsString(vm, String::fromUTF8(netmask)), 0);

                    iface->putDirect(vm, Identifier::fromString(vm, "family"_s), jsString(vm, String::fromLatin1("IPv4")), 0);
                } else if (interfaces[i].address.address6.sin6_family == AF_INET6) {
                    uv_inet_ntop(AF_INET6, &interfaces[i].address.address6.sin6_addr, addr, sizeof(addr));
                    iface->putDirect(vm, Identifier::fromString(vm, "address"_s), jsString(vm, String::fromUTF8(addr)), 0);

                    char netmask[INET6_ADDRSTRLEN];
                    uv_inet_ntop(AF_INET6, &interfaces[i].netmask.netmask6.sin6_addr, netmask, sizeof(netmask));
                    iface->putDirect(vm, Identifier::fromString(vm, "netmask"_s), jsString(vm, String::fromUTF8(netmask)), 0);

                    iface->putDirect(vm, Identifier::fromString(vm, "family"_s), jsString(vm, String::fromLatin1("IPv6")), 0);
                    iface->putDirect(vm, Identifier::fromString(vm, "scopeid"_s), jsNumber(interfaces[i].address.address6.sin6_scope_id), 0);
                }

                // MAC address
                char mac[18];
                snprintf(mac, sizeof(mac), "%02x:%02x:%02x:%02x:%02x:%02x",
                    static_cast<unsigned char>(interfaces[i].phys_addr[0]),
                    static_cast<unsigned char>(interfaces[i].phys_addr[1]),
                    static_cast<unsigned char>(interfaces[i].phys_addr[2]),
                    static_cast<unsigned char>(interfaces[i].phys_addr[3]),
                    static_cast<unsigned char>(interfaces[i].phys_addr[4]),
                    static_cast<unsigned char>(interfaces[i].phys_addr[5]));
                iface->putDirect(vm, Identifier::fromString(vm, "mac"_s), jsString(vm, String::fromUTF8(mac)), 0);

                interfacesArray->putDirectIndex(globalObject, i, iface);
            }
            header->putDirect(vm, Identifier::fromString(vm, "networkInterfaces"_s), interfacesArray, 0);
            uv_free_interface_addresses(interfaces, count);
        } else {
            header->putDirect(vm, Identifier::fromString(vm, "networkInterfaces"_s), constructEmptyArray(globalObject, nullptr), 0);
        }

        report->putDirect(vm, Identifier::fromString(vm, "header"_s), header, 0);
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

        WTF::String stack;
        size_t firstLine = stackProperty.find('\n');
        if (firstLine != WTF::notFound) {
            stack = stackProperty.substring(firstLine + 1);
        }

        JSArray* stackArray = constructEmptyArray(globalObject, nullptr);
        RETURN_IF_EXCEPTION(scope, {});

        stack.split('\n', [&](const WTF::StringView& line) {
            stackArray->push(globalObject, jsString(vm, line.toString().trim(isASCIIWhitespace)));
        });
        RETURN_IF_EXCEPTION(scope, {});

        javascriptStack->putDirect(vm, vm.propertyNames->stack, stackArray, 0);

        JSObject* errorProperties = constructEmptyObject(globalObject, globalObject->objectPrototype());
        RETURN_IF_EXCEPTION(scope, {});
        errorProperties->putDirect(vm, Identifier::fromString(vm, "code"_s), jsString(vm, String("ERR_SYNTHETIC"_s)), 0);
        javascriptStack->putDirect(vm, Identifier::fromString(vm, "errorProperties"_s), errorProperties, 0);

        report->putDirect(vm, Identifier::fromString(vm, "javascriptStack"_s), javascriptStack, 0);
        RETURN_IF_EXCEPTION(scope, {});
    }

    // JavaScript heap
    {
        JSObject* heap = constructEmptyObject(globalObject, globalObject->objectPrototype());
        RETURN_IF_EXCEPTION(scope, {});

        JSObject* heapSpaces = constructEmptyObject(globalObject);
        heapSpaces->putDirect(vm, Identifier::fromString(vm, "read_only_space"_s), constructEmptyObject(globalObject), 0);
        heapSpaces->putDirect(vm, Identifier::fromString(vm, "new_space"_s), constructEmptyObject(globalObject), 0);
        heapSpaces->putDirect(vm, Identifier::fromString(vm, "old_space"_s), constructEmptyObject(globalObject), 0);
        heapSpaces->putDirect(vm, Identifier::fromString(vm, "code_space"_s), constructEmptyObject(globalObject), 0);
        heapSpaces->putDirect(vm, Identifier::fromString(vm, "shared_space"_s), constructEmptyObject(globalObject), 0);
        heapSpaces->putDirect(vm, Identifier::fromString(vm, "trusted_space"_s), constructEmptyObject(globalObject), 0);
        heapSpaces->putDirect(vm, Identifier::fromString(vm, "new_large_object_space"_s), constructEmptyObject(globalObject), 0);
        heapSpaces->putDirect(vm, Identifier::fromString(vm, "large_object_space"_s), constructEmptyObject(globalObject), 0);
        heapSpaces->putDirect(vm, Identifier::fromString(vm, "code_large_object_space"_s), constructEmptyObject(globalObject), 0);
        heapSpaces->putDirect(vm, Identifier::fromString(vm, "shared_large_object_space"_s), constructEmptyObject(globalObject), 0);
        heapSpaces->putDirect(vm, Identifier::fromString(vm, "trusted_large_object_space"_s), constructEmptyObject(globalObject), 0);

        heap->putDirect(vm, Identifier::fromString(vm, "totalMemory"_s), jsNumber(WTF::ramSize()), 0);
        heap->putDirect(vm, Identifier::fromString(vm, "usedMemory"_s), jsNumber(vm.heap.size()), 0);
        heap->putDirect(vm, Identifier::fromString(vm, "memoryLimit"_s), jsNumber(WTF::ramSize()), 0);
        heap->putDirect(vm, Identifier::fromString(vm, "heapSpaces"_s), heapSpaces, 0);

        report->putDirect(vm, Identifier::fromString(vm, "javascriptHeap"_s), heap, 0);
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
            resourceUsage->putDirect(vm, Identifier::fromString(vm, "rss"_s), jsNumber(pmc.WorkingSetSize), 0);
            resourceUsage->putDirect(vm, Identifier::fromString(vm, "maxRss"_s), jsNumber(pmc.PeakWorkingSetSize), 0);
        } else {
            resourceUsage->putDirect(vm, Identifier::fromString(vm, "rss"_s), jsNumber(0), 0);
            resourceUsage->putDirect(vm, Identifier::fromString(vm, "maxRss"_s), jsNumber(0), 0);
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

            resourceUsage->putDirect(vm, Identifier::fromString(vm, "userCpuSeconds"_s), jsNumber(userSeconds), 0);
            resourceUsage->putDirect(vm, Identifier::fromString(vm, "kernelCpuSeconds"_s), jsNumber(kernelSeconds), 0);
        } else {
            resourceUsage->putDirect(vm, Identifier::fromString(vm, "userCpuSeconds"_s), jsNumber(0), 0);
            resourceUsage->putDirect(vm, Identifier::fromString(vm, "kernelCpuSeconds"_s), jsNumber(0), 0);
        }

        JSObject* pageFaults = constructEmptyObject(globalObject);
        pageFaults->putDirect(vm, Identifier::fromString(vm, "IORequired"_s), jsNumber(pmc.PageFaultCount), 0);
        pageFaults->putDirect(vm, Identifier::fromString(vm, "IONotRequired"_s), jsNumber(0), 0);
        resourceUsage->putDirect(vm, Identifier::fromString(vm, "pageFaults"_s), pageFaults, 0);

        report->putDirect(vm, Identifier::fromString(vm, "resourceUsage"_s), resourceUsage, 0);
        RETURN_IF_EXCEPTION(scope, {});
    }

    // Shared objects
    {
        JSArray* sharedObjects = constructEmptyArray(globalObject, nullptr);
        RETURN_IF_EXCEPTION(scope, {});

        HMODULE modules[1024];
        DWORD needed;
        if (EnumProcessModules(GetCurrentProcess(), modules, sizeof(modules), &needed)) {
            int count = needed / sizeof(HMODULE);
            for (int i = 0; i < count; i++) {
                char modName[MAX_PATH];
                if (GetModuleFileNameExA(GetCurrentProcess(), modules[i], modName, sizeof(modName))) {
                    sharedObjects->push(globalObject, jsString(vm, String::fromUTF8(modName)));
                }
            }
        }

        report->putDirect(vm, Identifier::fromString(vm, "sharedObjects"_s), sharedObjects, 0);
        RETURN_IF_EXCEPTION(scope, {});
    }

    // Native stack (empty for now)
    report->putDirect(vm, Identifier::fromString(vm, "nativeStack"_s), constructEmptyArray(globalObject, nullptr), 0);

    // libuv (empty for now)
    report->putDirect(vm, Identifier::fromString(vm, "libuv"_s), constructEmptyArray(globalObject, nullptr), 0);

    // Workers (empty for now)
    report->putDirect(vm, Identifier::fromString(vm, "workers"_s), constructEmptyArray(globalObject, nullptr), 0);

    // Environment variables
    report->putDirect(vm, Identifier::fromString(vm, "environmentVariables"_s), globalObject->processEnvObject(), 0);

    return report;
}

} // namespace Bun

#endif // OS(WINDOWS)
