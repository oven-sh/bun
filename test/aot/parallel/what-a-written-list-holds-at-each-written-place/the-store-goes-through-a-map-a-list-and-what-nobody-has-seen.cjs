"use strict";
// Nobody changes the pair: the second place holds numbers alone.
const input = JSON.parse('[1.5, 2.25, 3, 4.75]'), odd = JSON.parse('["text", {"name": "odd"}, null, true]');
class Holder { constructor(name) { this.name = name; } }
function make(holder, weight, turn) { return [holder, weight]; }
function late(list) { const first = new Map(); first.set("k", list); const second = new Map(); second.set("k", first.get("k")); return second.get("k"); }
function change(thing, turn) { thing[0] = odd[turn & 3]; }
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
change(new Map(), 1); change(odd, 0);
for (let turn = 0; turn < 12; turn++) {
    const pair = make(new Holder("h" + turn), input[turn & 3], turn);
    printed.push(look(pair));
    if (turn % 3 === 2) change(late(pair), turn);
    printed.push(look(pair), mirror(pair), pair.length);
}
console.log("SAID " + printed.join(" "));
