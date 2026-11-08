// the closure of a declared function is a constant where nothing is ever stored into the variable, and is read where something takes it: as a value, a key, a receiver, thrown, yielded, across an await, in loops, in arms, ahead of its declaration. A variable that IS stored into is read where the read is written: what was read ahead of the store is called behind it
// Under: --aot-testing=WritesBodiesStraight: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
function helper(x) { return x + 1; }
function tagged() { return tagged.tag; }
function counter() { return ++counter.calls; }
counter.calls = 0;
function later() { return "first"; }
function swap() { later = function () { return "second"; }; }
function first() { return "first"; }
function second() { return "second"; }
function current() { return "declared"; }
function readsAhead() { const before = current; current = second; const answer = before(); current = first; return answer; }
function readsAheadOfCall() { const before = later; swap(); return before(); }
function handsOnWhatWasReadAhead(list) { const before = current; current = second; list.push(before); current = first; return list[0](); }
function early() { return typeof hoisted + " " + hoisted(); }
function* steps() { yield helper; yield helper; }
async function waits() { const before = helper; await null; return before === helper; }
function inLoop(n) { const seen = new Set(); for (let i = 0; i < n; i++) seen.add(helper); return seen.size; }
function inLoopBehindRead(n) { const f = helper; let same = 0; for (let i = 0; i < n; i++) { if (f === helper) same++; } return same; }
function underTry(bad) { try { if (bad) throw helper; const pair = [helper, helper]; return pair[0] === pair[1] && pair[0] === helper; } catch (thrown) { return thrown === helper; } }
function chosen(c) { const f = c ? helper : tagged; return f === helper; }
function returned() { return helper; }
function stored() { const box = { f: helper }; return box.f === helper && box.f(1); }
function asKey() { const map = new Map(); map.set(helper, "found"); return map.get(helper); }
function asThis() { return helper.call.call(helper, null, 4); }
function named() { return helper.name + helper.length; }
function Maker(v) { this.v = v; }
function made() { return new Maker(3).v + (new Maker(1) instanceof Maker ? 1 : 0); }
function builtins() { return typeof Math.floor + (Math === Math) + (Object.keys === Object.keys) + (Array.isArray === Array.isArray) + Math.max.name; }
function builtinsInLoop(n) { const seen = new Set(); for (let i = 0; i < n; i++) { seen.add(Math); seen.add(JSON.stringify); } return seen.size; }
function twoSteps() { const walk = steps(); const a = walk.next().value; const b = walk.next().value; return a === b && a === helper; }
function tell(f) { try { report(f()); } catch (e) { report(e.constructor.name); } }
function round(turn) { tell(() => helper === helper); tell(() => returned() === helper); tell(() => returned()(1)); tagged.tag = "set" + turn; tell(tagged); tell(() => counter() + counter()); tell(later); if (turn === 1) swap(); tell(later); tell(early); tell(readsAhead); tell(readsAheadOfCall); tell(() => handsOnWhatWasReadAhead([])); tell(twoSteps); tell(() => inLoop(5)); tell(() => inLoopBehindRead(5)); tell(() => underTry(false)); tell(() => underTry(true)); tell(() => chosen(true)); tell(() => chosen(false)); tell(stored); tell(asKey); tell(asThis); tell(named); tell(made); tell(builtins); tell(() => builtinsInLoop(4)); }
round(0);
round(1);
round(2);
function hoisted() { return "hoisted"; }
report(await waits());
report("end");
