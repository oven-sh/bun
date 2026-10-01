"use strict";
const fs = require("fs");
const rnd = require("./rng.cjs")(31);
const pick = a => a[rnd(a.length)];
const triv = ["", "", " ", "\n", " \n ", "/* c */", " /* c\n */ ", " // c\n", "\n// `\n", "\t", "\r\n", " /* ` */\n", " // (\n", "\n// [ (\n  ", "/* ( */", "\u2028", "\u00a0", " \u00a0\n"];
const tags = ["f", "(f)", "f.g", "f()", "f[0]", "new F", "f`t`", "a?.b.c", "(f\n)", "this", "String.raw", "`u`", "f`a${1}b`", "(a, b)", "(a + b`q`)", "/re/", "f<1"];
const quasis = ["`x`", "`x${1}y`", "`x\r\ny`", "``", "`${a}`", "`x\ny${1}`"];
fs.mkdirSync("gen2", { recursive: true }); fs.mkdirSync("gen3", { recursive: true });
let n = 0;
for (let i = 0; i < 6000; i++) fs.writeFileSync(`gen2/t${n++}.js`, `y = ${pick(tags)}${pick(triv)}${pick(quasis)}${pick(["", pick(triv) + pick(quasis)])};\n`);
const A = ["a", "(a)", "a.b", "f(x)", "(a\n)", "a[0]", "`t`", "/re/g", "1"];
const B = ["b", "(b)", "b.c", "b()", "( b )", "2", "((b))"];
const C = ["g", "gi", "y", "g.test(x)", "g[0]", "g++", "gx", "x", "(g)", "dgimsuvy", "g`t`", "g**2", "G", "s.m", "is", "2", "/re/"];
for (let i = 0; i < 8000; i++) fs.writeFileSync(`gen3/d${n++}.js`, `x = ${pick(A)}${pick(triv)}/${pick(triv)}${pick(B)}${pick(triv)}/${pick(["", "", "", " ", "/**/", "\n"])}${pick(C)};\n`);
const T = ["f", "(f)", "f.g", "f()", "f[0]", "new F", "f`t`", "a?.b", "(f\n)", "this", "/re/", "f.g /* c */", "<a/>"];
for (let i = 0; i < 10000; i++) {
  const k = rnd(2); const t1 = pick(triv), t2 = pick(triv), t3 = pick(["", "", "(", "( "]);
  fs.writeFileSync(`gen3/c${n++}.js`, k === 0 ? `y = ${pick(T)}${t1}(${t2}${t3}${pick(["a", "...a", "a, b", "`t`", "/re/", "[a]", "a + b"])}${t3 ? ")" : ""});\n` : `y = ${pick(T)}${t1}[${t2}${t3}${pick(["a", "0", "[a]", "a + b", "`t`"])}${t3 ? ")" : ""}];\n`);
}
console.log(n);
