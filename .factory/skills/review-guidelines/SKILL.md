# Bun fork UB review guidelines

Review with an adversarial correctness mindset. The goal is to find real
undefined behavior, portability breaks, missing tests, claim errors, and
merge blockers.

Avoid style-only comments unless they hide a correctness issue.

## Core posture

For every PR, ask:

- What invariant changed?
- Where can safe JS trigger native unsafety?
- What happens if getters, callbacks, or user code run between capture and use?
- Does this snapshot the active view region or the whole backing store?
- Does a worker receive a live pointer/length into JS-backed memory?
- Does the test fail on unpatched main and pass after the patch?
- Is the PR the smallest complete fix?
- Does the PR body say only what the evidence proves?

## UB and native-boundary checks

Prioritize:

- stale pointer/length after ArrayBuffer resize, detach, transfer, or GC
- async worker handoff of JS-backed memory
- JavaScriptCore protect/unprotect lifetime errors
- Rust/Zig/C++ FFI layout, aliasing, ownership, and mutability mistakes
- allocator ownership mismatch
- use-after-free, double free, double unprotect, leaked protected JS values
- integer truncation, signed/unsigned conversion, overflow
- offset/length view bugs, especially copying a whole backing store instead of
  the submitted typed-array/DataView region

## Tests

Prefer tests that:

- fail on unpatched main
- pass on the patched branch
- prove the actual regression
- use public APIs
- avoid timing flakes
- avoid network/global filesystem dependencies
- are cheap enough for normal CI unless explicitly marked stress/ASAN-only

Flag tests that:

- pass on both old and new code
- silently skip because a tool is missing
- assert irrelevant stderr emptiness
- prove implementation details rather than public behavior
- use a race window without explaining why it is deterministic enough

## PR shape

Prefer:

- one issue
- one reason to exist
- one commit
- targeted tests
- tight body
- no unrelated cleanup
- no broad refactor
- no speculative claims

If a finding would broaden the PR, say whether it should block this PR or be
parked as a follow-up.

## Claim discipline

Every PR claim must be backed by source route, test proof, ASAN proof, or
documented API behavior.

Flag:

- "fixes UB" claims when only a behavioral mismatch is proven
- "matches Node" claims without checking Node behavior
- "safe" claims that ignore sibling paths
- "all async users" claims when only one public API is tested
- "freed pointer" claims where the exact state is only stale pointer/length

Use precise language:
- "stale pointer/length"
- "active view region"
- "submitted bytes"
- "post-getter input"
- "red proof"
- "green proof"

## Operating rule

The swarm does not decide truth. It produces candidate objections. For every
finding the human loop still asks: is it real, does it reproduce, does it fail
on unpatched main, does the patch fix it, is the test proving the real bug, is
the fix at the right boundary, is there a smaller complete fix, and what can be
truthfully said upstream.
