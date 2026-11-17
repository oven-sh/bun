function make() { var n = 0; return { next: function () { n += 1; return n; } }; }
function run(count) {
    var total = 0, same = 0;
    for (var k = 0; k < count; k++) {
        var it = make();
        total += it.next();
        var copy = { ...it }, assigned = Object.assign({}, it);
        total += copy.next();
        total += assigned.next();
        total += it.next();
        if (copy.next === it.next && assigned.next === it.next) same++;
        total += Object.keys(it).length + Object.values(it).length;
    }
    return total + " " + same;
}
console.log(run(20));
