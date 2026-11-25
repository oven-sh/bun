function make() { var n = 0; return { next: function () { n += 1; return n; } }; }
function run(count) {
    var total = 0, failures = 0;
    for (var k = 0; k < count; k++) {
        var it = make();
        total += it.next();
        if (k & 1) delete it.next;
        try {
            total += it.next();
        } catch (error) {
            failures += error instanceof TypeError ? 1 : 100;
        }
        total += "next" in it ? 10 : 0;
    }
    return total + " " + failures;
}
console.log(run(20));
