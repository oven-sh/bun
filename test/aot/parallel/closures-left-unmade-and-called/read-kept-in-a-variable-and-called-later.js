function touch(o) { return o.tag; }
function make() { var n = 0; return { tag: 1, next: function () { n += 1; return n; } }; }
function run(count) {
    var total = 0;
    for (var k = 0; k < count; k++) {
        var it = make();
        var next = it.next;
        total += touch(it);
        total += next();
        var again = it.next;
        for (var j = 0; j < 3; j++) total += touch(it);
        total += again();
        total += it.next();
    }
    return total;
}
console.log(String(run(25)));
