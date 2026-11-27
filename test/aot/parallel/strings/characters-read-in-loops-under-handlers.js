// Loops over the characters of pieces, ropes and flat strings under for-of, try and finally.
// STATISTIC: StringsFlattenedBeforeGuardedLoops >= 8
const text = JSON.parse('"alpha beta é gamma 日本 delta  x yy zzz"'), all = process.argv[2] === "all"; let lines = 0, hash = 0, calls = 0;
function say(line) { lines++; for (let i = 0; i < line.length; i++) hash = (hash * 31 + line.charCodeAt(i)) | 0; if (all) console.log(line.slice(0, 200)); else if (lines % 23 === 0) console.log(lines, hash); }
const pieces = () => text.split(" "), ropes = () => pieces().map((p, i) => p + i + text.slice(i % 5, 9)), flats = () => JSON.parse(JSON.stringify(pieces())), deep = () => { let s = ""; for (let i = 0; i < 300; i++) s = (i & 1 ? text.slice(i % 9, i % 9 + 3) : "q") + s; return [s, s.slice(5), "x" + s]; }, mixed = () => ["ab", 5, null, { length: 2, 0: "o", charCodeAt: () => 7 }, ["o", "p"], text.slice(3, 9), undefined], empty = () => ["", text.slice(0, 0), text.slice(4, 4)], boxed = () => [new String("abo"), text.slice(1, 5)];
const inputs = { pieces, ropes, flats, deep, mixed, empty, boxed, none: () => [] };
const shapes = {
  codes: (w, n) => { let h = n; for (let i = 0; i < w.length; i++) h = (h * 31 + w.charCodeAt(i)) | 0; return h; },
};
function codesOf(l) { let h = 0; for (const w of l) for (let i = 0; i < w.length; i++) h = (h * 31 + w.charCodeAt(i)) | 0; return h; }
function indexOf(l) { let h = 0; for (const w of l) for (let i = 0; i < w.length; i++) if (w[i] === "a") h++; else h += 3; return h; }
function atOf(l) { let h = ""; for (const w of l) for (let i = 0; i < w.length; i++) h += w.charAt(i); return h; }
function pointsOf(l) { let h = 0; for (const w of l) for (let i = 0; i < w.length; i++) h ^= w.codePointAt(i); return h; }
function held(l) { let h = 0; for (const w of l) for (let i = 0, n = w.length; i < n; i++) h += w.charCodeAt(i) * i; return h; }
function left(l) { let h = 0; for (const w of l) { for (let i = 0; i < w.length; i++) { if (w[i] === "t") break; h += i; } if (w === "gamma") continue; h += 100; } return h; }
function found(l) { for (const w of l) for (let i = 0; i < w.length; i++) if (w.charCodeAt(i) > 200) return w + i; return "no"; }
function armed(l, k) { let h = 0; for (const w of l) for (let i = 0; i < w.length; i++) { if (k > i) continue; h += w.charCodeAt(i); } return h; }
function tried(l) { let h = 0; try { for (let k = 0; k < l.length; k++) { const w = l[k]; for (let i = 0; i < w.length; i++) h = (h * 31 + w.charCodeAt(i)) | 0; } } catch (e) { h = e.name + h; } finally { calls++; } return h; }
function inner(l) { let h = 0; for (const w of l) { try { for (let i = 0; i < w.length; i++) { if (w[i] === "m") throw w; h += w.charCodeAt(i); } } catch (e) { h += e.length; } } return h; }
function back(l) { let h = 0; for (const w of l) for (let i = w.length - 1; i >= 0; i--) h = (h * 7 + w.charCodeAt(i)) | 0; return h; }
function later(l) { let h = 0; for (const w of l) for (let i = 1; i < w.length; i++) if (w[i] > w[i - 1]) h++; return h; }
function twice(l) { let h = 0; for (const w of l) { for (let i = 0; i < w.length; i++) h += w.charCodeAt(i); for (let i = 0; i < w.length; i++) h ^= w.charCodeAt(i); if (w.length > 2) h += w.indexOf("a"); } return h; }
function pairs(l) { let h = 0; for (const v of l) for (const w of l) for (let i = 0; i < v.length; i++) if (v[i] === w[i]) h++; return h; }
function grown(l) { let h = 0; for (const w of l) { let t = w; for (let i = 0; i < t.length && i < 40; i++) { if (t[i] === "a") t += "bc"; h += t.length; } } return h; }
function stepped(l) { let h = 0; for (const w of l) { let i = 0; while (i < w.length) { h += w.charCodeAt(i); i += 2; } } return h; }
function entries(l) { let h = 0; for (const [k, w] of l.entries()) for (let i = 0; i < w.length; i++) h += w.charCodeAt(i) * k; return h; }
function ofMap(l) { let h = 0; for (const [k, w] of new Map(l.map((w, i) => [i, w]))) for (let i = 0; i < w.length; i++) h += w.charCodeAt(i) * k; return h; }
function* made(l) { try { yield* l; } finally { calls += 100; } }
function ofGenerator(l) { let h = 0; for (const w of made(l)) for (let i = 0; i < w.length; i++) { h += w.charCodeAt(i); if (h > 3000) return h; } return h; }
function thrown(l) { let h = 0; try { for (const w of made(l)) for (let i = 0; i < w.length; i++) { h += w.charCodeAt(i); if (w[i] === "g") throw new Error("g" + h); } } catch (e) { return e.message + calls; } return h; }
async function awaited(l) { let h = 0; for await (const w of l) for (let i = 0; i < w.length; i++) h += w.charCodeAt(i); return h; }
const tests = { codesOf, indexOf, atOf, pointsOf, held, left, found, armed0: l => armed(l, 0), armed3: l => armed(l, 3), armed99: l => armed(l, 99), tried, inner, back, later, twice, pairs, grown, stepped, entries, ofMap, ofGenerator, thrown };
for (let turn = 0; turn < 3; turn++) for (const i of Object.keys(inputs)) for (const t of Object.keys(tests)) { let r; try { r = tests[t](inputs[i]()); } catch (e) { r = e.name; } say([turn, i, t, r, calls].join(" ")); }
for (const i of ["pieces", "ropes", "deep"]) { const l = inputs[i](); for (const t of Object.keys(tests)) say(i + " kept " + tests[t](l)); say(l.join().length + l.map(w => w.length).join()); }
awaited(ropes()).then(h => { say("awaited " + h); console.log("lines", lines, hash, calls); });
