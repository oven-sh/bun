var list = [];
function make() { var n = 0; return { next: function () { n += 2; return n; } }; }
function run(count) {
    var total = 0;
    for (var k = 0; k < count; k++) {
        var it = make();
        total += it.next();
        list.push(it);
        total += list[list.length - 1].next();
        total += it.next();
    }
    for (var j = 0; j < list.length; j++) total += list[j].next();
    return total;
}
console.log(String(run(30)));
