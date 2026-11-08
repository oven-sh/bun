function make() { var n = 0; return { tag: 7, next: function () { n += 3; return n; } }; }
function run(count) {
    var total = 0, text = "";
    for (var k = 0; k < count; k++) {
        var it = make();
        total += it.next();
        text = JSON.stringify(it);
        total += it.next();
    }
    return total + " " + text;
}
console.log(run(40));
