function make() { var n = 0; return { next: function () { n += 1; return n; } }; }
function run(count) {
    var total = 0;
    for (var k = 0; k < count; k++) {
        var it = make();
        for (var j = 0; j < 5; j++) total += it.next();
        total += it.next();
    }
    var last = make();
    for (var i = 0; i < count; i++) total += last.next();
    return total;
}
console.log(String(run(40)));
