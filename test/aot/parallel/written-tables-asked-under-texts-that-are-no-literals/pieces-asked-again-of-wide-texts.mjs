"use strict";
const any = v => [v][JSON.parse("0")], out = [], say = (...x) => out.push(x.map(v => typeof v + String(v)).join());
const T = any("div span br img table td th li p a title script \u00e9t\u00e9 "), V = new Set(["br", "img", "title", "a", "\u00e9t\u00e9"]), M = new Map([["br", 1], ["td", "cell"], ["p", "\u0416"], ["li", 0.5]]);
const cut = (t, f) => { let at = 0; while (at < t.length) { const e = t.indexOf(" ", at); f(t.slice(at, e), at); at = e + 1; } };
for (let round = 0; round < 12; round++) { out.length = 0; const w = any("br \u0416 img td\u0416 td \u00e9t\u00e9 "); cut(w, p => { for (let k = 0; k < 5; k++) say(V.has(p), M.get(p)); say(p, p.codePointAt(0)); }); }
console.log(out.length, out.join("|").slice(0, 4000));
