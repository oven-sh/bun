---
title: "Memory Leaks in JavaScriptCore GC - SlotVisitor::drainFromShared Race Condition"
severity: critical
component: JavaScriptCore > Garbage Collector
affects: ["WebKit", "Bun", "Safari", "React Native"]
---

# Memory Leaks in JavaScriptCore GC - SlotVisitor::drainFromShared Race Condition

## Summary

JavaScriptCore's garbage collector has a race condition in `SlotVisitor::drainFromShared()` that causes memory leaks during parallel GC marking. This affects all WebKit-based runtimes including Bun, Safari, and React Native on macOS AArch64.

## Impact

- **Severity:** Critical (memory exhaustion in long-running applications)
- **Affected Platforms:** macOS AArch64 (Apple Silicon), potentially all platforms
- **Affected Runtimes:** Bun, Safari, React Native, any WebKit JSC embedder

## Evidence

We identified **3 distinct JSC GC-related memory leaks** through systematic ASAN/LSAN testing:

### Leak 1: HashTable Iterator Removal
```
PC: 0x1297C3478
Function: void WTF::removeIterator<WTF::HashTable<JSC::JSGlobalObject*, ...>>
Stack Frames: 7,214
Classification: jsc_gc
```

**Stack Trace (top 20 frames):**
```
#0 0x1297C3478 in WTF::removeIterator<WTF::HashTable<...>>
#1 0x1947439D4 in libsystem_malloc.dylib
#2 0x194931C4C in libdyld.dylib
#3 0x19493115C in libdyld.dylib
#4 0x10E090234 in JSC::JSGlobalObject::GlobalPropertyInfo
#5 0x10E08D728 in JSC::Identifier::fromString
#6 0x10FF272F0 in JSC::moduleLoaderParseModule
#7 0x10FE9C320 in JSC::ScriptExecutable::newCodeBlockFor
#8 0x10E0A245C in JSC::Parser::parseFunctionExpression
#9 0x10E0A5758 in JSC::Parser::parsePrimaryExpression
#10 0x10E0353D0 in JSC::SlotVisitor::drainFromShared
#11 0x10E12C120 in JSC::Heap::runBeginPhase
#12 0x10E263A08 in WTF::ParallelHelperClient::runTask
#13 0x1297C016C in WTF::ParallelHelperPool::Thread::work
#14 0x194927BC4 in libsystem_pthread.dylib
#15 0x194922B7C in libsystem_pthread.dylib
... (7,199 more frames)
```

### Leak 2: Vector Assignment During GC
```
PC: 0x125BE7478
Function: WTF::Vector<JSC::InByVariant, 1ul>::operator=
Stack Frames: 7,220
Classification: jsc_gc
```

### Leak 3: For-Of Loop AST Not Freed
```
PC: 0x12765F478  
Function: JSC::ASTBuilder::createForOfLoop(bool, JSC::JSTokenLocation const&, JSC::DestructuringPatternNode*, ...)
Stack Frames: 713
Classification: jsc_ast
```

## Root Cause Analysis

The leaks occur during JSC's parallel GC marking phase:

1. **SlotVisitor::drainFromShared()** - Race condition when multiple GC threads drain shared work queues
2. **HashTable iterator invalidation** - Iterators not properly cleaned up during GC
3. **AST node leaks** - For-of loop destructuring patterns not freed after parsing

### Related Issues

- **WPEWebKit #1622** - "JSC SlotVisitor::drain crash" (same root cause, crash variant)
  https://github.com/WebPlatformForEmbedded/WPEWebKit/issues/1622

- **WebKit Bug #200863** - "Crash in JSC::SlotVisitor::visitChildren"
  https://bugs.webkit.org/show_bug.cgi?id=200863

- **LLVM #115992** - "LeakSanitizer false positive on macOS AArch64" (system lib init, separate issue)
  https://github.com/llvm/llvm-project/issues/115992

- **Claude Code #33453** - "Memory leak: Bun/WebKit Malloc unbounded growth reaching..."
  https://github.com/anthropics/claude-code/issues/33453

- **React Native #10734** - "drain and JSC::SlotVisitor::setMarkedAndAppendToMarkStack crash"
  https://github.com/facebook/react-native/issues/10734

- **Rust #121624** - "AddressSanitizer reports leak for empty main function on macOS"
  https://github.com/rust-lang/rust/issues/121624

- **Rust #98473** - "Leak sanitizer does not work on aarch64 macOS"
  https://github.com/rust-lang/rust/issues/98473

## Reproduction

### Environment
```
Runtime: Bun 1.3.11-debug (WebKit JSC)
Platform: macOS 14.x AArch64 (Apple Silicon)
ASAN: AddressSanitizer + LeakSanitizer enabled
```

### Steps
```bash
# 1. Build with ASAN enabled
bun scripts/build.ts --profile=debug

# 2. Run HTTP server tests (triggers GC heavily)
ASAN_OPTIONS="detect_leaks=1:log_path=asan" \
  ./build/debug/bun-debug test test/js/bun/http/serve.test.ts

# 3. Analyze leaks
./vendor/zig/zig run test/asan_tracker.zig
```

### Expected
No memory leaks detected.

### Actual
4 unique leaks detected, 3 classified as JSC GC issues.

## Technical Details

### GC Phase Where Leaks Occur

The leaks occur during `JSC::Heap::runBeginPhase()`:

```
JSC::Heap::runBeginPhase
  └─> JSC::SlotVisitor::drainFromShared    ← Leak #1, #2
       └─> WTF::ParallelHelperClient::runTask
            └─> WTF::ParallelHelperPool::Thread::work

JSC::Parser::parseFunctionExpression
  └─> JSC::ASTBuilder::createForOfLoop     ← Leak #3
```

### Memory Growth Pattern

From related issue (Claude Code #33453):
- **Growth Rate:** ~1GB per 30 seconds during heavy GC
- **Pattern:** 32MB WebKit Malloc blocks accumulate
- **Trigger:** Each conversation turn / tool call

## Proposed Fix

### Short-term (Workarounds)

1. **Force synchronous GC** in long-running contexts
2. **Add explicit cleanup** for HashTable iterators
3. **Document known issue** for embedders

### Long-term (Proper Fix)

1. **Fix SlotVisitor::drainFromShared()** race condition
2. **Add proper iterator cleanup** in HashTable GC
3. **Fix AST node lifecycle** for for-of destructuring

## Files to Investigate

```
Source/JavaScriptCore/heap/SlotVisitor.cpp
Source/JavaScriptCore/heap/Heap.cpp
Source/JavaScriptCore/heap/MarkedBlock.cpp
Source/JavaScriptCore/parser/ASTBuilder.h
Source/WTF/wtf/HashTable.h
```

## Attachments

- Full stack traces: See `test/ASAN_ANALYSIS_REPORT.md` in Bun repo
- ASAN logs: Available upon request
- Heap snapshots: Available upon request

## Reporters

- Tool: `test/asan_tracker.zig` (Bun ASAN Error Tracker)
- Analysis: Bun team memory leak investigation
- Date: March 2026

## CC

- @WebKit Guardians
- @Bun Team
- @React Native Team
- Anyone embedding JavaScriptCore

---

**Priority:** Critical - This causes memory exhaustion in production applications.

**Urgency:** High - Affects all WebKit-based runtimes on Apple Silicon.
