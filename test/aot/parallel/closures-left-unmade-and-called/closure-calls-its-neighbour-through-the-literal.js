function make() {
    var calls = 0, self = null;
    self = { even: function (n) { calls++; return n === 0 ? calls : self.odd(n - 1); }, odd: function (n) { calls++; return n === 0 ? -calls : self.even(n - 1); } };
    return self;
}
function run(count) {
    var total = 0;
    for (var k = 0; k < count; k++) {
        var it = make();
        total += it.even(k % 7);
        total += it.odd(k % 5);
    }
    return total;
}
console.log(String(run(40)));
