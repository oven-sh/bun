var seen = [];
function show(o) { seen.push(o); return seen.length; }
function make() { var n = 0; return { add: function (by) { n += by; return n; }, bump: function () { n += 100; return 1; } }; }
function run(count) {
    var total = 0;
    for (var k = 0; k < count; k++) {
        var it = make();
        total += it.add(it.bump());
        total += it.add(show(it));
        total += it.add(it.add(it.add(2)));
        total += it.add(k & 1 ? it.bump() : show(it));
    }
    for (var j = 0; j < seen.length; j++) total += seen[j].add(1);
    return total;
}
console.log(String(run(20)));
