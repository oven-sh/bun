"use strict";
const cut = { __proto__: null, only: 1 };
function textOf(r) { return r.toString; }
function valueOf(r) { return r.valueOf; }
function ownerOf(r) { return r.hasOwnProperty; }
function makerOf(r) { return r.constructor; }
function isGone(r) { return textOf(r) === undefined; }
function kindOfText(r) { return typeof textOf(r); }
function callsText(r) { try { return textOf(r).call(r); } catch (e) { return e.constructor.name; } }
function callsByName(r) { try { return r.toString(); } catch (e) { return e.constructor.name; } }
function asksOwner(r) { try { return r.hasOwnProperty("only"); } catch (e) { return e.constructor.name; } }
const kept = { text: cut.toString, value: cut.valueOf };
let variable = cut.isPrototypeOf;
function hot(n) { let gone = 0; for (let i = 0; i < n; i++) { if (textOf(cut) === undefined) gone++; if (typeof valueOf(cut) === "function") gone += 1000; if (ownerOf(cut)) gone += 1000; if (makerOf(cut) === Object) gone += 1000; } return gone; }
console.log(isGone(cut), kindOfText(cut), callsText(cut), callsByName(cut), asksOwner(cut), typeof kept.text, kept.value === undefined, typeof variable, hot(300));
const later = { late: 1 };
function lateText() { return later.toString; }
console.log(typeof lateText(), lateText() === Object.prototype.toString);
Object.setPrototypeOf(later, null);
console.log(typeof lateText(), lateText() === undefined, "toString" in later, later instanceof Object);
const N = { __proto__: null, add: (a, b) => a + b, size: 3 };
function member(name) { return name === "add" ? N.add : name === "size" ? N.size : N.toString; }
console.log(typeof member("add"), typeof member("size"), typeof member("other"), member("other") === undefined);
