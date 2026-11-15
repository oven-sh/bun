// includes() and indexOf() of short strings: each place, each length, narrow and wide, ropes, pieces, other receivers and other arguments.
"use strict";
const out = [];
const run = (work) => { try { const value = work(); return typeof value + ":" + String(value); } catch (error) { return error.constructor.name; } };
const has = (string, sought) => string.includes(sought);
const at = (string, sought) => string.indexOf(sought);
const first = (string) => string.indexOf("\\");
const named = (node) => node.type.includes("Function");
const long = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const make = [(s) => s, (s) => (s + "!").slice(0, s.length), (s) => ("<" + s).slice(1), (s) => s.split("").join(""), (s) => s.slice(0, s.length >> 1) + s.slice(s.length >> 1), (s) => JSON.parse(JSON.stringify(s)), (s) => (s + "Ā").slice(0, s.length), (s) => s + "Ā", (s) => "Ā" + s, (s) => "é" + s + "ÿ"];
let sum = 0;
for (let length = 0; length <= 40; length++) for (let from = 0; from < make.length; from++) {
  const string = make[from](long.slice(0, length));
  for (let start = 0; start <= string.length; start += length > 12 ? 5 : 1) for (const count of [0, 1, 2, 3, 8, 9]) {
    const sought = make[(from + start) % 6](string.slice(start, start + count));
    const a = string.includes(sought), b = string.indexOf(sought), c = has(string, sought), d = at(string, sought), e = has(string, sought + "~"), f = at(string, "~" + sought), g = has(sought, string);
    if (a !== (b >= 0) || a !== c || b !== d || (a && string.slice(b, b + sought.length) !== sought) || e || f !== -1 || g !== (sought === string || string === "" || (sought.length > string.length))) out.push(["wrong", length, from, start, count, a, b, c, d, e, f, g].join());
    sum += b + (a ? 1 : 0);
  }
  out.push(length + " " + from + " " + sum + first(string) + first(string + "\\") + first("\\" + string) + has(string, "bc") + has(string, "Ā") + has(string, "bĀ") + at(string, "") + has(string, "undefined"));
}
for (const type of ["Identifier", "FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "Function", "Functio", "unction", "FFunction", "FuFunction", "FunFunctioFunction", "xFunctio", "", "F", "Fu", "MemberExpression", "ĀFunction", "FunctiĀn", "FunctionFunctionFunctionFunctionFunctionFunction", "x".repeat(31) + "Function", "x".repeat(32) + "Function", "x".repeat(33) + "Function", "x".repeat(40)]) for (let round = 0; round < 30; round++) { const answer = named({ type }) + " " + named({ type: type + "" }) + named({ type: [type] }) + named({ type: ["Function", type] }); if (round === 29) out.push(type.slice(0, 20) + answer); }
for (const strange of [null, undefined, 1, {}, [], ["Function"], /Function/, Symbol("Function"), new String("a Function"), { includes(s) { return "own " + s; } }, Object.create({ includes: () => 7 }), { includes: 5 }, new Uint8Array(3), "Function" + 1, 10n, () => 1]) { out.push(run(() => named({ type: strange })), run(() => "a Function and more".includes(strange)), run(() => "a [object Object] null undefined 1".includes(strange)), run(() => "a1".indexOf(strange)), run(() => has(strange, "Function")), run(() => at(strange, "n"))); }
for (const places of [[], ["b", 1], ["b", 2], ["b", -1], ["b", NaN], ["b", 1e9], ["bc", 1, 2], [undefined], ["b", { valueOf() { out.push("valueOf"); return 1; } }], [{ toString() { out.push("toString"); return "bc"; } }]]) out.push(run(() => "abcabc".includes(...places)), run(() => "abcabc".indexOf(...places)));
for (const line of out) console.log(line.slice(0, 200));
