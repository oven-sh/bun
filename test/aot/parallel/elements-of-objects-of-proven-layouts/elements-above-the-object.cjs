"use strict";
const log = [];
const outside = JSON.parse('[5, 6, 7]');
const say = value => log.push(typeof value === "object" && value !== null ? JSON.stringify(value) : String(value));
const attempt = run => { try { say(run()); } catch (thrown) { log.push(thrown.constructor.name + ":" + thrown.message); } };
class Base { } Base.prototype[1] = "above"; Object.defineProperty(Base.prototype, 2, { get() { return "got by " + this.n; }, configurable: true }); class Ring extends Base { constructor(n) { super(); this.n = n; } }
const rings = []; for (const v of outside) { const r = new Ring(v); r[0] = v; rings.push(r); } rings[1][1] = "own"; rings[2][3] = "three";
function read(t, i) { const r = rings[t]; return r[i | 0]; }
for (let t = 0; t < rings.length; t++) for (let i = 0; i < 5; i++) say(read(t, i));
const plain = []; for (const v of outside) { const r = { n: v }; r[0] = v; plain.push(r); } function off(t, i) { const r = plain[t]; return r[i | 0]; }
for (let t = 0; t < plain.length; t++) for (let i = 0; i < 3; i++) say(off(t, i));
const moved = { n: 9 }; moved[0] = 9; Object.setPrototypeOf(moved, { 1: "from the new one above" }); plain.push(moved); say(off(3, 0)); say(off(3, 1)); say(off(3, 2));
const bare = { n: 8 }; bare[0] = 8; Object.setPrototypeOf(bare, null); plain.push(bare); say(off(4, 0)); say(off(4, 1));
console.log("SAID", log.join(" | "));
