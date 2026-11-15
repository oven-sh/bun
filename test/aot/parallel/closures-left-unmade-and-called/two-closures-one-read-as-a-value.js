var kept = [];
function make() { var n = 0; return { next: function () { n += 1; return n; }, peek: function () { n += 10; return n; } }; }
function run(count) {
    var total = 0;
    for (var k = 0; k < count; k++) {
        var it = make();
        total += it.next();
        var peek = it.peek;
        kept.push(peek);
        total += it.next();
        total += peek();
        total += it.peek();
        if (peek === it.peek) total += 1000;
        total += it.next();
    }
    for (var j = 0; j < kept.length; j++) total += kept[j]();
    return total;
}
console.log(String(run(25)));
