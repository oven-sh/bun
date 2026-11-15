let heard = 0;
const each = w => { let o = ""; for (const c of w) o += c === "-" ? "_" : c; return o; };
const index = t => { let o = ""; for (let i = 0; i < t.length; i++) { const c = t[i]; o += c === "-" ? "_" : c; } return o; };
const either = t => { let o = "<"; for (const c of t) { let p = c; if (c === "a") p = "aa"; else if (c === "b") p = "bb"; o += p; o += ";"; } return o; };
const template = t => { let o = ""; for (const c of t) o += `${c === "-" ? "_" : c}|`; return o; };
const escaped = t => { let o = ""; for (let i = 0; i < t.length; i++) { switch (t[i]) { case "<": o += "&lt;"; break; case "&": o += "&amp;"; break; default: o += t[i]; } } return o; };
const chosen = (t, other) => { let o = ""; for (const c of t) o += c === "-" ? other : "x"; return o; };
const numbers = t => { let o = ""; for (const c of t) o += c === "-" ? 1 : c; return o; };
const joined = t => { let o = ""; for (const c of t) o += (c === "-" ? "_" : c) + (c === "a" ? "!" : c); return o; };
const front = t => { let o = ""; for (const c of t) o = (c === "-" ? "_" : c) + o; return o; };
const raw = process.argv.length > 99 ? "[]" : '["a-b-c","","-","--","é-ü","\\ud83d\\ude00-x","<a>&b",["a","-",1,2.5,null,true,"long words"],[],["-",{}],[[1,2],"-"],{"0":"a","length":1},5]';
const values = () => JSON.parse(raw);
const odd = () => [["-", undefined, -0, NaN, 12n, "q"], ["-", Symbol.iterator], ["-", { toString() { heard++; return "spoken"; } }], ["-", { valueOf: () => (heard += 10, 7) }], ["-", { toString() { throw new RangeError("part"); } }], new String("a-b"), new Set(["-", "a"]), "a-".repeat(40), "é-".repeat(40), [..."-<&a"], Object.assign(["-", "b"], { length: 2 })];
const show = v => JSON.stringify(v) ?? String(v);
const attempt = run => { try { return show(run()); } catch (error) { return error.constructor.name; } };
for (let round = 0; round < 3; round++)
  for (const v of [...values(), ...odd()]) console.log([each, index, either, template, escaped, numbers, joined, front].map(run => attempt(() => run(v))).join(" "), attempt(() => chosen(v, "_")), attempt(() => chosen(v, 7)), attempt(() => chosen(v, { toString: () => "o" })), heard);
