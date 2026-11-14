"use strict";
function make(isFixed) { const made = {}; if (isFixed) Object.defineProperty(made, "mark", { value: 1 }); else Object.defineProperty(made, "mark", { value: 2, writable: true, enumerable: true, configurable: true }); return made; }
function bump(made) { try { made.mark = made.mark + 10; } catch { return -1; } return made.mark; }
let said = 0; for (let turn = 0; turn < 600; turn++) said += bump(make(turn % 2 === 0)) + Object.keys(make(turn % 3 === 0)).length;
console.log(said);
