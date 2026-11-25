// Evaluated text runs in the interpreter of an executable: typeof of values of every kind, values pushed onto arrays of every kind, and functions with any number of variables that are read before they are written.
const values = ["0", "-1", "2147483648", "1.5", "-0", "NaN", "undefined", "null", "true", "false", "'s'", "text + number", "Symbol.iterator", "10n", "{}", "[1]", "function () {}", "() => 1", "class {}", "async () => {}", "new Proxy({}, {})", "new Proxy(function () {}, {})", "compiled", "compiledClass", "compiledBound", "Math", "Math.max", "new Map", "/re/", "Object('s')", "globalThis", "new Uint8Array(2)", "arguments", "this", "undeclared"];
const arrays = ["[]", "[1]", "[1, 2, 3]", "[1.5]", "['a']", "[{}]", "[, 1]", "new Array(5)", "Array.from({ length: 4 }, (_, i) => i)", "Object.freeze([1])", "Object.seal([1])", "Object.preventExtensions([1])", "Object.freeze([])", "Object.defineProperty([1, 2], 'length', { writable: false })", "new Sub(1, 2)", "new Proxy([], {})", "({ length: 2 })", "literal()", "literal()", "[1, 2].concat('x')", "compiledList()", "compiledNumbers()", "(() => { const x = [1]; x[100000] = 2; return x; })()", "Object.setPrototypeOf([1, 2], { set 2(v) { log('set ' + typeof v); }, __proto__: Array.prototype })", "'text'", "null", "new Uint8Array(3)"];
const lines = [];
globalThis.log = x => { lines.push(String(x)); };
globalThis.show = x => (Array.isArray(x) ? "[" + Array.from({ length: Math.min(60, x.length) }, (_, i) => (i in x ? (typeof x[i] === "object" && x[i] ? "o" : typeof x[i] === "function" ? "f" : typeof x[i] + String(x[i])) : "hole")).join() + "]" + x.length : typeof x);
globalThis.attempt = (f, x) => { let r; try { r = f(); log("= " + (Object(r) === r ? typeof r : String(r))); } catch (e) { log(e.name + ": " + e.message); } log(show(x)); };
globalThis.Sub = class Sub extends Array {};
globalThis.literal = () => [1, 2, "three"];
globalThis.compiled = function () { return 1; };
globalThis.compiledClass = class { m() {} };
globalThis.compiledBound = compiled.bind(1);
globalThis.compiledList = () => [{ a: 1 }, { a: 2 }];
globalThis.compiledNumbers = () => { const x = []; for (let i = 0; i < 6; i++) x.push(i * 1.5); return x; };
let text = "(function (text, number) {";
for (const v of values) text += `log(typeof (${v})); log(typeof (${v}) === "function"); switch (typeof (${v})) { case "object": log("o"); break; case "undefined": log("u"); break; default: log("d"); }`;
text = text.replaceAll("typeof (undeclared)", "typeof undeclared");
for (const a of arrays) for (const v of ["1", "1.5", "'s'", "[1]", "undefined", "i", "text + i", "log"])
  text += `{ const x = ${a}; for (let i = 0; i < 9; i++) attempt(() => x.push(${v}), i & 3 ? 0 : x); }`;
for (const a of arrays) text += `{ const x = ${a}; attempt(() => x.push(), x); attempt(() => x.push(1, "2"), x); attempt(() => Array.prototype.push.call(x, 3), x); attempt(() => Reflect.apply(Array.prototype.push, x, [{}]), x); attempt(() => x.push(...[5, 6]), x); attempt(() => [7, 8].forEach(x.push.bind(x)), x); }`;
text += "{ const list = []; for (let i = 0; i < 20000; i++) { list.push({ i }); list.push(list.length & 1 ? text + i : i / 2); if (list.length > 3000) list.length = i % 100; } log(list.length + show(list.slice(0, 30))); }";
for (let parameters = 0; parameters < 4; parameters++) for (let variables = 0; variables < 12; variables++) {
  const names = Array.from({ length: variables }, (_, i) => "v" + i);
  const all = ["''", ...names.map(n => `typeof ${n} + ${n}`)].join(" + ',' + ");
  text += `log((function (${Array.from({ length: parameters }, (_, i) => "p" + i).join()}) { ${names.map(n => `var ${n};`).join("")} const first = ${all}; ${names.map((n, i) => (i % 2 ? `${n} = ${i};` : "")).join("")} const inner = () => { ${names.slice(0, 2).map(n => n + "++;").join("")} return [${names.join()}].join(); }; return first + (parameters => parameters)(${parameters ? "p0" : 0}) + inner() + (1 + ${variables} * (2 + ${parameters} * (3 + number))) + ${all}; })(${Array.from({ length: (parameters + variables) % 5 }, (_, i) => i).join()}));`;
}
(0, eval)(text + '}).call(globalThis, "a", 7);');
let hash = 0;
for (const line of lines) for (let i = 0; i < line.length; i++) hash = (Math.imul(hash, 31) + line.charCodeAt(i)) | 0;
console.log(lines.length, hash);
for (let i = 0; i < lines.length; i += 29) console.log(i, lines[i].slice(0, 160));
