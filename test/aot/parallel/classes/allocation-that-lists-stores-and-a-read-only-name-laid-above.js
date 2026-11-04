// a property that is read only is laid above the objects of a constructor function by a hidden name: the store under it throws in strict code, and the object is left half made
"use strict";
const hidden = JSON.parse('{"define":"defineProperty","name":"kind"}');
let last;
function Node(kind, pos, end) { last = this; this.pos = pos; this.end = end; this.kind = kind; this.id = 0; }
function Plain(kind, pos, end) { this.pos = pos; this.end = end; this.kind = kind; this.id = 0; }
function make(kind) { return new Node(kind, -1, kind + 1); }
function makePlain(kind) { return new Plain(kind, -1, kind + 1); }
function attempt(maker, kind) { try { return Object.keys(maker(kind)).join(); } catch (error) { return error.name + ": " + error.message; } }
function deed(constructor) { Reflect[hidden.define](constructor.prototype, hidden.name, { value: "fixed", writable: false, configurable: true }); }
console.log(attempt(make, 0), attempt(makePlain, 0));
for (let turn = 1; turn < 300; turn++) { make(turn); makePlain(turn); }
deed(Node);
deed(Plain);
console.log(attempt(make, 1), Object.keys(last).join(), last.kind);
console.log(attempt(makePlain, 1));
for (let turn = 0; turn < 3; turn++) console.log(attempt(makePlain, turn));
