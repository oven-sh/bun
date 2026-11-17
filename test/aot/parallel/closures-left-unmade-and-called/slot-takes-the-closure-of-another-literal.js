function make(start) { var n = 0; n = start; return { next: function () { n += 1; return n; } }; }
function run(count) {
    var total = 0;
    for (var k = 0; k < count; k++) {
        var a = make(0), b = make(1000);
        total += a.next();
        a.next = b.next;
        total += a.next();
        total += b.next();
        if (a.next === b.next) total += 1000000;
    }
    return total;
}
console.log(String(run(20)));
