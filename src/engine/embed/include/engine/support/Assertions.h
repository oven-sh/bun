#pragma once

#include "engine/support/Platform.h"

#include <span>

// Each call stays apart from the others and keeps its frame, so that a crash report names the line.
#define NO_RETURN_DUE_TO_CRASH __attribute__((noreturn, cold, nomerge, not_tail_called))

extern "C" {
NO_RETURN_DUE_TO_CRASH void WTFCrash();
void WTFReportAssertionFailureWithMessage(const char* file, int line, const char* function, const char* assertion, const char* format, ...) __attribute__((cold, format(printf, 5, 6)));
void WTFReportBacktrace() __attribute__((cold));
}
void WTFPrintBacktrace(std::span<void* const> stack);

namespace WTF::Detail {
// `assertion` is null for code that should not have been reached.
NO_RETURN_DUE_TO_CRASH void failAssertion(const char* file, int line, const char* function, const char* assertion);
constexpr void ignoreArguments(const auto&...) {}
}

#define CRASH() WTFCrash()

#if OS(WINDOWS)
#undef ASSERT
#endif

#if ASSERT_ENABLED

#define RELEASE_ASSERT(assertion, ...)                                                       \
    do {                                                                                     \
        if (!(assertion)) [[unlikely]] {                                                     \
            WTF::Detail::ignoreArguments(__VA_ARGS__);                                       \
            WTF::Detail::failAssertion(__FILE__, __LINE__, __PRETTY_FUNCTION__, #assertion); \
        }                                                                                    \
    } while (0)

#define RELEASE_ASSERT_NOT_REACHED(...)                                               \
    do {                                                                              \
        WTF::Detail::ignoreArguments(__VA_ARGS__);                                    \
        WTF::Detail::failAssertion(__FILE__, __LINE__, __PRETTY_FUNCTION__, nullptr); \
    } while (0)

#define RELEASE_ASSERT_WITH_MESSAGE(assertion, ...)                                                                 \
    do {                                                                                                            \
        if (!(assertion)) [[unlikely]] {                                                                            \
            WTFReportAssertionFailureWithMessage(__FILE__, __LINE__, __PRETTY_FUNCTION__, #assertion, __VA_ARGS__); \
            WTFReportBacktrace();                                                                                   \
            CRASH();                                                                                                \
        }                                                                                                           \
    } while (0)

#define ASSERT(...) RELEASE_ASSERT(__VA_ARGS__)
#define ASSERT_NOT_REACHED(...) RELEASE_ASSERT_NOT_REACHED(__VA_ARGS__)
#define ASSERT_UNUSED(variable, ...) RELEASE_ASSERT(__VA_ARGS__)
#define ASSERT_WITH_MESSAGE(...) RELEASE_ASSERT_WITH_MESSAGE(__VA_ARGS__)

#else

#define RELEASE_ASSERT(assertion, ...)                 \
    do {                                               \
        if (!(assertion)) [[unlikely]] {               \
            WTF::Detail::ignoreArguments(__VA_ARGS__); \
            CRASH();                                   \
        }                                              \
    } while (0)

#define RELEASE_ASSERT_NOT_REACHED(...)            \
    do {                                           \
        WTF::Detail::ignoreArguments(__VA_ARGS__); \
        CRASH();                                   \
    } while (0)

#define RELEASE_ASSERT_WITH_MESSAGE(assertion, ...) RELEASE_ASSERT(assertion)

#define ASSERT(...) ((void)0)
#define ASSERT_NOT_REACHED(...) ((void)0)
#define ASSERT_UNUSED(variable, ...) ((void)variable)
#define ASSERT_WITH_MESSAGE(...) ((void)0)

#endif

#define ASSERT_NOT_REACHED_WITH_MESSAGE(...) ASSERT_WITH_MESSAGE(false, __VA_ARGS__)
#define RELEASE_ASSERT_NOT_REACHED_WITH_MESSAGE(...) RELEASE_ASSERT_WITH_MESSAGE(false, __VA_ARGS__)

#if ENABLE(SECURITY_ASSERTIONS)
#define ASSERT_WITH_SECURITY_IMPLICATION(assertion) RELEASE_ASSERT(assertion)
#else
#define ASSERT_WITH_SECURITY_IMPLICATION(assertion) ((void)0)
#endif
