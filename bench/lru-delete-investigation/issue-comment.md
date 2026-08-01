Revisited this on current canary. The Map/Set regression from https://bugs.webkit.org/show_bug.cgi?id=280144 is fixed and `flru`, `lru.min`, and `lru-cache` are now at parity with Node. The remaining gap is `mnemonist/lru-cache`, which is still ~50-100x slower than Node for the eviction benchmark.

`mnemonist/lru-cache` stores its key index in a plain `{}` object and does `delete items[oldKey]; items[newKey] = ptr` on every eviction, so the residual is a JSC `delete` pathology rather than anything Map/Set-related.

### Minimal reproduction (no dependencies)

```js
function churn(N, rounds) {
    var o = {};
    for (var i = 0; i < N; i++) o["k" + i] = i;
    var keys = new Array(N);
    for (var i = 0; i < N; i++) keys[i] = "k" + i;
    var tail = 0;
    var t0 = Date.now();
    for (var r = 0; r < rounds; r++) {
        delete o[keys[tail]];
        var nk = "key" + r;
        o[nk] = tail;
        keys[tail] = nk;
        tail = (tail + 1) % N;
    }
    return Date.now() - t0;
}

var sizes = [64, 128, 200, 500, 1000, 2000, 4096, 4097, 8192];
for (var i = 0; i < sizes.length; i++) {
    churn(sizes[i], 100);
    print(sizes[i] + "\t" + churn(sizes[i], 2000) + " ms");
}
```

Bun 1.4.0 vs Node 26.3.0, 2000 `delete+add` rounds:

| N (props) | Bun | Node |
|---|---|---|
| 64 | 1 ms | 2 ms |
| 128 | 1 ms | 0 ms |
| 200 | 9 ms | 1 ms |
| 500 | 21 ms | 0 ms |
| 1000 | 39 ms | 0 ms |
| 2000 | 71 ms | 1 ms |
| 4096 | 152 ms | 0 ms |
| **4097** | **1 ms** | 0 ms |
| 8192 | 1 ms | 0 ms |

Time scales linearly with N in [~130, 4096] and drops to O(1) at exactly N=4097. `mnemonist/lru-cache` with capacity 1000 sits right in the slow band.

### Root cause

The boundaries line up with two JSC `Structure` thresholds:

```cpp
// Source/JavaScriptCore/runtime/Structure.h
static constexpr int s_maxTransitionLength = 128;
static constexpr int s_maxTransitionLengthForRemove = 4096;
```

After ~128 property additions the object transitions to a `CachedDictionaryKind` structure whose `PropertyTable` is pinned. `JSObject::deleteProperty` only takes the in-place `removePropertyWithoutTransition` path when `isUncacheableDictionary()` is true; for a cacheable dictionary it falls through to `Structure::removeNewPropertyTransition`, which does:

```cpp
Structure* transition = Structure::create(vm, structure, deferred);
...
transition->setPropertyTable(vm, structure->takePropertyTableOrCloneIfPinned(vm)); // pinned -> copy(N+1)
```

Because the dictionary's table is pinned, `takePropertyTableOrCloneIfPinned` clones the full N-entry table on every delete. The next property add (`addOrReplacePropertyWithoutTransition`) re-pins the table on the new structure, so the next delete clones again. Each delete on a cacheable dictionary with N properties is O(N).

The escape hatch to `UncacheableDictionary` (which would make deletes O(1) in-place) is gated on:

```cpp
inline bool shouldDoCacheableDictionaryTransitionForRemoveAndAttributeChange()
{
    return transitionCountEstimate() > s_maxTransitionLengthForRemove /* 4096 */
        || transitionCountHasOverflowed();
}
```

`transitionCountEstimate()` is ~N, so this only fires at N > 4096. `transitionCountHasOverflowed()` walks `previousID()`, but `pin()` clears `previousID`, so it never fires for a pinned dictionary. Result: N in [~130, 4096] never escapes, every delete is an O(N) table clone.

The 4096 threshold was added in https://bugs.webkit.org/show_bug.cgi?id=283094 (WebKit@67c6b7bf) as a partial mitigation; it just doesn't cover the common LRU case.

### Verification

Forcing the object into `UncachedDictionaryKind` before the loop (by temporarily growing past 4097 properties and deleting back down) brings the N=1000 case from ~39 ms to ~0.8 ms, matching Node.

### Proposed JSC fix

The new `Structure` produced by `removeNewPropertyTransition` on a cacheable dictionary is never added to any transition table (`hasBeenDictionary()` suppresses `m_transitionTable.add`), so there is no caching benefit being preserved. Promoting to uncacheable on the first delete from a dictionary avoids the per-delete clone:

```diff
--- a/Source/JavaScriptCore/runtime/Structure.cpp
+++ b/Source/JavaScriptCore/runtime/Structure.cpp
@@ -680,7 +680,13 @@ Structure* Structure::removeNewPropertyTransition(VM& vm, Structure* structure,
     ASSERT(!Structure::removePropertyTransitionFromExistingStructure(structure, propertyName, offset));
     ASSERT(structure->getConcurrently(propertyName.uid()) != invalidOffset);

-    if (structure->shouldDoCacheableDictionaryTransitionForRemoveAndAttributeChange()) {
+    // A cacheable dictionary always has a pinned property table, so the
+    // takePropertyTableOrCloneIfPinned below would copy the full N-entry table
+    // into a fresh Structure that is never added to any transition table
+    // (hasBeenDictionary() suppresses m_transitionTable.add). That makes every
+    // delete on such an object O(N) with no caching benefit. Promote to an
+    // uncacheable dictionary instead so subsequent deletes are in-place.
+    if (structure->isDictionary() || structure->shouldDoCacheableDictionaryTransitionForRemoveAndAttributeChange()) {
         ASSERT(!isCopyOnWrite(structure->indexingMode()));
         Structure* transition = toUncacheableDictionaryTransition(vm, structure, deferred);
         ASSERT(structure != transition);
```

Verified against a local `jsc` release build: the microbenchmark above goes flat at ~1 ms for every N, the `JSTests/stress` tests matching `delete|dictionary|transition|put-by|for-in|has-own|object-keys` are unchanged (216 pass / 0 fail both with and without the patch), and the `JSTests/microbenchmarks/delete-property-*` benchmarks from https://bugs.webkit.org/show_bug.cgi?id=206430 are neutral or faster.

This only affects objects that have already become dictionaries (more than ~128 properties); deletes on normal structure-chain objects keep the cacheable transition introduced in https://bugs.webkit.org/show_bug.cgi?id=206430.

### Workaround for mnemonist users

`mnemonist` ships `lru-map.js` which uses a `Map` instead of a plain object for the index and is already at Node parity in Bun:

```js
const LRUMap = require('mnemonist/lru-map');
```
