// delete
const odd = JSON.parse('["text", {"name": "odd"}, null, true]');
class Holder { constructor(name) { this.name = name; } }
function make(holder, weight, turn) { return [holder, weight]; }
function change(pair, turn) { delete pair[1]; }
function look(pair) {
    const weight = pair[1], holder = pair[0];
    return typeof weight + ":" + String(typeof weight === "symbol" ? "s" : -weight) + ":" + typeof holder + ":" + String(holder && holder.name);
}
const printed = [];
for (let turn = 0; turn < 12; turn++) {
    const pair = make(new Holder("h" + turn), (turn & 3) * 0.75 + 1.5, turn);
    printed.push(look(pair));
    if (turn % 3 === 2) change(pair, turn);
    printed.push(look(pair), pair.length);
}
console.log(printed.join(" "));
