#NNNN ports Node's `setEquiv` and `mapEquiv` once, for `assert.deepEqual`, `assert.deepStrictEqual` and `util.isDeepStrictEqual` (`NodeCollections` in `src/jsc/bindings/bindings.cpp`). It covers the Set and Map pairing of this draft and adds rows to `bench/snippets/assert.mjs`. The two diffs conflict in the Set and Map arms of `specialObjectsDequal`.

If #NNNN lands first, this draft keeps one change: the dispatch that asks a same-typed pair once in every relation, with its mirrored tests. #NNNN asks only Set, Map and Error pairs of the Node relations once.

The two ports differ in one rule. #NNNN reproduces Node's `compareSmallSets` shortcut for Sets of fewer than three members, and this draft does not. The body of #NNNN asks which one is wanted.
