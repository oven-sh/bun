// A loop stores under what it reads out of a list, and what it stores is read out of the same: `o[words[i]] = words[i][0]`. What is a key is no list of elements: five of these forms ended the build by a signal.
// The loops beside them move elements, or store under an element of a row, and stay what they are.
// STATISTIC: ElementMoveLoops >= 6
"use strict";
const out = [];
function initials(words) { const o = {}; for (let i = 0; i < words.length; i++) o[words[i]] = words[i][0]; return o; }
function places(words) { const o = []; for (let i = 0; i < words.length; i++) { const w = words[i]; o[w] = w[i]; } return o; }
function heads(rows) { const o = []; for (let i = 0; i < rows.length; i++) { const r = rows[i]; o[r] = r[0]; } return o; }
function into(words, o, n) { for (let i = 0; i < n; i++) { const w = words[i]; o[w] = w[0]; } return o; }
function intoObject(words) { return into(words, {}, words.length); }
function intoArray(words) { return into(words, [], words.length); }
function ofWords(words) { const o = {}; for (const w of words) o[w] = w[0]; return o; }
function upper(words) { const o = {}; for (const w of words) o[w] = String(w)[0] + ""; return o; }
function forEach(words) { const o = {}; words.forEach(w => { o[w] = w[0]; }); return o; }
function reduced(words) { return words.reduce((m, w) => { m[w] = w[0]; return m; }, {}); }
function ofKeys(words) { const src = {}; for (const w of words) src[w] = 1; const o = {}; for (const k of Object.keys(src)) o[k] = k[0]; return o; }
function inKeys(words) { const src = {}; for (const w of words) src[w] = 1; const o = {}; for (const k in src) o[k] = k[0]; return o; }
function groups(words) { const o = {}; for (const w of words) (o[w[0]] ||= []).push(w); return o; }
function flags(words) { const o = {}; for (let i = 0; i < words.length; i++) { const w = words[i]; if (w[0] === "-") o[w] = true; } return o; }
function skipping(words) { const o = {}; for (let i = 0; i < words.length; i++) { if (words[i][0] === "#") continue; o[words[i]] = 1; } return o; }
function cached(words) { const o = {}; for (let i = 0; i < words.length; i++) { const k = words[i]; if (o[k] === undefined) o[k] = k[0]; } return o; }
function pairs(rows) { const o = {}; for (let i = 0; i < rows.length; i++) { const p = rows[i]; o[p[0]] = p[1]; } return o; }
function lengths(words) { const l = {}, o = {}; for (let i = 0; i < words.length; i++) { const w = words[i]; l[w] = w.length; o[w] = i; } return [l, o]; }
function column(rows, n) { const o = []; for (let i = 0; i < n; i++) o[i] = rows[i][0]; return o; }
function moved(list, n) { const o = new Array(n).fill(0); for (let i = 0; i < n; i++) o[i] = list[i]; return o; }
function turned(rows, n) { const o = []; for (let i = 0; i < n; i++) { const r = rows[i]; o[r[0]] = r[1]; } return o; }
const names = JSON.parse("{}");
function hidden(f) { names[f.name + process.pid] = f; return names[f.name + process.pid]; }
const lists = [["alpha", "beta", "-x", "#c", "_p", "/r", "ab", "7", "12", "0"], [[0, 7], [1, 8], [2, 9]], [["a", "b"], ["c", "d"], []], [0, 1, 2], [3.5, -0, NaN], [true, "x"], ["x", , "y"], [null, "x"], [undefined], [{}, { 0: 1 }], [], [[[1], 2], [[3], 4]], [10n, "1"]];
const show = v => { const r = JSON.stringify(v, (k, x) => typeof x === "bigint" ? x + "n" : Object.is(x, -0) ? "-0" : x === undefined ? "undefined" : x !== x ? "NaN" : x); return r + (v && typeof v === "object" ? " " + Object.keys(v).join() : ""); };
function say(run) { try { out.push(show(run())); } catch (e) { out.push(e.constructor.name); } }
for (const f of [initials, places, heads, intoObject, intoArray, ofWords, upper, forEach, reduced, ofKeys, inKeys, groups, flags, skipping, cached, pairs, lengths])
    for (const list of lists) { say(() => f(list)); say(() => hidden(f)(list)); }
for (const f of [column, moved, turned]) for (const list of lists) for (const n of [list.length, list.length + 1]) { say(() => f(list, n)); say(() => hidden(f)(list, n)); }
for (let t = 0; t < 60; t++) for (const f of [initials, heads, intoObject, intoArray, pairs]) { const r = hidden(f)(t & 1 ? lists[0] : lists[1]); if (t > 57) out.push(f.name + show(r)); }
console.log(out.join("\n"));
