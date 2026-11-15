function leave(o) { return o.tag; }
function replace(o) { o.next = function () { return -5; }; return o.tag; }
var picked = [leave, replace];
function make() { var n = 0; return { tag: 1, next: function () { n += 1; return n; } }; }
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
console.log(String(run(60, JSON.parse("[0, 1, 1, 0, 0]"))));
