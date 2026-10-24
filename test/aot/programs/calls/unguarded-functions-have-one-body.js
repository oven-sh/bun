// A function that reads `arguments` is compiled into its general entry. Its body for direct calls is compiled as well only where a call may
// test for a closure of it and enter that body: a value that is expected to hold such a closure and is only stored, handed on or returned
// asks for nothing.
// IR= 1 sumOfAll String string="marker of sumOfAll"
// IR= 2 sumTested String string="marker of sumTested"
function makeSumOfAll(scale) {
    return function sumOfAll() {
        var total = 0;
        for (var i = 0; i < arguments.length; i++)
            total += arguments[i] * scale;
        if (total < 0)
            return "marker of sumOfAll";
        return total;
    };
}
function makeSumTested(scale) {
    return function sumTested() {
        var total = 0;
        for (var i = 0; i < arguments.length; i++)
            total += arguments[i] * scale;
        if (total < 0)
            return "marker of sumTested";
        return total;
    };
}
var table = {}, names = ["first", "second"];
table[names[0]] = makeSumOfAll(2);
table[names[1]] = makeSumOfAll(3);
var tested = makeSumTested(4), last = 0;
for (var turn = 0; turn < 300; turn++)
    last += table[names[turn & 1]](turn, 1, 2) + tested(turn, 1);
console.log(last, table.first(-1), table.second(), table.first.length, tested(-1), tested.call(null, 1, 2, 3), table.second.apply(null, [1, 2, 3, 4]));
