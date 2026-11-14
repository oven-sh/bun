var kept;
function make() { var n = 0; return { next: function () { n += 1; return n; } }; }
function run(count) {
    var total = 0, same = 0;
    for (var k = 0; k < count; k++) {
        var it = make(), before = it.next;
        for (var j = 0; j < 4; j++) {
            total += it.next();
            kept = it.next;
            if (kept === before) same++;
            total += kept();
        }
    }
    return total + " " + same;
}
console.log(run(25));
