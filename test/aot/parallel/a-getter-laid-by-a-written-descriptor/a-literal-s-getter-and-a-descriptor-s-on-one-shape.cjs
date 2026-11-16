"use strict";
function make(byLiteral) { if (byLiteral) return { get add() { return 1; } }; const made = {}; Object.defineProperty(made, "add", { get() { return 2; } }); return made; }
function drive(names, turns) { let s = 0; for (let i = 0; i < turns; i++) s += names.add; return s; }
const turns = +(process.argv[2] ?? 50), first = make(true), second = make(false);
console.log(drive(first, turns), drive(second, turns), JSON.stringify(Object.getOwnPropertyDescriptor(first, "add")), JSON.stringify(Object.getOwnPropertyDescriptor(second, "add")), Object.keys(first).length, Object.keys(second).length);
