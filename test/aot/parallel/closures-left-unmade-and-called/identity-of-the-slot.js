function make() { var n = 0; return { next: function () { n++; return n; } }; }
function run(count) {
    var same = 0, sizes = 0, answers = 0;
    for (var k = 0; k < count; k++) {
        var it = make();
        answers += it.next();
        if (it.next === it.next) same++;
        var first = it.next;
        answers += it.next();
        if (first === it.next) same++;
        sizes += new Set([it.next, first, it.next]).size;
        if (make().next !== it.next) same++;
        answers += first();
        answers += it.next();
    }
    return same + " " + sizes + " " + answers;
}
console.log(run(50));
