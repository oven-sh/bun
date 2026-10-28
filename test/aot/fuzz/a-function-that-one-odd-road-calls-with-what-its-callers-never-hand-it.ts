// Small programs about one function whose written calls all hand it values of one kind, and one more call that comes by an odd road with another kind, another number of arguments or another `this`. The
// function works on whatever arrives, as the language says. There is one scene, and every line is printed at once, by `console.log` itself.
//
//   the function   sums, compares, indexes a list, reads a member, calls a method, joins texts, counts in a loop, tests with `typeof`; declared, an arrow in a `const`, a method, a static method
//   its callers    none, one or three written calls with small whole numbers, with texts, with objects of one shape
//   the odd road   a callback of `map`, `forEach`, `reduce`, `sort`, `replace`, `Array.from`, `JSON.parse`, `then`, a timer; `call`, `apply`, `bind`, `Reflect.apply`, `new`, a tag, a getter, `valueOf`,
//                  a member under a computed key, a list it was put into, `globalThis`, another file, `arguments` of another function handed on by a spread
//   what arrives   a fraction, a large number, `NaN`, `-0`, a text, `undefined`, nothing at all, `null`, an object, a list, a BigInt, a symbol, a function, more arguments than there are parameters
import type { Random } from "./random";

export function generate(random: Random): { file: string; text: string; files?: Record<string, string> } {
  const kind = random.weighted([
    [6, "numbers"],
    [3, "texts"],
    [4, "objects"],
  ] as const);
  const bodies: Record<typeof kind, string[]> = {
    numbers: [
      "return a + b;",
      "return a * 2 + b;",
      "return a < b ? a : b;",
      "return [10, 20, 30, 40][a] + b;",
      "return (a | 0) + (b >>> 0);",
      "let sum = 0;\nfor (let i = 0; i < a && i < 5; i++) sum += b;\nreturn sum;",
      'return typeof a === "number" ? a + 1 : "no number: " + typeof a;',
      "return a - b;",
      "return a % 3 === 0 ? b : -b;",
      "return Math.max(a, b) + Math.floor(a);",
      "return a === b;",
      'return "" + a + b;',
      "return a.toFixed(1) + b;",
      "return -a;",
    ],
    texts: [
      "return a + b;",
      "return a.length + b.length;",
      "return a.toUpperCase() + b;",
      "return a < b;",
      "return a[0] + b;",
      "return `${a}-${b}`;",
      'return typeof a === "string" ? a.length : "no text: " + typeof a;',
      "return a.indexOf(b);",
      "return a === b;",
    ],
    objects: [
      "return a.n + b.n;",
      "return a.n;",
      "a.n++;\nreturn a.n + b.n;",
      "return Object.keys(a).length + b.n;",
      "return a === b;",
      "return a.n < b.n ? a.n : b.n;",
      "const { n } = a;\nreturn n + b.n;",
      'return typeof a === "object" && a !== null ? a.n : "no object: " + typeof a;',
      "return JSON.stringify(a) + b.n;",
    ],
  };
  const body = random.pick(bodies[kind]);
  const usual = {
    numbers: ["1", "2", "3", "7"],
    texts: ['"a"', '"bc"', '"d"'],
    objects: ["{ n: 1 }", "{ n: 2 }", "{ n: 3 }"],
  }[kind];
  const strange = () =>
    random.pick([
      "1.5",
      "2 ** 31",
      "NaN",
      "-0",
      '"text"',
      "undefined",
      "null",
      "{ n: 1.5 }",
      '{ n: "t" }',
      "{ m: 1 }",
      "[1, 2]",
      "5n",
      "Symbol()",
      "() => 1",
      "true",
      "{\nvalueOf() {\nreturn 4;\n},\n}",
      "new Number(3)",
      'new String("boxed")',
      "Infinity",
      "-1",
    ]);
  const shape = random.pick(["declared", "declared", "arrow", "method", "static"] as const);
  const F = { declared: "f", arrow: "f", method: "holder.f", static: "K.f" }[shape];
  const declared = {
    declared: `function f(a, b) {\n${body}\n}`,
    arrow: `const f = (a, b) => {\n${body}\n};`,
    method: `const holder = {\nf(a, b) {\n${body}\n},\n};`,
    static: `class K {\nstatic f(a, b) {\n${body}\n}\n}`,
  }[shape];
  const tell = (text: string) =>
    `try {\nconsole.log(String(${text}));\n} catch (error) {\nconsole.log("THROWS", error.constructor.name);\n}`;
  const written = Array.from({ length: random.pick([0, 1, 1, 3]) }, () =>
    tell(`${F}(${random.pick(usual)}, ${random.pick(usual)})`),
  );

  const s1 = strange();
  const s2 = random.chance(0.5) ? strange() : random.pick(usual);
  const roads: [number, string][] = [
    [3, tell(`[${s1}].map(${F})`)],
    [
      1,
      `try {\n[${s1}].forEach(${F});\nconsole.log("went through");\n} catch (error) {\nconsole.log("THROWS", error.constructor.name);\n}`,
    ],
    [2, tell(`[${s1}, ${s2}].reduce(${F})`)],
    [1, tell(`[${s1}, ${s2}].sort(${F}).length`)],
    [1, tell(`"xy".replace("x", ${F})`)],
    [1, tell(`Array.from([${s1}], ${F})`)],
    [1, tell(`JSON.parse("[1]", ${F})`)],
    [3, tell(`${F}.call(null, ${s1}, ${s2})`)],
    [3, tell(`${F}.apply(null, [${s1}, ${s2}])`)],
    [2, tell(`${F}.bind(null, ${s1})(${s2})`)],
    [2, tell(`Reflect.apply(${F}, null, [${s1}, ${s2}])`)],
    [shape === "declared" ? 2 : 0, tell(`typeof new ${F}(${s1}, ${s2})`)],
    [1, tell(`${F}\`x\${${s1}}y\``)],
    [2, tell(`${F}(${s1})`)],
    [2, tell(`${F}()`)],
    [2, tell(`${F}(${s1}, ${s2}, 3, 4, 5)`)],
    [3, tell(`${F}(${s1}, ${s2})`)],
    [2, tell(`${F}(...[${s1}, ${s2}])`)],
    [2, tell(`[${F}][0](${s1}, ${s2})`)],
    [2, tell(`({ g: ${F} })[["g"][0]](${s1}, ${s2})`)],
    [1, tell(`(globalThis.kept = ${F}, globalThis.kept(${s1}, ${s2}))`)],
    [1, tell(`(function () {\nreturn ${F}(...arguments);\n})(${s1}, ${s2})`)],
    [1, tell(`({\nget g() {\nreturn ${F}(${s1}, ${s2});\n},\n}).g`)],
    [1, tell(`(0, ${F})(${s1}, ${s2})`)],
    [1, tell(`${F}?.(${s1}, ${s2})`)],
    [1, tell(`new Map([[${s1}, ${s2}]]).forEach(${F})`)],
  ];
  const odd = random.weighted(roads);
  const later: [number, string][] = [
    [
      2,
      `await Promise.resolve(${s1}).then(${F}).then(\nanswer => console.log(String(answer)),\nerror => console.log("THROWS", error.constructor.name),\n);`,
    ],
    [
      1,
      `await new Promise(resolve =>\nsetTimeout(\n(...given) => {\n${tell(`${F}(...given)`)}\nresolve();\n},\n0,\n${s1},\n${s2},\n),\n);`,
    ],
  ];
  const form = random.weighted([
    [10, "plain"],
    [1, "later"],
    [2, "files"],
  ] as const);
  const order = random.pick(["odd last", "odd last", "odd first", "odd between"] as const);
  const lines = (theOdd: string) =>
    order === "odd first"
      ? [theOdd, ...written]
      : order === "odd between" && written.length > 1
        ? [written[0], theOdd, ...written.slice(1)]
        : [...written, theOdd];
  if (form === "files" && (shape === "declared" || shape === "arrow")) {
    return {
      file: "main.mjs",
      text: `import { f } from "./lib.mjs";\n${odd}\n`,
      files: { "lib.mjs": `export ${declared}\n${written.join("\n")}\n` },
    };
  }
  if (form === "later") return { file: "main.mjs", text: `${declared}\n${lines(random.weighted(later)).join("\n")}\n` };
  const file = random.chance(0.5) ? "main.mjs" : "main.cjs";
  const scene = lines(odd).join("\n");
  const where = random.pick(["top", "top", "once", "thrice"] as const);
  if (where === "top") return { file, text: `${declared}\n${scene}\n` };
  return {
    file,
    text: `${declared}\nfunction run() {\n${scene}\n}\n${where === "once" ? "run();" : "run();\nrun();\nrun();"}\n`,
  };
}
