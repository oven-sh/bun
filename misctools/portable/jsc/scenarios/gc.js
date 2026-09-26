// Scenario 4: heavy allocation with garbage collection, default options (concurrent GC on).
// No call of gc(): the collections are the ones that the allocation asks for.
var slots = 150000;
var live = new Array(slots);
var sum = 0;
function node(i, round, other) {
    return { id: i + round, name: "n" + (i ^ round), data: [i, round, (i * round) | 0], other: other };
}
for (var round = 0; round < 48; round++) {
    for (var i = 0; i < slots; i++) {
        var at = (i * 7 + round * 17) % slots;
        var o = node(i, round, live[(at + 1) % slots] && live[(at + 1) % slots].data);
        if ((i & 3) == 0)
            live[at] = o;
        sum = (sum + o.data[2] + o.name.length) | 0;
    }
    // Large blocks too: typed arrays of 1 MiB that die at once, and one of four that stays for a while.
    var keep = [];
    for (var k = 0; k < 24; k++) {
        var big = new Uint8Array(1 << 20);
        big[k * 1000] = k + round;
        sum = (sum + big[k * 1000] + big[big.length - 1]) | 0;
        if ((k & 3) == 0)
            keep.push(big);
    }
    live[round] = { id: -1, name: "keep", data: keep, other: null };
}
var check = 0, count = 0;
for (var i = 0; i < slots; i++) {
    var o = live[i];
    if (!o)
        continue;
    count++;
    check = (Math.imul(check, 33) + o.id + o.name.length + (o.other ? o.other[0] : 7)) | 0;
    if (o.id == -1)
        for (var k = 0; k < o.data.length; k++)
            check = (check + o.data[k][k * 4000]) | 0;
}
print("gc checksum " + (sum >>> 0).toString(16) + " " + (check >>> 0).toString(16) + " live " + count);
