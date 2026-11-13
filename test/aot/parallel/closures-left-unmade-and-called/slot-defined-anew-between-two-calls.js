function make() { var n = 0; return { next: function () { n += 1; return n; } }; }
function run(count) {
    var total = 0;
    for (var k = 0; k < count; k++) {
        var it = make();
        total += it.next();
        if (k % 3 === 1) Object.defineProperty(it, "next", { value: function () { return 500; } });
        if (k % 3 === 2) Object.defineProperty(it, "next", { get: function () { return function () { return 7000; }; } });
        total += it.next();
    }
    return total;
}
console.log(String(run(21)));
