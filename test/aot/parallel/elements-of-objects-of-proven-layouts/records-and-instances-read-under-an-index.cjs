"use strict";
const log = [];
const outside = JSON.parse('[0, 10, 0.5, 100]');
const say = value => log.push(typeof value === "object" && value !== null ? JSON.stringify(value) : String(value));
const attempt = run => { try { say(run()); } catch (thrown) { log.push(thrown.constructor.name + ":" + thrown.message); } };
const record = () => ({ length: 0 }); class Ring { constructor() { this.n = 8; } } function Old() { this.length = 0; }
const fill = (made, from) => { for (let i = 0; i < 8; i++) made[i] = from + i; return made; };
const records = [], rings = [], olds = []; for (const v of outside) { records.push(fill(record(), v)); rings.push(fill(new Ring(), v)); olds.push(fill(new Old(), v)); }
function ofRecord(t) { const r = records[t & 3]; let s = 0; for (let i = 0; i < 12; i++) s = (s + r[i & 7]) | 0; return s; }
function ofRing(t) { const r = rings[t & 3]; let s = 0; for (let i = 0; i < 12; i++) s = (s + r[i & 7]) | 0; return s; }
function ofOld(t) { const r = olds[t & 3]; let s = 0; for (let i = 0; i < 12; i++) s = (s + r[i & 7]) | 0; return s; }
function past(t) { const r = records[t & 3]; const seen = []; for (let i = -2; i < 11; i++) seen.push(r[i]); return seen.join(); }
function missing(t) { const r = records[t]; return r[0] + r[1]; }
for (let t = 0; t < 6; t++) { say(ofRecord(t)); say(ofRing(t)); say(ofOld(t)); say(past(t)); } attempt(() => missing(2)); attempt(() => missing(9)); attempt(() => missing(-1));
console.log("SAID", log.join(" | "));
