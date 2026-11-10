"use strict";
const log = [];
const outside = JSON.parse('["a", "b"]');
const say = value => log.push(typeof value === "object" && value !== null ? JSON.stringify(value) : String(value));
const attempt = run => { try { say(run()); } catch (thrown) { log.push(thrown.constructor.name + ":" + thrown.message); } };
class Ring { constructor() { this.n = 4; } } const rings = []; for (let t = 0; t < 8; t++) { const r = new Ring(); for (let i = 0; i < 4; i++) r[i] = { first: t }; rings.push(r); }
function turn(t) { const r = rings[t & 7]; for (let i = 0; i < 4; i++) r[i] = { at: t, i, text: "t" + t + outside[i & 1] }; return r[t & 3].text; }
let last = ""; for (let t = 0; t < 20000; t++) { last = turn(t); if ((t & 4095) === 0 && typeof Bun !== "undefined") Bun.gc(true); }
say(last); for (const r of rings) say(r[0].text + r[3].at);
console.log("SAID", log.join(" | "));
