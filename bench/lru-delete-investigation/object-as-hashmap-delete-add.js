// JSTests/microbenchmarks/object-as-hashmap-delete-add.js
//
// Interleaved delete+add on a plain object used as a fixed-size hashmap.
// This is the access pattern of e.g. mnemonist/lru-cache.
//
// A cacheable dictionary with a pinned PropertyTable used to clone the
// full table on every delete (O(N)) because it never reaches
// s_maxTransitionLengthForRemove and pin() clears previousID() so
// transitionCountHasOverflowed() never fires either.

var N = 1000;
var rounds = 50000;

var o = {};
var keys = new Array(N);
for (var i = 0; i < N; i++) {
    var k = "k" + i;
    o[k] = i;
    keys[i] = k;
}

var tail = 0;
for (var r = 0; r < rounds; r++) {
    delete o[keys[tail]];
    var nk = "key" + r;
    o[nk] = tail;
    keys[tail] = nk;
    tail = tail + 1;
    if (tail === N)
        tail = 0;
}

if (Object.keys(o).length !== N)
    throw new Error("wrong key count");
