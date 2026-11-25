function make(start) { var n = 0; n = start; return { next: function () { n += 1; return n; } }; }
function run(count) {
    var total = 0;
    for (var k = 0; k < count; k++) {
        var a = make(0), b = make(1000);
        total += a.next();
        total += b.next();
        var either = k & 1 ? a : b;
        total += either.next();
        total += a.next();
        total += b.next();
        if (k % 3 === 0) a = b;
        total += a.next();
    }
    return total;
}
console.log(String(run(30)));
