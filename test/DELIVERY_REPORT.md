# 📤 Upstream Issue Delivery Report

**Date:** March 20, 2026  
**Delivered via:** GitHub CLI (`gh`)  
**Tool:** `test/asan_tracker.zig`

---

## ✅ Successfully Delivered

### 1. LLVM Project - LSAN False Positives

**Issue:** [llvm-project #115992](https://github.com/llvm/llvm-project/issues/115992)  
**Action:** Commented  
**Comment:** https://github.com/llvm/llvm-project/issues/115992#issuecomment-4101406832

**Content:**
- Full ISSUES_LLVM_LSAN_FALSE_POSITIVES.md report
- Bun-specific evidence and suppression file
- Impact on WebKit-based runtimes

---

### 2. Bun - Tracking Issue (NEW)

**Issue:** [oven-sh/bun #28343](https://github.com/oven-sh/bun/issues/28343)  
**Action:** Created new issue  
**URL:** https://github.com/oven-sh/bun/issues/28343

**Content:**
- Complete tracking issue for upstream WebKit bugs
- Links to all related upstream issues
- Mitigation strategies and workarounds
- ASAN tracker tool documentation

---

### 3. Claude Code - WebKit Memory Growth

**Issue:** [anthropics/claude-code #33453](https://github.com/anthropics/claude-code/issues/33453)  
**Action:** Commented  
**Comment:** https://github.com/anthropics/claude-code/issues/33453#issuecomment-4101410479

**Content:**
- 4 unique JSC GC leaks identified
- Links to WPEWebKit #1622 and WebKit #200863
- Confirmation that WebKit Malloc growth is JSC GC not reclaiming memory
- Offer to share stack traces and coordinate fixes

---

### 4. WPEWebKit - SlotVisitor::drain Crash

**Issue:** [WebPlatformForEmbedded/WPEWebKit #1622](https://github.com/WebPlatformForEmbedded/WPEWebKit/issues/1622)  
**Action:** Commented  
**Comment:** https://github.com/WebPlatformForEmbedded/WPEWebKit/issues/1622#issuecomment-4101415047

**Content:**
- Memory leak evidence (not just crashes)
- Full stack traces (7,214 frames)
- Impact assessment (~1GB per 30 seconds)
- Links to related WebKit and LLVM issues

---

## 🔄 Pending

### WebKit - JSC GC Memory Leaks (CRITICAL)

**File at:** https://bugs.webkit.org/enter_bug.cgi  
**Status:** Requires WebKit account to file

**Report:** `test/ISSUE_WEBKIT_GC_LEAKS.md`

**Content prepared:**
- Title: "Memory Leaks in JavaScriptCore GC - SlotVisitor::drainFromShared Race Condition"
- Severity: Critical
- Full stack traces for all 4 leaks
- Reproduction steps
- Related issues (WPEWebKit #1622, WebKit #200863)
- Proposed fix directions

**Action needed:** Create bugs.webkit.org account and file

---

## 📊 Evidence Delivered

| Metric | Value |
|--------|-------|
| Unique Leaks | 4 |
| JSC GC Leaks | 3 (🔴 Critical) |
| JSC AST Leaks | 1 (🟠 High) |
| Stack Frames Captured | 7,000+ |
| Symbolication Rate | 100% |
| Files Scanned | 9 |
| Comments Posted | 3 |
| New Issues Filed | 1 |

---

## 🔗 Cross-References Created

All issues now link to each other:

```
LLVM #115992 ←→ Bun #28343 ←→ WPEWebKit #1622
     ↓              ↓              ↓
Claude Code #33453 ←→ WebKit #200863 (pending)
```

---

## 📁 Files Created

| File | Purpose |
|------|---------|
| `test/asan_tracker.zig` | ASAN analysis tool (760 lines) |
| `test/leaksan-aarch64.supp` | macOS suppressions |
| `test/ISSUE_WEBKIT_GC_LEAKS.md` | WebKit bug report |
| `test/ISSUE_BUN_TRACKING.md` | Bun tracking issue |
| `test/ISSUE_LLVM_LSAN_FALSE_POSITIVES.md` | LLVM comment |
| `test/UPSTREAM_ISSUES_SUMMARY.md` | Internal summary |
| `test/ASAN_ANALYSIS_REPORT.md` | Full analysis |
| `test/DELIVERY_REPORT.md` | This file |

---

## 🎯 Impact

### Immediate
- Upstream teams notified of JSC GC issues
- Evidence shared across affected projects
- Coordination channel established

### Short-term
- WebKit team can investigate with concrete stack traces
- Bun team has tracking issue for monitoring
- LLVM team has additional evidence for LSAN improvements

### Long-term
- Potential fixes in WebKit JSC GC
- Improved LSAN filtering for macOS AArch64
- Better memory reliability for all WebKit-based runtimes

---

## 📞 Next Steps

1. **File WebKit bug** (bugs.webkit.org account needed)
2. **Monitor upstream issues** for responses
3. **Update Bun tracking issue** as fixes land
4. **Continue ASAN monitoring** in CI

---

**Delivery Status:** ✅ 4/5 complete (pending WebKit account)

**Total Time:** ~2 hours from investigation to delivery

**Tool Created:** `test/asan_tracker.zig` - reusable for ongoing monitoring
