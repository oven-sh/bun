"use strict";
const any = v => [v][JSON.parse("0")], out = [], say = (...x) => out.push(x.map(v => typeof v + String(v)).join());
const V = new Set(["br", "img", "title", "a", "0", "10", "__proto__", "constructor", "\u0416\u0416", "\u00e9t\u00e9"]), M = new Map([["br", 1], ["td", "cell"], ["10", "ten"], ["__proto__", "p"], ["li", null], ["q", undefined]]);
const cut = (t, f) => { let at = 0; while (at < t.length) { const e = t.indexOf(" ", at); f(t.slice(at, e), at); at = e + 1; } };
const ask = p => { for (let k = 0; k < 5; k++) say(V.has(p), M.has(p), M.get(p)); };
for (let round = 0; round < 12; round++) { out.length = 0; cut(any("br \u0416\u0416 img x\u0416 td \u0416 "), p => { ask(p); say(p, p.codePointAt(0), p === "br"); }); }
console.log(out.length, out.join("|").slice(0, 6000));
