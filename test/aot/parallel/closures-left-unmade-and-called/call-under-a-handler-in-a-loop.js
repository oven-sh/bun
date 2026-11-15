function make() { var n = 0; return { next: function () { n += 1; if (n % 3 === 0) throw new Error("third " + n); return n; } }; }
function run(count) {
    var total = 0, caught = "";
    for (var k = 0; k < count; k++) {
        var it = make();
        for (var j = 0; j < 7; j++) {
            try {
                total += it.next();
            } catch (error) {
                caught = error.message;
                total += it.next() * 10;
            } finally {
                total += 1;
            }
        }
    }
    return total + " " + caught;
}
console.log(run(15));
