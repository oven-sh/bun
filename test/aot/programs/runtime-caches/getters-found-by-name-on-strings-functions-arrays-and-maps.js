// A getter that the program defines on String.prototype, on a function, on an array, on a Map and on a class object, each read by name in a loop.
// The receivers have no layout of their own, so each read goes by name and finds the getter there.
"use strict";
let entered = 0;
Object.defineProperty(String.prototype, "doubled", { get() { entered++; return this + this; }, configurable: true });
Object.defineProperty(Number.prototype, "negated", { get() { entered++; return -this; }, configurable: true });

function plain() {}
Object.defineProperty(plain, "label", { get() { entered++; return typeof this; }, configurable: true });

const list = [1, 2, 3];
Object.defineProperty(list, "total", { get() { entered++; return this[0] + this[1] + this[2]; }, configurable: true });

const map = new Map([["a", 1]]);
Object.defineProperty(map, "first", { get() { entered++; return this.get("a"); }, configurable: true });

class Counter {
    static get made() { entered++; return this === Counter; }
}
class Derived extends Counter {}

function readAll(text, number, round) {
    return [text.doubled, number.negated, plain.label, list.total, map.first, Counter.made, Derived.made, map.size, list.length, text.length, round];
}

let last;
for (let round = 0; round < 50; round++)
    last = readAll("ab" + (round & 1), round, round);
console.log(JSON.stringify(last), entered);

delete String.prototype.doubled;
Object.defineProperty(list, "total", { value: "plain now", configurable: true });
Object.defineProperty(map, "first", { get() { return "another getter"; }, configurable: true });
console.log(JSON.stringify(readAll("cd", 7, -1)), entered);
