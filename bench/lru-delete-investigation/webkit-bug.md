Title: delete on a cacheable-dictionary object with 128 < N <= 4096 properties clones the PropertyTable on every call

Component: JavaScriptCore
Keywords: Performance

---

Interleaving `delete obj[k]` and `obj[k2] = v` on a plain object with between ~130 and 4096 own string properties is O(N) per delete in JSC, versus O(1) in V8. This is the object-as-hashmap pattern used by e.g. `mnemonist/lru-cache` (https://github.com/oven-sh/bun/issues/14063), which is ~100x slower in Safari/Bun than in Chrome/Node for a 1000-entry cache.

Standalone reproduction (jsc shell):

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
[64, 128, 200, 500, 1000, 2000, 4096, 4097, 8192].forEach(function (N) {
    churn(N, 100);
    print(N + "\t" + churn(N, 2000) + " ms");
});
```

jsc:
```
64     1 ms
128    1 ms
200    9 ms
500    21 ms
1000   39 ms
2000   71 ms
4096   152 ms
4097   1 ms
8192   1 ms
```

v8 (d8/node): all rows are 0-2 ms.

### Analysis

After adding >s_maxTransitionLength (128) properties, the object becomes a CachedDictionaryKind Structure with a pinned PropertyTable.

`JSObject::deleteProperty` only uses `removePropertyWithoutTransition` for UncachedDictionaryKind; for cacheable dictionaries it falls through to `Structure::removeNewPropertyTransition`, which checks:

```cpp
if (structure->shouldDoCacheableDictionaryTransitionForRemoveAndAttributeChange()) {
    // -> toUncacheableDictionaryTransition, then O(1) remove
}
// else:
Structure* transition = Structure::create(vm, structure, deferred);
...
transition->setPropertyTable(vm, structure->takePropertyTableOrCloneIfPinned(vm));
```

Because the cacheable dictionary's table is pinned, `takePropertyTableOrCloneIfPinned` returns `result->copy(vm, result->size() + 1)`, i.e. a full O(N) clone of the property table, on every delete.

`shouldDoCacheableDictionaryTransitionForRemoveAndAttributeChange()` is:

```cpp
return transitionCountEstimate() > s_maxTransitionLengthForRemove /* 4096 */
    || transitionCountHasOverflowed();
```

For a pinned cacheable dictionary `transitionCountHasOverflowed()` is always false (`pin()` clears `previousID()`), so the only escape is `transitionCountEstimate() > 4096`. That leaves the whole [~130, 4096] band in the clone-on-every-delete path.

### Relationship to bug 206430

Bug 206430 made `delete` keep objects on the structure chain by caching `PropertyDeletion` transitions, so instances continue to share a Structure and get/put can still inline-cache. Its "when to give up and go uncacheable" heuristic was `transitionCountHasOverflowed()`: once the `previousID()` chain grows past 128, stop creating new structures.

Cacheable dictionaries fall through a gap in that heuristic:

- `pin()` clears `previousID()`, so `transitionCountHasOverflowed()` never fires for them.
- `removePropertyTransitionFromExistingStructure` bails on `hasBeenDictionary()`, so the `PropertyDeletion` transition lookup is skipped.
- The new Structure is never inserted into `m_transitionTable` (`if (!structure->hasBeenDictionary())` guards the insert).

So a cacheable dictionary pays the full O(N) clone per delete but receives none of the transition caching that bug 206430 introduced. Bug 283094 / 286601@main partially closed this with the `transitionCountEstimate() > 4096` check; the [~130, 4096] band is still uncovered.

### Proposed fix

Promote a cacheable dictionary to uncacheable on the first delete, inside `removeNewPropertyTransition`:

```diff
-    if (structure->shouldDoCacheableDictionaryTransitionForRemoveAndAttributeChange()) {
+    if (structure->isDictionary() || structure->shouldDoCacheableDictionaryTransitionForRemoveAndAttributeChange()) {
         ASSERT(!isCopyOnWrite(structure->indexingMode()));
         Structure* transition = toUncacheableDictionaryTransition(vm, structure, deferred);
```

With this change the first delete still pays one O(N) `copyPropertyTableForPinning` inside `toDictionaryTransition`, but every subsequent delete/add is O(1) in-place. The microbenchmark above goes flat at ~1 ms for all N.

Structure-chain objects (the `Point`/constructor pattern that motivated bug 206430) have `isDictionary() == false` and are unaffected: they keep the cached `PropertyDeletion` transition and delete inline caching. The one behavioural change is that a cacheable dictionary (an object that has already grown past ~`s_maxTransitionLength` properties) becomes uncacheable after its first delete, so subsequent get/put on that specific object no longer IC. In the repeated-delete workloads that hit this path the post-delete Structure was being replaced on every iteration anyway, so no IC was surviving.

A local release `jsc` build with this change is neutral-to-faster on `JSTests/microbenchmarks/delete-property-*` (including `delete-property-keeps-cacheable-structure.js` from bug 206430) and passes the relevant `JSTests/stress` tests unchanged.

`attributeChangeTransition` has the same O(N) clone for cacheable dictionaries but is left unchanged here since it is covered by `JSTests/stress/change-attribute-structure-transition.js`; happy to extend the fix if preferred.
