// A text that grows by a character is asked for its end and its beginning, twice, beside joins of three parts, wide characters and a text of 20,000.
const out = [], o = JSON.parse('{"t":""}');
for (const [whole, end] of [["a\r\n\r\nbc\r\n\r\n\n", "\r\n\r\n"], ["xyzxyz", "yz"], ["h\u00e9\u0142\u0142o", "\u0142o"], ["aaaa", "aa"], ["ab", "abc"], ["q", ""], ["\ud83d\ude00x\ud83d", "\ud83d"]]) { o.t = ""; let hits = ""; for (const c of whole) { o.t += c; hits += o.t.endsWith(end) ? "1" : "0"; hits += o.t.endsWith(end) ? "1" : "0"; hits += o.t.startsWith(end, 1) ? "s" : "-"; hits += o.t.endsWith(end, o.t.length - 1) ? "e" : "."; } out.push(hits, o.t.length); }
const join = (a, b, c) => a + b + c;
for (const e of ["c", "bc", "abc", "xabc", "\u0100", "b", "ab", "\u00ff"]) { const p = join(o.t, "ab".slice(0, 2), "c"); out.push(p.endsWith(e), p.endsWith(e), p.startsWith(e), (p + p).endsWith(e + e), join("", p, "").endsWith(e), join(p, e, "").endsWith(e), join(p, "", e).endsWith(p)); }
let x = o.t, hits = ""; for (const c of "a\r\nb\r\n\r\n") { x += c; hits += +x.endsWith("\r\n\r\n") + "" + +x.endsWith("\n"); }
const q = join("ab".slice(0, 2), "\u0142o", "c"), e = ["c", "oc", "\u0142oc", "b\u0142oc", "x", "\u0142", "bc", ""].map(y => +q.endsWith(y)).join(""), v = ["ab", "a\u0142", "ab\u0142"].map(y => +q.startsWith(y)).join("");
let d = JSON.parse('{"t":""}').t; for (let i = 0; i < 20000; i++) { d += "x"; if (d.endsWith("yy")) throw 0; if (i % 5000 === 4999 && !d.endsWith("xx")) throw 1; }
out.push(hits, x.length, e, v, +q.startsWith("b", 1), +q.endsWith("b", 2), +q.endsWith("\u0142", 3), d.length, d.endsWith("xx"), d.charCodeAt(19999));
console.log(out.join());
