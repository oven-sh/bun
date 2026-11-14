// Loops, spreads, patterns and helpers of iterators that may be match iterators: empty matches, done and partly consumed ones, own next and exec, breaks, throws.
const word = /([a-z]+)(\d*)/g, empty = /x*/gu, texts = ["alpha1 beta22 gamma", "", "xxaxx\u{1F600}x", "a1".repeat(5)];
class Every extends RegExp { exec(s) { return calls++ % 4 === 3 ? null : super.exec(s); } }
class Objects extends RegExp { exec(s) { return calls++ % 3 === 2 ? null : { 0: calls % 3 ? "m" : "", index: calls, length: 1 }; } }
class Throws extends RegExp { exec(s) { if (calls++ % 3 === 1) throw new Error("exec"); return super.exec(s); } }
let calls = 0;
const uses = [
  it => { const out = []; for (const m of it) out.push(m[0]); return out; },
  it => { const out = []; for (const m of it) { out.push(m.index); if (out.length === 2) break; } for (const m of it) out.push("rest" + m.index); return out; },
  it => { const [first, second, ...rest] = it; return [first?.[0], second?.index, rest.length]; },
  it => { const [first] = it; return [first?.[0], [...it].length]; },
  it => [...it].map(m => m[0]),
  it => Array.from(it, m => m[0]),
  it => Math.max(0, ...it.map(m => m.index)),
  it => it.filter(m => m.index & 1).toArray().length,
  it => it.reduce((a, m) => a + m[0].length, 0),
  it => it.take(2).toArray().map(m => m[0]),
  it => it.drop(1).map(m => m.index).toArray(),
  it => it.some(m => m.index > 4) + "," + it.every(m => m.index > 4),
  it => it.find(m => m.index > 1)?.[0],
  it => it.flatMap(m => [m[0], m.index]).toArray(),
  it => { let s = ""; it.forEach((m, i) => { s += m[0] + i; }); return s; },
  it => new Set(it).size,
  it => new Map(it.map(m => [m[0], m.index])).size,
  it => { try { for (const m of it) if (m.index > 2) throw new Error("at " + m.index); } catch (error) { return error.message + [...it].length; } },
  it => { const out = []; for (let step; !(step = it.next()).done;) out.push(step.value.index); return out; },
  function (it) { return (function* () { yield* it; })().toArray().length; },
  it => Object.fromEntries(Iterator.from(it).map(m => [m[0], m.index])),
];
const makers = [s => s.matchAll(word), s => s.matchAll(empty), s => s.matchAll(new Every(word.source, "g")), s => s.matchAll(new Objects(word.source, "g")), s => s.matchAll(new Throws(word.source, "g")), s => { const it = s.matchAll(word); it.next(); return it; }, s => { const it = s.matchAll(word); let left = 2; it.next = () => ({ done: !left--, value: Object.assign(["own"], { index: left }) }); return it; }, s => [...s].map((c, index) => Object.assign([c], { index })).values(), s => new Set([...s].map((c, index) => Object.assign([c], { index }))).values(), function* (s) { for (let index = 0; index < s.length; index++) yield Object.assign([s[index]], { index }); }];
function run(use, make, s) { try { return JSON.stringify(use(make(s))); } catch (error) { return error.name + ": " + error.message; } }
for (let round = 0; round < 2; round++) for (const use of uses) { const line = []; for (const make of makers) for (const s of texts) line.push(run(use, make, s)); console.log(line.join(" ")); }
console.log(calls);
