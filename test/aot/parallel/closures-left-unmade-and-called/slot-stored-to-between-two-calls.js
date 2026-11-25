function make() { var n = 0; return { next: function () { n += 1; return n; } }; }
function run(count) {
    var total = 0;
    for (var k = 0; k < count; k++) {
        var it = make();
        total += it.next();
        it.next = function () { return 100; };
        total += it.next();
    }
    return total;
}
console.log(String(run(50)));
