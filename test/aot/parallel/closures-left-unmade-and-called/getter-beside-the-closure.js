function make() { var n = 0; return { get size() { return n; }, next: function () { n += 4; return n; } }; }
function run(count) {
    var total = 0;
    for (var k = 0; k < count; k++) {
        var it = make();
        total += it.size;
        total += it.next();
        total += it.size;
        total += it.next();
        total += it.size;
    }
    return total;
}
console.log(String(run(35)));
