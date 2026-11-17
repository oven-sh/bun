Fixes #9089

Stacked on #48544. Supersedes #36647.

### Problem
- A failed `toMatchObject` flags a matcher that passed after the first mismatch. `expect({a: "foobar", b: new Date()}).toMatchObject({a: expect.any(Date), b: expect.any(Date)})` prints `- Expected  - 2`. Jest prints -1/+1.
- `Bun__deepMatch` (`src/jsc/bindings/bindings.cpp:WALKER_LINE`) returns at the first mismatch and never asks the matchers after it.

### Fix
- A failed positive `toMatchObject` runs a second walk (`matchedRowsOfFailedMatch`). A passing call runs the same instructions as before.
- The walk keeps the matchers that the comparison recorded and asks the others once. A scan of the pattern finds them.
- The call still throws the failed match, whatever the walk throws.
- Verified: FAIL_TOTAL tests fail on #48544 (FAIL_EXPECT in `test/js/bun/test/expect.test.js`). 12 other suites pass. SELF_REVIEW_LINE

### Background
- A row is a matcher that passed at one key. #48544 prints it for the received property.
- Under a barrier (`Pass::barrier()`) no matcher can wait for a promise. The second walk runs under one, as `this.equals()` does.
- Considered: a comparison that goes on after a mismatch. Each passing call pays 9 instructions per key.

### Downsides
- A failed call costs more instructions: FAIL10_BASE to FAIL10_NEW (FAIL10_PCT) with 9 matchers after the mismatch, PLAIN_PCT with none.
- A failed call now asks the matchers after the mismatch, as Jest does. A matcher that keeps state answers the next call otherwise.
- `.not.toMatchObject` that ends at a matcher runs 3 more instructions (NOT_BASE to NOT_NEW), and `toMatchSnapshot(matchers)` 2 more. Release text: TEXT_DELTA bytes.

<details><summary>Notes</summary>

**Rules of the second walk.**
- A scan of the pattern comes first. It reads plain objects and arrays as they are, with no getter and no Proxy trap, and notes which of them lead to a matcher. For any other kind of object (a class instance, a Proxy, an object with a getter) it says that a matcher can follow. If the pattern leads to no matcher, there is no walk. Most patterns are that. Under `bun test --aot` the engine lists what a compiled object literal holds, so the scan reads those too.
- The walk goes only into what can lead to a matcher. There it looks where the comparison looks: at a key of the pattern it does what the comparison does, and it goes on where the comparison returns false. So it costs at most what the comparison of the two values costs when it passes.
- It keeps a matcher row of the comparison and does not ask that matcher again.
- It does not ask the matcher at which the comparison stopped. The comparison leaves a record of a matcher that said no, and the walk skips that one. A matcher that keeps state would say yes to a second question: with two questions, `expect.stringMatching(/x/g)` at two keys printed a diff with no flagged line.
- It asks a matcher of the pattern only: a built-in matcher or one of `expect.extend()`. A matcher in the received value and an object with `asymmetricMatch()` get no row after the mismatch.
- It reads a property of the received object only to ask a matcher about it, or to go into an object that can lead to a matcher.
- It does not list one object that is on both sides, and it does not look inside two DOM nodes. The comparison does neither.
- Where the comparison kept a row for two objects, the walk goes into the received object that the comparison read. A getter that makes a new object on each read does not run again.
- An equality tester that answers for two objects answers for all that they hold.
- What a getter, a matcher or a tester throws at a key is cleared at that key. The key gets no row and its line stays flagged. The printer of the received value clears what a getter throws in the same way (`tryClearException` in `bindings.cpp`).
- If the stack runs out, the walk ends and the message gets the rows of the comparison alone. A termination is not cleared.
- A matcher that would have to wait for a promise throws under the barrier, so it gets no row: an `expect.resolvesTo` matcher on a pending promise, and an async `expect.extend()` matcher whose promise is pending.

**Where the code is.** `jest_deep_match(.., Some(false))` already means "give me the rows if the comparison fails", and `toMatchObject` is its one caller. `JSC__JSValue__jestDeepMatch` now calls `matchedRowsOfFailedMatch` for those rows. The Rust side of `toMatchObject` has no change. The walk is a second instantiation of the `Bun__deepMatch` template (`DeepMatchWalk::Collects`), so it lists the keys of the pattern with the code of the comparison.

**Designs that lost.**
- A comparison that goes on after a mismatch and records on the way. Each passing call pays for the flag: +9 instructions per key in a prototype.
- A comparison that records nothing and tells where it stopped. The second walk then takes each matcher before the stop as passed. That is an inference. When a getter changed the pattern between the two walks, a prototype showed a matcher that fails as passed.
- A scan that reads the pattern with its getters, once for each nested object. It is not bounded by the received value. A 1 MB typed array that both sides share took 545 ms in place of 50 ms, and a jsdom node in the pattern threw `SecurityError: localStorage is not available for opaque origins` in place of the failed match.
- A walk with no scan. Each failed call then pays for one more comparison, also with no matcher in the pattern: +19% for 1,000 nested records.
- A second entry for the match that prints a diff (`jest_deep_match_for_diff`). The compiler then did not inline the Rust wrapper into `toMatchObject`: +19 instructions for each passing call.
- A walk that asks the matcher at the mismatch again. See the rules.
- A new `Pass` role under which a promise matcher leaves the promise alone. The barrier that exists needs no new role, once an exception costs only its key.
- A walk that lets a getter or a matcher replace the failed match with what it throws, as Jest does. #48544 throws the failed match in these cases, and so does this PR.

