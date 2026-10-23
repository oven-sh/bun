// scripts/bench-json-rust.sh force-includes this in front of a kernel file that includes root.h.
#pragma once
#define BUN__ROOT__H

#define ASSERT(assertion, ...) ((void)0)
#define ASSERT_NOT_REACHED_WITH_MESSAGE(...) ((void)0)

#if defined(__APPLE__)
#define WTF_OS_DARWIN 1
#elif defined(__linux__)
#define WTF_OS_LINUX 1
#endif
#define OS(WTF_FEATURE) (defined WTF_OS_##WTF_FEATURE && WTF_OS_##WTF_FEATURE)
