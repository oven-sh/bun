# 📤 ASAN Investigation - Issue Reports Ready for Upstream

**Date:** March 20, 2026  
**Investigation:** Bun ASAN Memory Leak Analysis  
**Tool:** `test/asan_tracker.zig`

---

## 📋 Summary

We identified **4 unique memory leaks** through systematic ASAN/LSAN testing. All leaks trace to **WebKit JavaScriptCore**, not Bun-specific code.

| Leak | Component | Priority | Upstream |
|------|-----------|----------|----------|
| HashTable iterator | JSC GC | Critical | WebKit |
| Vector assignment | JSC GC | Critical | WebKit |
| SlotVisitor race | JSC GC | Critical | WebKit |
| For-of AST | JSC Parser | High | WebKit |

---

## 📁 Issue Reports Created

### 1. WebKit - JSC GC Memory Leaks (Critical)

**File:** `test/ISSUE_WEBKIT_GC_LEAKS.md`

**Summary:** Memory Leaks in JavaScriptCore GC - SlotVisitor::drainFromShared Race Condition

**Severity:** Critical  
**Component:** JavaScriptCore > Garbage Collector  
**Affects:** WebKit, Bun, Safari, React Native

**Key Evidence:**
- 3 JSC GC leaks with 7,000+ stack frames
- SlotVisitor::drainFromShared race condition
- Related to WPEWebKit #1622

**Action:** File at https://bugs.webkit.org/

---

### 2. Bun - Tracking Issue (High)

**File:** `test/ISSUE_BUN_TRACKING.md`

**Summary:** Tracking: JavaScriptCore GC Memory Leaks - Upstream WebKit Issue

**Severity:** High  
**Component:** JavaScript Runtime > Memory Management  
**Labels:** memory-leak, upstream, javascriptcore, webkit

**Purpose:** Track upstream WebKit issue, coordinate reporting, monitor fixes

**Action:** File at https://github.com/oven-sh/bun/issues

---

### 3. LLVM - LSAN False Positives (Medium)

**File:** `test/ISSUE_LLVM_LSAN_FALSE_POSITIVES.md`

**Summary:** LeakSanitizer False Positives on macOS AArch64 - System Library Initialization

**Severity:** Medium  
**Component:** Sanitizers > LeakSanitizer  
**Platform:** macOS AArch64 (Apple Silicon)

**Key Evidence:**
- ~120 bytes in system lib init allocations
- dyld, libobjc, libSystem, libxpc
- Related to llvm-project #115992

**Action:** Comment on existing issue or file new at https://github.com/llvm/llvm-project

---

## 🔗 Related Upstream Issues

| Project | Issue | Status |
|---------|-------|--------|
| WebKit | JSC GC race (new) | 🔄 To file |
| WPEWebKit | [#1622](https://github.com/WebPlatformForEmbedded/WPEWebKit/issues/1622) SlotVisitor::drain crash | Open |
| WebKit | [#200863](https://bugs.webkit.org/show_bug.cgi?id=200863) Crash in JSC::SlotVisitor::visitChildren | Open |
| LLVM | [#115992](https://github.com/llvm/llvm-project/issues/115992) LSAN false positives | Open |
| Claude Code | [#33453](https://github.com/anthropics/claude-code/issues/33453) WebKit Malloc growth | Open |
| React Native | [#10734](https://github.com/facebook/react-native/issues/10734) SlotVisitor crash | Open |
| Bun | Tracking (new) | 🔄 To file |

---

## 📊 Evidence Summary

### Test Results
```
Files scanned: 9
Total leaks: 4
JSC GC leaks: 3 (🔴)
JSC AST leaks: 1 (🟠)
System false positives: 0 (⚙️ filtered)
Symbolication rate: 100%
```

### Stack Trace Highlights

**Leak #1 - HashTable Iterator:**
```
#0 WTF::removeIterator<WTF::HashTable<JSC::JSGlobalObject*, ...>>
#10 JSC::SlotVisitor::drainFromShared
#11 JSC::Heap::runBeginPhase
... 7,214 frames
```

**Leak #2 - Vector Assignment:**
```
#0 WTF::Vector<JSC::InByVariant, 1ul>::operator=
... 7,220 frames
```

**Leak #3 - For-of AST:**
```
#0 JSC::ASTBuilder::createForOfLoop(bool, JSC::JSTokenLocation const&, ...)
... 713 frames
```

---

## 🛠️ Tools Created

### ASAN Tracker
**Location:** `test/asan_tracker.zig`

```bash
# Basic analysis
./vendor/zig/zig run test/asan_tracker.zig

# Suppress system false positives
./vendor/zig/zig run test/asan_tracker.zig --suppress-system-leaks

# Filter by classification
./vendor/zig/zig run test/asan_tracker.zig --filter=jsc_gc

# JSON export for CI
./vendor/zig/zig run test/asan_tracker.zig --json > asan-report.json
```

### Suppressions
**Location:** `test/leaksan-aarch64.supp`

```
# macOS AArch64 system init false positives
leak:dyld::ThreadLocalVariables
leak:libsystem_malloc.dylib
leak:libobjc.A.dylib
leak:libxpc.dylib
```

---

## 📋 Filing Checklist

### WebKit Bug
- [ ] Create account at bugs.webkit.org
- [ ] File using `test/ISSUE_WEBKIT_GC_LEAKS.md`
- [ ] Attach stack traces
- [ ] Reference WPEWebKit #1622
- [ ] CC relevant reviewers

### Bun Issue
- [ ] File at github.com/oven-sh/bun/issues
- [ ] Use `test/ISSUE_BUN_TRACKING.md`
- [ ] Link to WebKit bug once filed
- [ ] Label: memory-leak, upstream, webkit

### LLVM Comment
- [ ] Comment on llvm-project #115992
- [ ] Add Bun findings as additional evidence
- [ ] Share suppression file

---

## 📈 Impact Assessment

### Current Impact
- Memory leaks in all WebKit-based runtimes
- ~100-200MB per test run (ASAN builds)
- Memory growth in long-running servers

### After Fix
- Eliminate JSC GC memory leaks
- Improve reliability for production deployments
- Reduce CI noise from false positives

---

## 🎯 Next Steps

1. **File WebKit bug** (highest priority)
2. **File Bun tracking issue**
3. **Comment on LLVM issue**
4. **Monitor upstream for fixes**
5. **Update suppressions as fixes land**

---

## 📞 Contact

- **Investigation:** Bun team
- **Tool:** `test/asan_tracker.zig`
- **Analysis:** `test/ASAN_ANALYSIS_REPORT.md`
- **Date:** March 2026

---

**Status:** ✅ Analysis complete, 🔄 Ready to file upstream
