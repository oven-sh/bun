#include "JavaScriptCore/CallFrame.h"
#include "JavaScriptCore/Identifier.h"
#include "JavaScriptCore/Intrinsic.h"
#include "JavaScriptCore/JITOperations.h"
#include "JavaScriptCore/JSGlobalObject.h"
#include "JavaScriptCore/JSObject.h"
#include "JavaScriptCore/ThrowScope.h"
#include "ZigGlobalObject.h"
#include "root.h"
#include "wtf/Platform.h"
#include "wtf/text/ASCIILiteral.h"
#include "wtf/text/StringView.h"
#include "wtf/text/WTFString.h"
#include <algorithm>
#include <array>
#include <cerrno>
#include <csignal>
#include <cstdlib>
#include <cstring>
#include <expected>
#include <fcntl.h>
#include <format>
#include <functional>
#include <signal.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>
#include <unordered_map>
#include <utility>
#include <variant>
#include "util/functional.hpp"

#if __has_feature(address_sanitizer) || defined(__SANITIZE_ADDRESS__)
#include <sanitizer/asan_interface.h>
#endif

namespace SysSignal {

extern "C" void SysSignal__handler(int sig) noexcept
{
    std::ranges::for_each(std::array { STDOUT_FILENO, STDERR_FILENO }, [](int fd) { fsync(fd); });

    signal(sig, SIG_DFL);
    raise(sig);
}

void Register() noexcept
{
    static constexpr std::array kSignalsToHandle = { SIGABRT, SIGSEGV, SIGILL, SIGFPE };
    std::ranges::for_each(kSignalsToHandle, [](int sig) { signal(sig, SysSignal__handler); });
}

} // namespace SignalHandlers

/// @brief Functions supported to to be called from Fuzzilli. These are
///        Fuzzilli-specific functions.
namespace FuzziliJsApi {

namespace Messages {

/// @brief Force the program to crash in a specific way.
struct ForceCrash {
    enum class Mode : std::uint8_t {
        ImmediateCrash,
        BuiltinTrap,
        DCheckFailure,
        OutOfBoundsWrite,
        UseAfterFree,
        NullPointerDereference,
    };

    Mode m_mode;

