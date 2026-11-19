// What Object.defineProperty() throws under a key that nobody knows, and what the conversion of the key throws, has the frame of the built-in.
// COUNT: operation:operationAOTDefineOwnProperty <= 10
"use strict";
const [name, index] = JSON.parse('["n1", 0]');
const keyThatThrows = { toString() { throw new RangeError("from a key"); } };
const refuses = new Proxy({}, { defineProperty() { return false; } });
const throws = new Proxy({}, { defineProperty() { throw new SyntaxError("from a trap"); } });
function framesOf(error) { return String(error.stack).split("\n").slice(1).map(line => line.trim().replace(/^at /, "").split(" ")[0]).slice(0, 4).join(" < "); }
function tried(define, key) { try { define(key); return "fine"; } catch (error) { return error.constructor.name + ": " + error.message + " | " + framesOf(error); } }
class Held { constructor() { this.x = 1; Object.preventExtensions(this); } own(key) { Object.defineProperty(this, key, { value: 1, writable: true, enumerable: true, configurable: true }); return this.x; } }
const ways = {
    literal(key) { const o = Object.preventExtensions({ x: 1 }); Object.defineProperty(o, key, { value: 1, writable: true, enumerable: true, configurable: true }); return o; },
    frozen(key) { const o = Object.freeze({ n1: 1 }); Object.defineProperty(o, key, { value: 2, writable: true, enumerable: true, configurable: true }); return o; },
    frozenKnown(key) { const o = Object.freeze({ n1: 1 }); Object.defineProperty(o, "n1", { value: 2, writable: true, enumerable: true, configurable: true }); return o; },
    list(key) { const l = Object.freeze([1, 2, 3]); Object.defineProperty(l, key, { value: 2, writable: true, enumerable: true, configurable: true }); return l; },
    view(key) { const l = new Uint8Array(0); Object.defineProperty(l, key, { value: 2, writable: true, enumerable: true, configurable: true }); return l; },
    instance(key) { const held = new Held(); held.own(key); return held; },
    refused(key) { Object.defineProperty(refuses, key, { value: 2, writable: true, enumerable: true, configurable: true }); return 1; },
    trapped(key) { Object.defineProperty(throws, key, { value: 2, writable: true, enumerable: true, configurable: true }); return 1; },
    closure(key) { const f = Object.freeze(function () {}); Object.defineProperty(f, key, { value: 2, writable: true, enumerable: true, configurable: true }); return f; },
    other(key) { const o = Object.freeze({ n1: 1 }); Object.defineProperty(o, key, { value: 2, writable: true, enumerable: false, configurable: true }); return o; },
};
for (const way of Object.keys(ways)) for (const [key, text] of [[name, "name"], [index, "index"], [keyThatThrows, "key"]]) console.log(way, text, tried(ways[way], key));
function made(key) { const o = {}; for (let i = 0; i < 20; i++) Object.defineProperty(o, key + i, { value: i, writable: true, enumerable: true, configurable: true }); return o; }
let sum = 0;
for (let round = 0; round < 50; round++) sum += Object.keys(made(name)).length;
console.log(sum);