**Order of landing.** #48544 first (the printer of rows). These open PRs touch the same code:
- #47802 records a row for a matcher in the received value and for an `asymmetricMatch()` object. The second walk keeps each matcher row of the comparison, so those rows stay. It does not ask those two kinds after the mismatch. One test here fails when those rows come and the walk is not taught to ask for them (`prints a matcher in the received value and an asymmetricMatch() object the same in each key order`).
- #49066 changes `matchAsymmetricMatcher`. The second walk calls it and checks for an exception before it reads the result. The two changes do not depend on each other.
- #46729 overlaps in `JSValue.rs` and `expect.rs`, in other functions.

**What a passing call pays.** A passing `toMatchObject` runs the same instructions as on #48544. Release builds with LTO, the base is the head of #48544. The number is the instructions between the entry and the return of one function, counted by gdb single-step over the same call (median of 3 measured calls).

PASS_TABLE

Three paths run a few more instructions. The allocator calls of all these calls do not change.
- A comparison that records nothing and ends at a matcher of the pattern that says no: +3. It checks whether it has to record that matcher. `.not.toMatchObject` that passes this way: NOT_BASE to NOT_NEW for the whole host call. `toContainEqual(expect.objectContaining(..))` over 8 elements that miss at a matcher: MISS_BASE to MISS_NEW.
- `toMatchSnapshot(propertyMatchers)` that passes: +2 (SNAP_BASE to SNAP_NEW), for the branch between the two kinds of rows.
- With a custom equality tester (`expect.addEqualityTesters`), each pair of objects that the comparison enters: +2 (TESTERS_BASE to TESTERS_NEW for two pairs). The compiler keeps one more register over the call of the testers.

IDENTICAL_LINE

**What a failing call pays.** Instructions of the whole `toMatchObject` host call, which includes the message. The last column is the scan and the walk.

FAIL_TABLE

ALLOC_LINE

In wall time (medians, release build, a mismatch at the first key):

| pattern after the mismatch | #48544 | this PR |
| --- | --- | --- |
WALL_ROWS

**Size.** SIZE_LINES

**A matcher that keeps state.** A failed call now calls the matchers after the mismatch, so a matcher whose answer depends on how often it was asked is asked more often. In a loop that tries a call again (`expect.poll`, `waitFor`), a one-shot `expect.extend()` matcher after the key that is not ready is used up by the first failed attempt. Jest 30 gives the same result in such a loop. `expect.stringMatching` with a `g` flag needs one more attempt.

**Still flagged after this PR.** Each prints the same as on #48544.
- `toEqual`, `toStrictEqual`, `toHaveProperty` and the `toHaveBeenCalledWith` matchers flag a matcher that passed, in every key order. They use `Bun__deepEquals`, which makes no rows.
- A matcher in the received value, and an object with `asymmetricMatch()`, after the mismatch.
- A matcher inside a `Map` or a `Set`, and a matcher in a received `Error`.
- A matcher that has to wait after the mismatch (see the rules).
- Bun prints the received keys that the pattern does not name as `+` lines. Jest leaves them out. For the pair of Jest's own test of this diff, Bun prints -1/+2.

**A diff with no flagged line.** When the printer cannot show the difference (two arrays that differ only in a key that is not an index, two symbols with one description), a failed call prints a diff with no flagged line. Bun 1.4.3 and #48544 print that for a pattern with no matcher, and for a matcher before the mismatch. With this PR a matcher after the mismatch no longer adds a flagged line of its own. This PR does not change what the printer can show.

**A promise after the mismatch.** Under a barrier a promise matcher reads the promise before it finds out that it cannot wait. So the second walk, like `this.equals()` today, marks a pending promise as handled and calls `then()` of a thenable. A settled promise gives the matcher its answer, as before the mismatch. To leave a pending promise alone is a change to the barrier, which this PR does not make.

**A getter of the received value.** The walk reads a received property where the pattern holds a class instance or another object that the scan cannot read. If no matcher is inside, the print reads the property once more. So such a getter runs two times where it ran once.

**Other checks.**
- These suites pass on a debug build: `vitest-flavor.test.ts`, `printing/dom-nodes.test.ts`, `printing/diffexample.test.ts`, `snapshot-tests/bun-snapshots.test.ts`, `snapshot-tests/snapshots/snapshot.test.ts`, `jest-extended.test.js`, `expect-extend.test.js`, `spyMatchers.test.ts`, `mock-fn.test.js`, `bun-object/deep-match.spec.ts`, `test/cli/test/test-aot-deep-equality.test.ts`. The four changed files also pass with `BUN_JSC_validateExceptionChecks=1`.
- On a release build: `test/aot/the-suites-of-the-test-runner-run-compiled.test.ts` passes (each case of the runner's suites ends under `--aot` as it ends without), and so do 89 of the 90 files in `test/aot` that use `toMatchObject`. The other one fails on #48544 too.
- MUTATION_LINE
- The deepest chain of objects that a failed call prints before a `RangeError`: DEPTH_LINE
- `test/aot/a-comparison-that-the-build-did-not-follow-hands-out-no-object-of-a-private-field.test.ts` has one case that fails on a debug build of #48544 and of this branch. That is #48169.

</details>
