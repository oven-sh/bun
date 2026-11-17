Fixes #9089

Stacked on #48544. Supersedes #36647.

### Problem
- A failed `toMatchObject` flags a matcher that passed after the first mismatch. `expect({a: "foobar", b: new Date()}).toMatchObject({a: expect.any(Date), b: expect.any(Date)})` prints `- Expected  - 2`. Jest prints -1/+1.
- `Bun__deepMatch` (`src/jsc/bindings/bindings.cpp:2728`) returns at the first mismatch and never asks the matchers after it.

### Fix
- A failed positive `toMatchObject` runs a second walk (`matchedRowsOfFailedMatch`). A passing call runs the same instructions as before.
- The walk keeps the matchers that the comparison recorded and asks the others once. A scan of the pattern finds them.
- The call still throws the failed match, whatever the walk throws.
- Verified: 38 tests fail on #48544 (33 in `test/js/bun/test/expect.test.js`). 12 other suites pass. Self-reviewed: (this review).

### Background
- A row is a matcher that passed at one key. #48544 prints it for the received property.
- Under a barrier (`Pass::barrier()`) no matcher can wait for a promise. The second walk runs under one, as `this.equals()` does.
- Considered: a comparison that goes on after a mismatch. Each passing call pays 9 instructions per key.

### Downsides
- A failed call costs more instructions: 93,656 to 115,640 (+23.5%) with 9 matchers after the mismatch, +1.3% with none.
- A failed call now asks the matchers after the mismatch, as Jest does. A matcher that keeps state answers the next call otherwise.
- `.not.toMatchObject` that ends at a matcher runs 3 more instructions (2,812 to 2,815), and `toMatchSnapshot(matchers)` 2 more. Release text: +5,632 bytes.

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

| call | #48544 | this PR |
| --- | --- | --- |
| `toMatchObject`, 3 keys, 2 matchers | 3,954 | 3,954 |
| `toMatchObject`, 10 keys, 2 matchers | 6,595 | 6,595 |
| `toMatchObject`, 3 plain keys | 2,349 | 2,349 |
| `toMatchObject`, 10 plain keys | 4,990 | 4,990 |
| `toMatchObject`, 40 plain keys | 17,150 | 17,150 |
| `toMatchObject`, 10 matchers | 8,515 | 8,515 |
| `toMatchObject`, 4 nested objects | 10,540 | 10,540 |
| the whole host call, 3 keys, 2 matchers | 4,633 | 4,633 |
| the whole host call, 10 plain keys | 5,669 | 5,669 |
| `Bun.deepMatch` | 2,258 | 2,258 |
| `toEqual` with `expect.objectContaining` | 4,225 | 4,225 |
| a custom asymmetric matcher, asked by `toEqual` | 1,974 | 1,974 |
| a custom matcher, `expect(x).toBeOdd()` | 2,089 | 2,089 |
| a custom asymmetric matcher, asked inside `this.equals()` | 1,931 | 1,931 |
| an `expect.resolvesTo` matcher, asked by `toEqual` | 291 | 291 |
| `toEqual` with one `expect.resolvesTo` matcher, the whole host call | 1,847 | 1,847 |

Three paths run a few more instructions. The allocator calls of all these calls do not change.
- A comparison that records nothing and ends at a matcher of the pattern that says no: +3. It checks whether it has to record that matcher. `.not.toMatchObject` that passes this way: 2,812 to 2,815 for the whole host call. `toContainEqual(expect.objectContaining(..))` over 8 elements that miss at a matcher: 21,703 to 21,727.
- `toMatchSnapshot(propertyMatchers)` that passes: +2 (3,420 to 3,422), for the branch between the two kinds of rows.
- With a custom equality tester (`expect.addEqualityTesters`), each pair of objects that the comparison enters: +2 (9,114 to 9,118 for two pairs). The compiler keeps one more register over the call of the testers.