    void dispatch()
    {
    }
};

/// @brief Crash the program if Address Sanitizer is not enabled.
struct EnsureAsanEnabled {};

} // namespace messages

/// @brief The variant type representing all possible messages.
using Message = std::variant<Messages::ForceCrash,
    Messages::EnsureAsanEnabled>;

inline void serviceMessage(const Message& message)
{
    std::visit(Util::Functional::Overloaded {
                   [](const Messages::ForceCrash& msg) -> void {
                       switch (msg.m_mode) {
                       case Messages::ForceCrash::Mode::ImmediateCrash:
                           std::abort();
                       case Messages::ForceCrash::Mode::BuiltinTrap:
                           __builtin_trap();
                       case Messages::ForceCrash::Mode::DCheckFailure:
                           assert(false);
                       case Messages::ForceCrash::Mode::OutOfBoundsWrite: {
                           volatile char* p = static_cast<volatile char*>(std::malloc(1));
                           p[-1] = 'A';
                           std::free(const_cast<char*>(p));
                           break;
                       }
                       case Messages::ForceCrash::Mode::UseAfterFree: {
                           volatile char* p = static_cast<volatile char*>(std::malloc(1));
                           std::free(const_cast<char*>(p));
                           p[0] = 'A';
                           break;
                       }
                       case Messages::ForceCrash::Mode::NullPointerDereference: {
                           volatile std::uint64_t* p = nullptr;
                           while (true)
                               p = reinterpret_cast<volatile std::uint64_t*>(*p);
                       }
                       }
                   },
                   [](const Messages::EnsureAsanEnabled&) -> void {
                   } },
        message);
}

std::expected<Message, std::string> parseMessageFromJS(JSC::JSGlobalObject* go, JSC::JSObject* object)
{
    struct MessageParser {
        WTF::ASCIILiteral m_name;
        std::expected<Message, std::string> (*m_parser)(JSC::JSGlobalObject*, JSC::JSObject*, JSC::VM& vm);
    };
    static constexpr std::array messageParsersByType {
        MessageParser {
            "forceCrash"_s,
            [](JSC::JSGlobalObject* go, JSC::JSObject* object, JSC::VM& vm) -> std::expected<Message, std::string> {
                using Mode = Messages::ForceCrash::Mode;
                struct ModeStringEntry {
                    WTF::ASCIILiteral m_string;
                    Mode m_mode;
                };

                static constexpr std::array modeStringEntries {
                    ModeStringEntry { "immediateCrash"_s, Mode::ImmediateCrash },
                    ModeStringEntry { "builtinTrap"_s, Mode::BuiltinTrap },
                    ModeStringEntry { "dcheckFailure"_s, Mode::DCheckFailure },
                    ModeStringEntry { "outOfBoundsWrite"_s, Mode::OutOfBoundsWrite },
                    ModeStringEntry { "useAfterFree"_s, Mode::UseAfterFree },
                    ModeStringEntry { "nullPointerDereference"_s, Mode::NullPointerDereference },
                };

                auto jsMode = object->getIfPropertyExists(
                    go,
                    JSC::Identifier::fromString(vm, "mode"_s));
                if (jsMode.isUndefined() || !jsMode.isString()) {
                    return std::unexpected("Invalid forceCrash message: missing or invalid 'mode' property");
                }

                auto modeIt = std::ranges::find_if(
                    modeStringEntries,
                    [&](const ModeStringEntry& entry) {
                        return jsMode.toWTFString(go) == entry.m_string;
                    });
                if (modeIt == modeStringEntries.end()) {
                    return std::unexpected(std::format("Invalid forceCrash message: unknown mode '{}'", jsMode.toWTFString(go).utf8().toStdString()));
                }

                return Messages::ForceCrash { .m_mode = modeIt->m_mode };
            },
        },
        MessageParser {
            "ensureAsanEnabled"_s,
            [](JSC::JSGlobalObject* go, JSC::JSObject* object, JSC::VM& vm) -> std::expected<Message, std::string> {
                return Messages::EnsureAsanEnabled {};
            },
        },
    };

    JSC::VM& vm = go->vm();
    auto typeStr = object->getIfPropertyExists(go, JSC::Identifier::fromString(vm, "type"_s));
    if (typeStr.isUndefined() || !typeStr.isString()) {
        return std::unexpected("Invalid message: missing or invalid 'type' property");
    }

    for (const auto& parser : messageParsersByType) {
        if (typeStr.toWTFString(go) == parser.m_name) {
            return parser.m_parser(go, object, vm);
        }
    }

    return std::unexpected(std::format("Invalid message: unknown message type '{}'", typeStr.toWTFString(go).utf8().toStdString()));
}

JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES fuzzilli(JSC::JSGlobalObject* go, JSC::CallFrame* cf)
{
    JSC::VM& vm = go->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (cf->argumentCount() != 1) {
        JSC::JSValue error = JSC::jsString(vm, "Invalid argument count provided. Must provide one argument."_s);
        return JSC::JSValue::encode(error);
    }
}

void Register(Zig::GlobalObject* go)
{
    // Install signal handlers to ensure output is flushed before crashes.
    SysSignal::Register();

    go->putDirectNativeFunction(go->vm(), go, JSC::Identifier::fromString(go->vm(), "fuzzilli"_s),
        1, fuzzilli, JSC::ImplementationVisibility::Public,
        JSC::NoIntrinsic,
        JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete);
}

} // namespace FuzziliJsApi

namespace Bun::Fuzzilli {

namespace Coverage {

extern "C" void __sanitizer_cov_trace_pc_guard(uint32_t* guard)
{
}

} // namespace Coverage

} // namespace Bun::Fuzzilli

