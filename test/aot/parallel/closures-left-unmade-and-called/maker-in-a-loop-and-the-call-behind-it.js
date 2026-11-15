function make(start) { var n = 0; n = start; return { next: function () { n += 1; return n; } }; }
function run(count) {
    var total = 0, last = make(-100), before = last;
    for (var k = 0; k < count; k++) {
        before = last;
        last = make(k * 10);
        total += before.next();
    }
    total += last.next();
    total += before.next();
    total += last.next();
    return total;
}
console.log(String(run(30)));
