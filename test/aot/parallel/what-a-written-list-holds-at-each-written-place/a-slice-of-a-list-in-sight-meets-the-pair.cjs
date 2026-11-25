"use strict";
// Nobody changes the pair: the second place holds numbers alone.
const input = JSON.parse('[1.5, 2.25, 3, 4.75]'), odd = JSON.parse('["text", {"name": "odd"}, null, true]');
class Holder { constructor(name) { this.name = name; } }
function make(holder, weight, turn) { return turn & 1 ? [holder, weight] : [weight, holder].slice(); }
function change(pair, turn) {  }
function look(pair) {
    const weight = pair[1], holder = pair[0];
    return typeof weight + ":" + String(typeof weight === "symbol" ? "s" : -weight) + ":" + typeof holder + ":" + String(holder && holder.name);
}
const hidden = JSON.parse("[0, 1]");
function mirror(pair) {
    const weight = pair[hidden[1] | 0], holder = pair[hidden[0] | 0];
    return typeof weight + ":" + String(typeof weight === "symbol" ? "s" : -weight) + ":" + typeof holder + ":" + String(holder && holder.name);
}
const printed = [];
for (let turn = 0; turn < 12; turn++) {
    const pair = make(new Holder("h" + turn), input[turn & 3], turn);
    printed.push(look(pair));
    if (turn % 3 === 2) change(pair, turn);
    printed.push(look(pair), mirror(pair), pair.length);
}
console.log("SAID " + printed.join(" "));
