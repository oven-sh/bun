function make() { var n = 0; return { step: 2, next: function () { n += this.step; this.step += 1; return n; } }; }
function run(count) {
    var total = 0;
    for (var k = 0; k < count; k++) {
        var it = make(), other = { step: 50, next: it.next };
        total += it.next();
        total += it.next();
        total += other.next();
        total += it.step + other.step;
        var loose = make().next;
        total += loose.call({ step: 7 });
    }
    return total;
}
console.log(String(run(20)));
