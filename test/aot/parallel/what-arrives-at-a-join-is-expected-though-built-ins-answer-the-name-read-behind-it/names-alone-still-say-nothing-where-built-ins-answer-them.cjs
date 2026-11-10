"use strict";
function Link(next) { this.next = next; }
function step(holder, isFirst) { let at = isFirst ? holder : holder; let count = 0; for (let i = 0; i < 40; i++) { const given = at.next; count += typeof given === "function" ? 1 : given === null ? 2 : 3; } return count; }
const table = { step };
const chain = new Link(new Link(null)), walker = [1, 2, 3][Symbol.iterator]();
let said = 0; for (let turn = 0; turn < 3000; turn++) said = (said + table[["st", "ep"].join("")](turn % 3 === 0 ? chain : walker, turn % 2 === 0)) % 1000003;
console.log(said);
