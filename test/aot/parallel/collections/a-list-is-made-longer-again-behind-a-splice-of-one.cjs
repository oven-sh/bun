"use strict";
const say = [], hide = v => [v][JSON.parse("0")], cut = (a, s, c) => a.splice(s, c), list = a => a.length + "[" + Array.from({ length: a.length }, (_, i) => (i in a ? String(a[i]) : "_")).join() + "]";
const t = (n, f) => { try { say.push(n + ":" + f()); } catch (e) { say.push(n + "!" + e.name); } };
const kinds = { ints: () => JSON.parse("[1,2,3,4]"), texts: () => JSON.parse('["a","b","c","d"]'), mixed: () => JSON.parse('[1,"b",null,4]'), objects: () => JSON.parse('[{"v":1},{"v":2},{"v":3}]') };
for (const [n, k] of Object.entries(kinds)) for (const s of [0, 1, -1]) { const a = k(); hide(cut)(a, s, 1); a.length++; t(n, () => list(a) + (a.length - 1 in a)); a[a.length + 1] = "far"; t(n, () => list(a)); hide(cut)(a, 0, 1); a.length += 2; t(n, () => list(a) + Object.keys(a).length); }
console.log(say.join(" "));