These functions have the same instructions as on #48544: `Bun__deepMatch<false>` (564), `matchAsymmetricMatcherAndGetFlags` (766), `matchedRowsFrom` (1,301), `Expect_readFlagsAndProcessPromise` (179), `Pass::once` (109), `execute_custom_matcher` (474) and the Rust body of `toMatchObject` (268). `Bun__deepMatch<true>` has 10 more (891 to 901): the check and the call for the record of a matcher that said no, and 2 around the call of the testers. `JSC__JSValue__jestDeepMatch` has 138 to 137. The Rust side of the deferral (`expect_deferred.rs`) has no change.

**What a failing call pays.** Instructions of the whole `toMatchObject` host call, which includes the message. The last column is the scan and the walk.

| call | #48544 | this PR | change | the second walk |
| --- | --- | --- | --- | --- |
| the values of the issue | 47,409 | 46,207 | -2.5% | 4,844 |
| mismatch first, 9 matchers after it | 93,656 | 115,640 | +23.5% | 13,982 |
| 9 matchers, mismatch last | 111,773 | 122,944 | +10.0% | 11,311 |
| 10 plain keys, no matcher | 73,434 | 74,383 | +1.3% | 949 |
| mismatch first, then 10 nested records, no matcher | 914,177 | 932,901 | +2.0% | 18,336 |
| mismatch first, one matcher and 10 nested records | 925,058 | 949,272 | +2.6% | 21,904 |

Allocator calls per failing host call, for the first four rows: 49 to 36, 45 to 44, 41 to 50, 32 to 33. The first row costs less than before because the diff prints the row of `b` in place of the date.

In wall time (medians, release build, a mismatch at the first key):

| pattern after the mismatch | #48544 | this PR |
| --- | --- | --- |
| no matcher, 10 nested records | 0.056 ms | 0.056 ms |
| no matcher, 1,000 nested records | 5.25 ms | 5.31 ms |
| no matcher, 20,000 nested records | 19.8 ms | 23.2 ms |
| one matcher and 1,000 nested records | 5.26 ms | 5.24 ms |
| one matcher and 20,000 nested records | 19.5 ms | 23.1 ms |
| an array of 200,000 objects, the same array on both sides | 51.9 ms | 62.9 ms |
| a 1 MB `Uint8Array`, the same object on both sides | 46.5 ms | 47.0 ms |
| a 1 MB `Uint8Array`, two objects | 46.4 ms | 46.9 ms |
| 5 attempts of `expect.poll`, a 2 MB `Uint8Array` in the pattern | 410 ms | 413 ms |

Five runs of each build, in turn. The runs of one build differ by up to 0.2 ms in the rows with 1,000 records, 1.2 ms in the rows with 20,000 records, 5.2 ms in the array row, 2.9 ms in the `Uint8Array` rows and 11 ms in the poll row. The scan reads each plain object of the pattern once, so a large pattern costs a failed call about 50 ns for each object.

**Size.** `llvm-size`: text 144,222,262 to 144,227,894 bytes (+5,632). The file grows by 8,192 bytes. New code: the walk that collects (2,243 bytes), the scan (1,692), `matchedRowsOfFailedMatch` (1,134). `Bun__deepMatch<true>` has 3,704 to 3,740 bytes. No new host function. `DeepMatchState` keeps its size.

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
- A test build switched off 24 rules, one at a time: each rule of the scan and of the walk, and the record of the matcher that said no. 23 of them make a test fail. The barrier has none: without it the walk clears the signal that makes a call wait, and the same lines print. The barrier keeps the asks of the walk out of the journal that a call replays after a wait.
- The deepest chain of objects that a failed call prints before a `RangeError`: 5,146 to 4,811 when a matcher follows the mismatch. #48544 has the limit of 4,807 when a matcher comes before the mismatch.
- `test/aot/a-comparison-that-the-build-did-not-follow-hands-out-no-object-of-a-private-field.test.ts` has one case that fails on a debug build of #48544 and of this branch. That is #48169.

</details>
