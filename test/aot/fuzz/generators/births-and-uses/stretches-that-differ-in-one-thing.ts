// Stretches of code that do the same but for ONE thing (the constant they answer, the callee, the field, the order of two arguments, what they store), side by side, in code that runs
// once. Whatever shares, merges or outlines equal code must keep them apart: a notion of "equal" that leaves out one kind of difference gives one stretch the other's answer, silently.
// A program is a place (how the stretches stand beside each other), a pad (what they have in common, so that they are worth sharing) and a difference in four to six values.
export function programs() {
  const made: { name: string; file: string; text: string }[] = [];
  // the one thing that differs: a list of texts put at @ in the tail of a stretch; `answer` is an expression
  const differences: Record<string, string[]> = {
    fraction: ["3.5", "21.5", "24.5", "0.125", "-3.5", "1e300"],
    fractionNear: ["0.1", "0.2", "0.30000000000000004", "0.3", "-0.1", "5e-324"],
    integer: ["3", "21", "-3", "0", "2147483647", "-2147483648"],
    bigInteger: ["2147483648", "4294967296", "9007199254740991", "-2147483649", "1e21", "4294967295"],
    zeroes: ["0", "-0", "0.0", "NaN", "Infinity", "-Infinity"],
    string: ['"a"', '"b"', '""', '"a "', '"\\u00e9"', '"e\\u0301"'],
    longString: ['"the first of two long texts that differ at their end 1"', '"the first of two long texts that differ at their end 2"', '"The first of two long texts that differ at their end 1"', '"the first of two long texts that differ at their end 1 "'],
    template: ["`${pad}a`", "`${pad}b`", "`a${pad}`", "`${pad}${pad}`"],
    boolean: ["true", "false", "null", "undefined"],
    bigint: ["1n", "2n", "-1n", "0n", "18446744073709551616n"],
    regexp: ["/a/.source", "/b/.source", "/a/g.flags", "/a/i.flags"],
    symbol: ["Symbol.iterator.description", "Symbol.asyncIterator.description", "Symbol.hasInstance.description", 'Symbol.for("x").description'],
    field: ["box.a", "box.b", "box.c", "box.d", "box.missing"],
    fieldDeep: ["box.in.a", "box.in.b", "box.on.a", "box.on.b"],
    element: ["list[0]", "list[1]", "list[2]", "list[9]", "list[-1]"],
    key: ['box["a"]', 'box["b"]', "box[keyA]", "box[keyB]"],
    callee: ["first()", "second()", "third()", "fourth()"],
    method: ["box.m1()", "box.m2()", "other.m1()", "other.m2()"],
    argument: ["echo(1.5)", "echo(2.5)", 'echo("x")', "echo(1)", "echo()"],
    argumentOrder: ["pair(1.5, 2.5)", "pair(2.5, 1.5)", "pair(1.5, 1.5)", "pair(2.5, 2.5)"],
    operator: ["x + y", "x - y", "x * y", "x / y", "x % y", "x ** y"],
    compare: ["x < y", "x <= y", "x > y", "x >= y", "x == y", "x != y"],
    bits: ["x | y", "x & y", "x ^ y", "x << y", "x >> y", "x >>> y"],
    operandOrder: ["x - y", "y - x", "x / y", "y / x"],
    variable: ["x", "y", "z", "w"],
    builtin: ["Math.floor(q)", "Math.ceil(q)", "Math.round(q)", "Math.trunc(q)", "Math.abs(q)", "Math.sign(q)"],
    typeofText: ['typeof x === "number"', 'typeof x === "string"', 'typeof t === "string"', 'typeof t === "number"'],
    literalObject: ["JSON.stringify({ a: 1.5 })", "JSON.stringify({ a: 2.5 })", "JSON.stringify({ b: 1.5 })", "JSON.stringify({ a: 1.5, b: 1.5 })"],
    literalArray: ["JSON.stringify([1.5, 2.5])", "JSON.stringify([2.5, 1.5])", "JSON.stringify([1.5])", "JSON.stringify([1.5, 2.5, 2.5])"],
    thrown: ['(() => { try { throw new RangeError("r1"); } catch (e) { return e.name + e.message; } })()', '(() => { try { throw new RangeError("r2"); } catch (e) { return e.name + e.message; } })()', '(() => { try { throw new TypeError("r1"); } catch (e) { return e.name + e.message; } })()'],
    made: ["new P1().tag", "new P2().tag", "new P1(1).tag", "new P2(1).tag"],
    foldedConstant: ["Math.PI", "Math.E", "Math.SQRT2", "Number.EPSILON", "Number.MAX_VALUE", "Number.MIN_VALUE"],
    foldedCall: ["Math.sqrt(2)", "Math.sqrt(3)", "Math.pow(2, 0.5)", "Math.pow(3, 0.5)", "1 / 3", "2 / 3"],
    captured: ["(() => x)()", "(() => y)()", "(() => z)()", "(() => q)()"],
    closureKept: ["keep(() => 1.5)()", "keep(() => 2.5)()", "keep(() => x)()", "keep(() => q)()"],
    receiver: ["who.call(box)", "who.call(other)", "who.call(sink)", "who.call(list)"],
    argumentCount: ["count(1.5)", "count(1.5, 2.5)", "count()", "count(1.5, 2.5, 3.5)"],
    spreadList: ["count(...[1.5])", "count(...[1.5, 2.5])", "count(...list)", "count(...[])"],
    optional: ["box?.a", "w?.a", "box.in?.a", "box.off?.a"],
    inKey: ['"a" in box', '"zz" in box', '"m1" in other', '"a" in other'],
    instance: ["k1 instanceof P1", "k1 instanceof P2", "k2 instanceof P1", "k2 instanceof P2"],
    defaulted: ["((v = 1.5) => v)()", "((v = 2.5) => v)()", "((v = -0) => v)()", "((v = 1n) => v)()"],
    destructured: ["(({ a }) => a)(box)", "(({ b }) => b)(box)", "(({ a = 9.5 }) => a)(other)", "(({ a = 8.5 }) => a)(other)"],
    nested: ["[[1.5]][0][0]", "[[2.5]][0][0]", "({ n: { m: 1.5 } }).n.m", "({ n: { m: 2.5 } }).n.m"],
    stringNumber: ['Number("1.5")', 'Number("2.5")', 'parseFloat("1.5x")', 'parseFloat("2.5x")'],
    concatenated: ['"v" + 1.5', '"v" + 2.5', '1.5 + "v"', '2.5 + "v"'],
    negated: ["-x", "+x", "~x", "!x", "-q", "+q"],
    comparedWith: ["x === 7.5", "x === 2.5", "q === -2.5", "q === 2.5"],
    clamped: ["Math.min(x, 1.5)", "Math.min(x, 2.5)", "Math.max(x, 8.5)", "Math.max(x, 9.5)"],
    fixed: ["x.toFixed(1)", "x.toFixed(2)", "q.toFixed(1)", "q.toFixed(3)"],
    date: ["new Date(1.5e12).getUTCFullYear()", "new Date(0.5e12).getUTCFullYear()", "new Date(1e12).getUTCMonth()", "new Date(1.2e12).getUTCMonth()"],
    typedArray: ["new Float64Array([1.5])[0]", "new Float64Array([2.5])[0]", "new Float32Array([1.5])[0]", "new Int8Array([1.5])[0]"],
    symbolKey: ["typeof list[Symbol.iterator]", "typeof list[Symbol.asyncIterator]", "typeof box[Symbol.iterator]", "typeof t[Symbol.iterator]"],
  };
  // differences that are statements: what is STORED or DONE differs, the answer is the same
  const effects: Record<string, string[]> = {
    storedFraction: ["sink.v = 3.5", "sink.v = 21.5", "sink.v = 0.125", "sink.v = -3.5"],
    storedField: ["sink.a = 1.5", "sink.b = 1.5", "sink.c = 1.5", "sink.d = 1.5"],
    storedVariable: ["g1 = 1.5", "g2 = 1.5", "g3 = 1.5", "g4 = 1.5"],
    storedElement: ["list[0] = 9.5", "list[1] = 9.5", "list[2] = 9.5", "list[5] = 9.5"],
    storeOrder: ["sink.a = 1.5; sink.a = 2.5", "sink.a = 2.5; sink.a = 1.5", "sink.a = 1.5; sink.b = 2.5", "sink.b = 2.5; sink.a = 1.5"],
    pushed: ["log.push(1.5)", "log.push(2.5)", 'log.push("1.5")', "log.unshift(1.5)"],
    calledFor: ["touch(1.5)", "touch(2.5)", "touch2(1.5)", "touch2(2.5)"],
    deleted: ["delete sink.a", "delete sink.b", "sink.a = undefined", "sink.b = undefined"],
  };
  const pads: Record<string, string> = {
    stores: "a = 1; b = 2; c = 3; d = 4; e = 5;",
    calls: "touch(0); touch(0); touch(0); touch(0);",
    text: 'pad = pad + "p"; pad = pad + "q"; pad = pad.slice(0, 4); a = pad.length;',
    none: "",
  };
  const head = `var a = 0, b = 0, c = 0, d = 0, e = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, pad = "", x = 7.5, y = 2, z = "zed", w = null, q = -2.5, t = "t", keyA = "a", keyB = "b";
  var box = { a: 1.5, b: 2.5, c: "see", d: null, in: { a: 10.5, b: 11.5 }, on: { a: 12.5, b: 13.5 }, m1() { return "box1"; }, m2() { return "box2"; } }, other = { m1() { return "other1"; }, m2() { return "other2"; } };
  var list = [0.5, 1.5, 2.5], sink = { a: 0, b: 0 }, log = [], touched = [];
  function first() { return "first"; } function second() { return "second"; } function third() { return 3.5; } function fourth() { return 4.5; }
  function echo(v) { return typeof v + ":" + v; } function pair(m, n) { return m + "," + n; } function touch(v) { touched.push(v); } function touch2(v) { touched.push("2:" + v); }
  class P1 { constructor(n) { this.tag = "p1" + n; } } class P2 { constructor(n) { this.tag = "p2" + n; } }
  var k1 = new P1(0), k2 = new P2(0); function keep(f) { touched.length; return f; } function who() { return Object.keys(this).join(); } function count() { return arguments.length + ":" + Array.prototype.join.call(arguments); }
  function show(v) { return typeof v === "number" && v === 0 && 1 / v < 0 ? "-0" : typeof v === "bigint" ? v + "n" : String(v); }
  function state() { return JSON.stringify([sink, list, log, touched.length, touched.slice(-2), g1, g2, g3, g4, a, b, c, d, e, pad]); }
  `;
  // how the stretches stand beside each other; `arms` = [{ before, answer }]
  type Arm = { before: string; comma?: string; answer: string };
  const places: Record<string, (arms: Arm[]) => string> = {
    switchReturn: arms => `function pick(k) {\n  switch (k) {\n${arms.map((s, i) => `    case ${i}: ${s.before} return ${s.answer};`).join("\n")}\n  }\n}\nfor (let k = 0; k < ${arms.length}; k++) console.log(k, show(pick(k)), state());`,
    ifChain: arms => `function pick(k) {\n${arms.map((s, i) => `  if (k === ${i}) { ${s.before} return ${s.answer}; }`).join("\n")}\n}\nfor (let k = 0; k < ${arms.length}; k++) console.log(k, show(pick(k)), state());`,
    functions: arms => arms.map((s, i) => `function f${i}() { ${s.before} return ${s.answer}; }`).join("\n") + `\n` + arms.map((s, i) => `console.log(${i}, show(f${i}()), state());`).join("\n"),
    arrows: arms => `const table = [\n${arms.map(s => `  () => { ${s.before} return ${s.answer}; },`).join("\n")}\n];\nfor (let k = 0; k < table.length; k++) console.log(k, show(table[k]()), state());`,
    methods: arms => `class K {\n${arms.map((s, i) => `  m${i}() { ${s.before} return ${s.answer}; }`).join("\n")}\n}\nconst k0 = new K();\n` + arms.map((s, i) => `console.log(${i}, show(k0.m${i}()), state());`).join("\n"),
    topLevel: arms => arms.map((s, i) => `{ ${s.before} const r${i} = ${s.answer}; console.log(${i}, show(r${i}), state()); }`).join("\n"),
    conditional: arms => `const now = Date.now() > 0 ? 1 : 0;\n` + arms.slice(1).map((s, i) => `{ const r = now === 0 ? (${arms[0].comma}${arms[0].answer}) : (${s.comma}${s.answer}); console.log(${i}, show(r), state()); }`).join("\n"),
    catchArms: arms => `function pick(k) {\n${arms.map((s, i) => `  try { if (k === ${i}) throw k; } catch (err) { ${s.before} return ${s.answer}; }`).join("\n")}\n}\nfor (let k = 0; k < ${arms.length}; k++) console.log(k, show(pick(k)), state());`,
    asyncFunctions: arms => arms.map((s, i) => `async function f${i}() { await null; ${s.before} return ${s.answer}; }`).join("\n") + `\n` + arms.map((s, i) => `console.log(${i}, show(await f${i}()), state());`).join("\n"),
    generators: arms => `function* g() {\n${arms.map(s => `  { ${s.before} yield ${s.answer}; }`).join("\n")}\n}\nlet n = 0; for (const v of g()) console.log(n++, show(v), state());`,
  };
  // a function is cold where it is called once: for these places one program an arm: the arm is chosen at run time
  const once: Record<string, (arms: Arm[], k: number) => string> = {
    switchOnce: (arms, k) => `function pick(k) {\n  switch (k) {\n${arms.map((s, i) => `    case ${i}: ${s.before} return ${s.answer};`).join("\n")}\n  }\n}\nconsole.log(${k}, show(pick(Date.now() > 0 ? ${k} : 0)), state());`,
    ifOnce: (arms, k) => `function pick(k) {\n${arms.map((s, i) => `  if (k === ${i}) { ${s.before} return ${s.answer}; }`).join("\n")}\n}\nconsole.log(${k}, show(pick(Date.now() > 0 ? ${k} : 0)), state());`,
    catchOnce: (arms, k) => `function pick(k) {\n${arms.map((s, i) => `  try { if (k === ${i}) throw k; } catch (err) { ${s.before} return ${s.answer}; }`).join("\n")}\n}\nconsole.log(${k}, show(pick(Date.now() > 0 ? ${k} : 0)), state());`,
    assignOnce: (arms, k) => `let r; const k = Date.now() > 0 ? ${k} : 0;\nswitch (k) {\n${arms.map((s, i) => `  case ${i}: ${s.before} r = ${s.answer}; break;`).join("\n")}\n}\nconsole.log(${k}, show(r), state());`,
  };
  const comma = (text: string) => text.split(";").map(s => s.trim()).filter(Boolean).map(s => s + ", ").join("");
  for (const [p, place] of Object.entries(places)) for (const [pd, padText] of Object.entries(pads)) {
    for (const [d, values] of Object.entries(differences)) { const arms = values.map(v => ({ before: padText, comma: comma(padText), answer: v })); made.push({ name: `${p}-${pd}-${d}`, file: "program.mjs", text: head + place(arms) + "\n" }); }
    for (const [d, values] of Object.entries(effects)) { if (p === "conditional" && /delete|;/.test(values.join(""))) continue; const arms = values.map(v => ({ before: padText + " " + v + ";", comma: comma(padText + " " + v), answer: "0.5" })); made.push({ name: `${p}-${pd}-effect-${d}`, file: "program.mjs", text: head + place(arms) + "\n" }); }
  }
  for (const [p, place] of Object.entries(once)) for (const [pd, padText] of Object.entries(pads)) {
    for (const [d, values] of Object.entries(differences)) { const arms = values.map(v => ({ before: padText, answer: v })); for (let k = 0; k < arms.length; k++) { made.push({ name: `${p}-${pd}-${d}-${k}`, file: "program.mjs", text: head + place(arms, k) + "\n" }); } }
    for (const [d, values] of Object.entries(effects)) { const arms = values.map(v => ({ before: padText + " " + v + ";", answer: "0.5" })); for (let k = 0; k < arms.length; k++) { made.push({ name: `${p}-${pd}-effect-${d}-${k}`, file: "program.mjs", text: head + place(arms, k) + "\n" }); } }
  }
  return made;
}