// ============================================================================
// Coverage instrumentation for Fuzzilli
// Based on workerd implementation
// Only enabled when ASAN is active
// ============================================================================

#if __has_feature(address_sanitizer) || defined(__SANITIZE_ADDRESS__)

#define SHM_SIZE 0x200000
#define MAX_EDGES ((SHM_SIZE - 4) * 8)

struct shmem_data {
    uint32_t num_edges;
    unsigned char edges[];
};

// Global coverage data
static struct shmem_data* __shmem = nullptr;
static uint32_t* __edges_start = nullptr;
static uint32_t* __edges_stop = nullptr;

// Reset edge guards for next iteration
static void __sanitizer_cov_reset_edgeguards()
{
    if (!__edges_start || !__edges_stop)
        return;
    uint64_t N = 0;
    for (uint32_t* x = __edges_start; x < __edges_stop && N < MAX_EDGES; x++) {
        *x = ++N;
    }
}

// Called by the compiler to initialize coverage instrumentation
extern "C" void __sanitizer_cov_trace_pc_guard_init(uint32_t* start, uint32_t* stop)
{
    // Avoid duplicate initialization
    if (start == stop || *start)
        return;

    if (__edges_start != nullptr || __edges_stop != nullptr) {
        fprintf(stderr, "[COV] Coverage instrumentation is only supported for a single module\n");
        _exit(-1);
    }

    __edges_start = start;
    __edges_stop = stop;

    // Map the shared memory region
    const char* shm_key = getenv("SHM_ID");
    if (!shm_key) {
        fprintf(stderr, "[COV] no shared memory bitmap available, using malloc\n");
        __shmem = (struct shmem_data*)malloc(SHM_SIZE);
        if (!__shmem) {
            fprintf(stderr, "[COV] Failed to allocate coverage bitmap\n");
            _exit(-1);
        }
        memset(__shmem, 0, SHM_SIZE);
    } else {
        int fd = shm_open(shm_key, O_RDWR, S_IREAD | S_IWRITE);
        if (fd <= -1) {
            fprintf(stderr, "[COV] Failed to open shared memory region: %s\n", strerror(errno));
            _exit(-1);
        }

        __shmem = (struct shmem_data*)mmap(0, SHM_SIZE, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
        if (__shmem == MAP_FAILED) {
            fprintf(stderr, "[COV] Failed to mmap shared memory region\n");
            _exit(-1);
        }
    }

    __sanitizer_cov_reset_edgeguards();
    __shmem->num_edges = stop - start;
    fprintf(stderr, "[COV] Coverage instrumentation initialized with %u edges\n", __shmem->num_edges);
}

// Called by the compiler for each edge
extern "C" void __sanitizer_cov_trace_pc_guard(uint32_t* guard)
{
    // There's a small race condition here: if this function executes in two threads for the same
    // edge at the same time, the first thread might disable the edge (by setting the guard to zero)
    // before the second thread fetches the guard value (and thus the index). However, our
    // instrumentation ignores the first edge (see libcoverage.c) and so the race is unproblematic.
    if (!__shmem)
        return;
    uint32_t index = *guard;
    // If this function is called before coverage instrumentation is properly initialized we want to return early.
    if (!index)
        return;
    __shmem->edges[index / 8] |= 1 << (index % 8);
    *guard = 0;
}

// Function to reset coverage for next REPRL iteration
// This should be called after each script execution
extern "C" void Bun__REPRL__resetCoverage()
{
    if (__shmem && __edges_start && __edges_stop) {
        __sanitizer_cov_reset_edgeguards();
    }
}

#else

// Stub implementations when ASAN is not enabled
extern "C" void __sanitizer_cov_trace_pc_guard_init(uint32_t* start, uint32_t* stop)
{
    (void)start;
    (void)stop;
}

extern "C" void __sanitizer_cov_trace_pc_guard(uint32_t* guard)
{
    (void)guard;
}

extern "C" void Bun__REPRL__resetCoverage()
{
}

#endif // ASAN

} // extern "C"
