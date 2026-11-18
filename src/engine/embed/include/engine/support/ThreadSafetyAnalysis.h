#pragma once

// https://clang.llvm.org/docs/ThreadSafetyAnalysis.html

#define WTF_CAPABILITY_LOCK __attribute__((capability("lock")))
#define WTF_CAPABILITY_SCOPED_LOCK __attribute__((scoped_lockable))
#define WTF_ACQUIRES_LOCK(...) __attribute__((acquire_capability(__VA_ARGS__)))
#define WTF_ACQUIRES_LOCK_IF(...) __attribute__((try_acquire_capability(__VA_ARGS__)))
#define WTF_RELEASES_LOCK(...) __attribute__((release_capability(__VA_ARGS__)))
#define WTF_REQUIRES_LOCK(...) __attribute__((requires_capability(__VA_ARGS__)))
#define WTF_RETURNS_LOCK(lock) __attribute__((lock_returned(lock)))
#define WTF_GUARDED_BY_LOCK(lock) __attribute__((guarded_by(lock)))
#define WTF_IGNORES_THREAD_SAFETY_ANALYSIS __attribute__((no_thread_safety_analysis))
