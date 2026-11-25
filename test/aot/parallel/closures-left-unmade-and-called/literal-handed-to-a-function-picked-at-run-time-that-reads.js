function once(o) { return o.next(); }
function twice(o) { return o.next() + o.next(); }
function keep(o) { return o.next === o.next ? 1 : 0; }
var picked = [once, twice, keep];
function make() { var n = 0; return { next: function () { n += 1; return n; } }; }
function run(count, order) {
    var total = 0;
    for (var k = 0; k < count; k++) {
        var it = make();
        total += it.next();
        total += picked[order[k % order.length]](it);
        total += it.next();
    }
    return total;
}
console.log(String(run(60, JSON.parse("[0, 1, 2, 1]"))));
