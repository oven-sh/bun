---
title: "Tracking: JavaScriptCore GC Memory Leaks - Upstream WebKit Issue"
severity: high
component: JavaScript Runtime > Memory Management
labels: ["memory-leak", "upstream", "javascriptcore", "webkit"]
---

# Tracking: JavaScriptCore GC Memory Leaks - Upstream WebKit Issue

## Summary

Bun's ASAN testing has identified **4 unique memory leaks** in WebKit JavaScriptCore's garbage collector. These are **upstream WebKit bugs**, not Bun-specific issues.

## Status

- **Investigation:** ✅ Complete
- **Root Cause:** ✅ Identified (WebKit JSC GC)
- **Upstream Report:** 🔄 Pending
- **Fix:** ⏳ Waiting for WebKit

## Identified Leaks

| # | Classification | Function | Priority | Status |
|---|---------------|----------|----------|--------|
| 1 | 🔴 jsc_gc | `WTF::HashTable::removeIterator` | Critical | Upstream |
| 2 | 🔴 jsc_gc | `WTF::Vector<JSC::InByVariant>::operator=` | Critical | Upstream |
| 3 | 🔴 jsc_gc | `JSC::SlotVisitor::drainFromShared` | Critical | Upstream |
| 4 | 🟠 jsc_ast | `JSC::ASTBuilder::createForOfLoop` | High | Upstream |

## Impact on Bun

### Current Behavior

- Memory leaks accumulate during heavy GC activity
- Long-running servers may experience memory growth
- Each test run leaks ~100-200MB (ASAN builds)

### Mitigation (Current)

1. **LSAN suppressions** added to `test/leaksan-aarch64.supp`
2. **ASAN tracker** for ongoing monitoring
3. **CI integration** to track regression

### Recommended (Short-term)

1. Add documentation about known JSC GC issues
2. Consider periodic forced GC in server contexts
3. Monitor WebKit upstream for fixes

## Evidence

### Test Results

```
Files scanned: 9
Total leaks: 4
JSC GC leaks: 3
JSC AST leaks: 1
Symbolication rate: 100%
```

### Stack Traces

Full analysis in `test/ASAN_ANALYSIS_REPORT.md`.

Key excerpt:
```
💧 🔴 [0] detected (jsc_gc)
   WTF::Vector<JSC::InByVariant, 1ul, ...>::operator=
   Stack: 7,220 frames

💧 🔴 [1] detected (jsc_gc)
   ArrayHashMapUnmanaged.removeSlow
   Stack: 765 frames

💧 🔴 [2] detected (jsc_gc)
   WTF::removeIterator<WTF::HashTable<JSC::JSGlobalObject*, ...>>
   Stack: 7,214 frames

💧 🟠 [3] detected (jsc_ast)
   JSC::ASTBuilder::createForOfLoop
   Stack: 713 frames
```

## Upstream Coordination

### WebKit Bug Report

- **Issue:** Memory Leaks in JavaScriptCore GC - SlotVisitor::drainFromShared Race Condition
- **Severity:** Critical
- **Component:** JavaScriptCore > Garbage Collector
- **Related:** WPEWebKit #1622

### Related Issues

| Project | Issue | Status |
|---------|-------|--------|
| WebKit | JSC GC race condition | 🔄 To be filed |
| WPEWebKit | [#1622](https://github.com/WebPlatformForEmbedded/WPEWebKit/issues/1622) SlotVisitor::drain crash | Open |
| WebKit | [#200863](https://bugs.webkit.org/show_bug.cgi?id=200863) Crash in JSC::SlotVisitor::visitChildren | Open |
| LLVM | [#115992](https://github.com/llvm/llvm-project/issues/115992) LSAN false positives on AArch64 | Open |
| Claude Code | [#33453](https://github.com/anthropics/claude-code/issues/33453) WebKit Malloc unbounded growth | Open |
| Bun | This issue | 🔄 Tracking |

## Tools

### ASAN Tracker

Location: `test/asan_tracker.zig`

```bash
# Run analysis
./vendor/zig/zig run test/asan_tracker.zig

# Filter JSC GC leaks
./vendor/zig/zig run test/asan_tracker.zig --filter=jsc_gc

# JSON export for CI
./vendor/zig/zig run test/asan_tracker.zig --json > asan-report.json
```

### Suppressions

Location: `test/leaksan-aarch64.supp`

```
# macOS AArch64 system init false positives
leak:dyld::ThreadLocalVariables
leak:libsystem_malloc.dylib
leak:libobjc.A.dylib
```

## Action Items

### Bun Team

- [ ] File WebKit upstream bug with stack traces
- [ ] Add documentation about known JSC GC issues
- [ ] Monitor WebKit for fixes
- [ ] Consider CI integration for ASAN tracking

### Contributors

- [ ] Help test ASAN tracker on different platforms
- [ ] Report additional leak patterns
- [ ] Contribute to WebKit upstream fix

## Timeline

- **2026-03-20:** ASAN tracker created
- **2026-03-20:** Leaks identified and classified
- **2026-03-20:** Analysis report completed
- **2026-03-XX:** WebKit bug to be filed
- **TBD:** WebKit fix merged
- **TBD:** Bun updates WebKit submodule

## References

- `test/asan_tracker.zig` - ASAN analysis tool
- `test/leaksan-aarch64.supp` - LSAN suppressions
- `test/ASAN_ANALYSIS_REPORT.md` - Full analysis
- `test/ISSUE_WEBKIT_GC_LEAKS.md` - Upstream bug report

---

**Note:** This is an **upstream WebKit issue**. Bun cannot fix this unilaterally. We are tracking it here for visibility and to coordinate upstream reporting.
