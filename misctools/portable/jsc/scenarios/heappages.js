// Scenario 12: blocks of the heap whose pages hold no live cell after a full collection, and that are
// allocated from again. Options: --useDollarVM=1 --sweepSynchronously=1.
// On Linux JavaScriptCore gives such pages back with a decommit and uses them again without a commit
// (MarkedBlock::Handle::decommitUnusedPages). Under a host that commits memory a decommitted page has no
// access, and the blocks keep their pages, as they do on Windows. The second line says which of the two
// ran, and how many pages a block has: with one page in a block there is nothing to give back.
var survivors = [];
function fill(rounds, keepEvery) {
    var sum = 0;
    for (var i = 0; i < rounds; i++) {
        var object = { a: i, b: i + 1, c: i + 2, d: i + 3 };
        if (keepEvery && i % keepEvery == 0)
            survivors.push(object);
        sum += object.d;
    }
    return sum;
}
var first = fill(400000, 97);
fullGC();
var statistics = $vm.markedBlockStatistics();
var second = fill(400000, 0);
fullGC();
var third = fill(400000, 0);
var live = 0;
for (var i = 0; i < survivors.length; i++)
    live += survivors[i].a == i * 97 && survivors[i].d == i * 97 + 3 ? 1 : 0;
print("heap pages sums " + first + " " + second + " " + third + " live " + live + " of " + survivors.length);
print("heap pages given back " + (statistics.decommittedPages > 0) + " pages in a block " + statistics.pagesPerBlock);
