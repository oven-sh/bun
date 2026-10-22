Fixes #23877, fixes #28760

### Problem
- `assert.deepEqual('+00000000', false)` throws `AssertionError: Expected values to be loosely deep-equal`. On Node it passes.
- `isDeepEqual` (`src/js/node/assert.ts:52`) calls `Bun.deepEquals(a, b, false)`, the relation of `expect().toEqual()`.
- `assert.deepStrictEqual` accepts `new Set([{a:1},{a:1},{a:2}])` against `new Set([{a:1},{a:2},{a:2}])`.

### Fix
- `isDeepEqual` runs a new instantiation of the native comparator: the `deepStrictEqual` rules without the prototype rule and symbol keys, and `==` for non-objects.
- One port of Node's `setEquiv`, `mapEquiv` and Error rule serves all three Node relations.
- Verified: `test/js/node/assert/deep-equal.test.ts`, which asks a local Node v26.3.0 for every row. Upstream `test-assert-deep.js` is added.
- Self-reviewed: 56 concerns raised, 54 addressed. Rejected: the dispatch change of draft #45457, and new reports to nodejs/node.

### Background
- `Bun__deepEquals` is one C++ template, one instantiation per relation. Jarred asked for a native NodeDeepEquals on #34660. This PR supersedes #33068 and the #35393 part of draft #35391. It conflicts with #44833 in four small regions.
- Bun has non-enumerable `Symbol.toStringTag` values that Node lacks (#42558, #41389). So a non-enumerable tag against no tag is not compared, unlike Node.
- Node's matcher has accidents, such as `compareSmallSets`. This PR reproduces three and declines five (table in Notes). Is that the right split?

### Downsides
- Breaking, as #34660 was in 1.4 (#28792): of 330 matrix rows, 62 newly fail `deepEqual`, 62 `notDeepEqual`, 7 `deepStrictEqual`, 11 `notDeepStrictEqual`.
- An object with an `undefined` key that Node omits now fails: `assert.deepEqual(new net.Socket().address(), {})`.
- COST_LINE

<details><summary>Notes</summary>

**How it was found.** #23877 reports the `==` case and #28760 the Set case. A differential check against Node found the rest, first the symbol keys: `assert.deepEqual({ [s]: 1 }, { [s]: 2 })` throws on Bun and passes on Node. Objects from logform and winston, TypeBox and bson 5 have own symbol keys.

**What the loose relation is.** Node defines loose mode as strict mode with a few branches (`lib/internal/util/comparisons.js`, the lines that read `kLoose`). The new instantiation, `Bun__deepEquals<false, false, true, true>` behind `Bun__deepEqualsNodeLoose`, keeps the Node rules that the comparator already has behind `checkPrototypes` and changes only those branches:

- no constructor or prototype rule
- symbol keys are skipped in all five key walks
- non-objects, and functions, compare with `==`
- `Float16Array`, `Float32Array` and `Float64Array` compare by value
- a primitive Set member or Map key can pair with one that it equals under `==`
- an expected `null` array element takes every element, and from the first hole of the expected array Node's `sparseArrayEquiv` applies

**What changes for `deepStrictEqual` and `util.isDeepStrictEqual`.** Node applies these rules in every mode, so they are on the `checkPrototypes` gate. The same two relations are behind `assert.notDeepStrictEqual`, `assert.strict`, the validation object of `assert.throws` and `assert.rejects`, `new assert.Assert({ skipPrototype: true })`, `util.isDeepStrictEqual(a, b, true)` and `t.assert` of `node:test`.

- Set and Map members pair off one to one. `NodeCollections` ports `setEquiv`, `mapEquiv`, `setObjectEquiv`, `mapObjectEquiv` and `compareSmallSets` once, for all three relations. On main a Set or a Map that holds itself throws a `RangeError`, and a leaf under 10 nested Maps is read 2,048 times (2 here). The Maps of #34830 compare equal under these relations (`expect().toEqual()` is not touched).
- An Error compares `message`, `name`, `cause` and `errors` with `[[Get]]`, unless the expected Error lists the key as own and enumerable. Then the own keys compare as for any object. `AggregateError.errors` is covered. `Error.prepareStackTrace` no longer runs during a comparison (on main it runs once for each Error).
- A function is not an object: `assert.deepStrictEqual(Map, Set)` throws.
- A Proxy value is read through its `get` trap.
- A RegExp compares `source`, `flags` and `lastIndex` (with `===`). `new RegExp('^/api/')` now equals `/^\/api\//`, and a RegExp equals its `new RegExp(re.source, re.flags)` copy.
- A boxed String compares the string it wraps.
- A URL equals another URL with the same `href`, or an object that passes Node's `isURL` with the same `href`.

`Bun.deepEquals` and `expect()` keep their verdicts. The shared function `specialObjectsDequalSlow` reads the mode at run time, and a test pins the three rules that it keeps apart.

**Node's accidents.** The port meets eight behaviours of Node v26.3.0 that look like accidents. nodejs/node has no issue or pull request that names `compareSmallSets`.

| Node v26.3.0 | This PR |
|---|---|
| Loose: an expected `null` array element takes every element, until the expected array has a hole (nodejs/node#61587). `assert.deepEqual([5], [null])` passes. | Reproduced. 0 of 406,900 pairs of small arrays differ from Node (main: 12,148). |
| `compareSmallSets`, for a Set of fewer than three members, compares a member with `undefined` past the end of the expected Set. With `o = { a: 1 }`, `new Set([o, { a: 1 }])` is not equal to its copy, and `new Set([o, undefined])` equals `new Set([o, { a: 1 }])`, in every mode. | Reproduced. Main answers the opposite for both pairs. |
| Loose: Set members and Map keys pair off with the first member that fits under `==`, so a verdict can depend on the insertion order. | Reproduced. 17 rows carry a loose verdict for each argument order. |
| A `null` Set member or Map key opposite an object throws a `TypeError`. | Declined: not equal, as Node answers since nodejs/node#64441 and nodejs/node#64449. |
| Strict: a Map compares an object key with the same key again, and a Promise, a WeakMap or a WeakSet is not equal to itself there. | Declined: the same key is equal, as on main. |
| After the first comparison of a cycle, the process uses a second comparator, and some later verdicts change (nodejs/node#62422). | Declined: Bun gives the verdict of a new process. |
| Loose: a Map compares the two values under one primitive key three times at each nesting level. A leaf under 10 Maps is read 118,098 times. | Declined: each pair compares once. A value that reads differently the second time can get another verdict. |
| A Map pairs off every object key by comparison, so two Maps that share their key objects in another order take quadratic time. | Declined: a key that both Maps hold is settled by a lookup, as on main. In loose mode the verdict differs from Node when a third key is loosely equal to the shared one and `==` is not transitive. Two rows pin that. |

If a maintainer wants none of the first three, the change is: delete `smallSetsEqual` and the two `kNodeLoose` blocks of the array loop. The loose pairing then still depends on the order.

**Breaking changes.** Main is the left side of each arrow. The counts are matrix rows.

- `assert.deepEqual`: 62 rows pass → throw. `({}, { a: undefined })`, `([1], [1, undefined])`, a Date, Map, Set or array with an extra own property against one without, two RegExps with different `lastIndex`, two pending Promises, `(Map, Set)`, a `URL` against `{}`.
- `assert.notDeepEqual`: 62 rows pass → throw. `(0, -0)`, `('1', 1)`, `(null, undefined)`, `(1n, 1)`, `([5], [null])`, and two objects that differ only in a symbol key.
- `assert.deepStrictEqual`: 7 rows pass → throw. Sets and Maps with deep-equal members in different counts, `(Map, Set)`, two RegExps with a `lastIndex` of `NaN`, AggregateErrors with different `errors`, and the `compareSmallSets` pair above.
- `assert.notDeepStrictEqual`: 11 rows pass → throw. Maps with deep-equal object keys whose values are in another order, a RegExp against its copy, and two RegExps with a `lastIndex` of `-0` and `0`.

Node gives the new verdict on all of these rows but three. Two `deepEqual` rows pass → throw where Node passes: `net.BlockList` against `net.SocketAddress`, and an `EventTarget` against a `BroadcastChannel`. One `notDeepEqual` row is the Map pair of the last table row. The strict change of 1.4.0 broke the suite of es-sax (#40127, fixed by #40131).

**The tag rule.** Node compares `Symbol.toStringTag` or `Object.prototype.toString` on every pair. In Bun these objects have a non-enumerable tag that Node does not have: `fs.Stats`, `fs.BigIntStats`, `fs.StatFs`, `fs.Dirent` (#42558 removes these), `Timeout`, `Immediate`, `net.BlockList`, `net.SocketAddress`, the object that `url.parse(u, true).query` returns (#41389 changes it), and every generated class prototype. With Node's rule, `assert.deepEqual(url.parse(u, true).query, { a: 'b' })` throws. So the loose relation follows Node's rule except in one case: a non-enumerable tag on one operand and no tag on the other starts no comparison. Arrays, Sets, Maps, Dates, RegExps and ArrayBuffers always follow Node's rule. The lookup runs only when the two prototypes differ, an own tag exists, or a getter on the shared prototype holds the tag. When #42558 and #41389 land, the exception can go.

**Still unlike Node.** Each item has a matrix row with Node's verdict and a `looseBug`, `strictBug` or `skipPrototypeBug` mark, unless it names a PR.

- An untagged object against an object with a non-enumerable tag: a `Headers` object equals `{}`.
- `net.BlockList` against `net.SocketAddress` is equal on Node (no string keys, no tags) and not equal here (two tags). An `EventTarget` against a `BroadcastChannel` likewise: Node gives both the tag `EventTarget`.
- The strict relations compare the `Object.prototype.toString` results, as on main. So two tags that are no strings do not compare there: two Dates with the tags `1` and `2` are equal. The loose relation compares them.
- An own enumerable `stack` of an Error: its value never compares, and the loose relation does not count the key. That is main's rule. Node never lists `stack`. JSC lists one that user code assigns to an Error without a trace (an fs callback error, `Error.stackTraceLimit = 0`), so the pattern `if (!err.stack) err.stack = ...` needs this rule. Node compares a `stack` that user code makes enumerable on purpose.
- A Map or Set subclass that overrides `size`, `has`, `get` or the iterators: Bun reads the native entries.
- A RegExp with an own `source` or `flags` property, or a subclass that overrides them: Bun reads the native pattern and flags.
- Two objects that look like URLs (a `URL` of whatwg-url) with different hrefs are equal. Bun applies `isURL` only opposite a native `URL`. An object with the tag `URL` that is no URL equals a `URL` on Node when it is the actual value.
- A Proxy of an array compares key by key, so the `null` element rule does not apply. An array element that is an accessor reads as a hole (#37797). #42238 is the PR for arrays with far more length than elements.
- `KeyObject` and `CryptoKey` contents (#41500), `DOMException` contents (#39308), and an object that inherits from `Error.prototype` but is not an Error.
- Two cyclic values whose cycles have different lengths can get another verdict than on Node, as on main.
- `assert.partialDeepStrictEqual` is a second native port and is not touched (#38554, #45244). `assert.partialDeepStrictEqual(Map, Set)` still passes. An assigned Error `cause` still compares twice at each level there and in `Bun.deepEquals`.

**Shapes with an `undefined` key.** Some Bun objects have an own key with the value `undefined` where the Node object has no key. Main takes the two for equal. Node's relation does not, so an assertion on such an object passes on Node and on main and fails here. `new net.Socket().address()` is one (closed #33503 changed it). #40916 covers the arguments of fs callbacks. #40924 covers class fields under a tsconfig target below ES2022.

**Numbers.** Node v26.3.0.

| Check | main | PR |
|---|---|---|
| Matrix rows with a wrong loose verdict (330 rows, both argument orders) | 145 | 15 |
| Matrix rows with a wrong strict verdict | 32 | 11 |
| Matrix rows with a wrong `skipPrototype` verdict | 36 | 11 |
| Pairs of small arrays with holes, `null` and `undefined` (406,900), loose | 12,148 | 0 |
NUMBER_ROWS

The matrix rows that are wrong on this PR are the items of "Still unlike Node". Most of them are new rows that pin a difference main also has. Three loose rows go from right to wrong: the two tag pairs and the Map pair named under "Breaking changes". No strict row does.

**Cost.** COST_NOTES

**Tests.** The rows are in `deep-equal-cases.ts`, which imports only `node:` modules. When `node --version` is v26.3.0 (the version of the CI images), the test asks Node for the six verdicts of every row (three relations, two argument orders) and for 1,500 random pairs, and compares them with the rows and with the recorded verdicts. `deep-equal-mutation-fixture.ts` changes or empties the operands from user code during the comparison, under `Malloc=1` so that ASAN sees a freed table. The five `todo` subtests of the upstream file do not run in CI, so their passing assertions are matrix rows too.

**Open PRs that touch the same function.** #44833 (four conflict regions: the helper block before the template, two lines of the Error arm that read `mode.isStrict`, which is `mode.exactKeys` here, and the typed array check for one shared buffer). Draft #45457 keeps one thing that this PR does not take: it asks a same-typed pair once in every relation, which also changes arms of `expect()`. Here only Set, Map and Error pairs of the Node relations are asked once. Also #41540, #42971, #32486, #44636, #38334, #32872, #42546, #41221, #45613, #46171, and #35495 (this PR covers its `AggregateError.errors` rule for the Node relations). A `checkPrototypes` gate in any of them now also applies to `assert.deepEqual`.

</details>
