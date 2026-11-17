"use strict";
const [key, name] = JSON.parse('["go", "readUInt32LE"]');
const readers = { go(b, limit) { let s = 0; for (let i = 0; i + 4 <= limit; i += 4) s = (s + b.readUInt32LE(i)) % 65521; return s; } };
function attempt(b, limit) { try { return readers[key](b, limit); } catch (error) { return error.constructor.name; } }
const made = Object.create(null); made[name] = at => at * 3;
const laid = Buffer.alloc(64, 1); laid[name] = at => at + 1;
class Heir extends Buffer {}
const heir = Buffer.alloc(64, 2); Object.setPrototypeOf(heir, { __proto__: Buffer.prototype, [name](at) { return at + 2; } });
const turns = +(process.argv[2] ?? 50);
console.log(attempt(made, turns), attempt(laid, turns), attempt(heir, turns), attempt(new Uint8Array(64), turns), attempt("text", turns), attempt(null, turns), attempt(Buffer.alloc(64, 3), turns));
