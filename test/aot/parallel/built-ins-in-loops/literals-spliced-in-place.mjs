// splice() of a literal whose elements are shared: the first splice copies them, the literal of the next call is whole.
const log = [];
function cut(turn) {
    const whole = [1, 2, 3, 4, 5], halves = [0.5, 1.5, -0, 2.5], words = ["a", "b", "c"], mixed = [1, "x", null, 2.5];
    whole.splice(turn % 5, 1);
    const gone = halves.splice(turn % 4, 2, turn);
    words.splice(1, 0, "new" + turn, "more");
    const all = mixed.splice(-3);
    whole.splice(turn % 3, 9, turn, turn + 0.5);
    words.splice(turn % 2, 1);
    return [whole, gone, halves, words, all, mixed].map(list => list.map(value => (Object.is(value, -0) ? "-0" : String(value))).join()).join("|");
}
for (let turn = 0; turn < 12; turn++) log.push(cut(turn));
const frozen = Object.freeze([1, 2, 3]);
try {
    frozen.splice(0, 1);
} catch (error) {
    log.push(error.name);
}
let total = 0;
for (let turn = 0; turn < 100; turn++) {
    const list = [1, 2, 3, 4, 5];
    list.splice(turn % 5, 1);
    total += list.length + list[0];
}
console.log(log.join("\n"), total, frozen.join());
