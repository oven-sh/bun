// Very small programs: one function, one variable, one expression with parts. A part in the middle stores to the variable, mostly a value of another kind, and the parts on both sides read it. The
// parts of an expression run from left to right, so the part on the left has the old value and the part on the right the new one. Nothing is caught, there are no helpers that several cases
// share, each function is called once, with one value, and what comes out is printed by `console.log` itself.
//
//   the expression   a list, an object (members, computed keys, accessors, methods, spreads), arguments (of a call, `new`, a tag, a built-in), a template, operators, comparisons, `?:`, `&&`, `??`, a comma,
//                    a store under a key, a compound store, defaults of a pattern and of parameters, static members and computed keys of a class, `switch`, the head of a `for`
//   the store        `=`, `++`, `+=`, `|=`, `??=`, a pattern; in the expression itself, in an arrow called on the spot, in a function declared beside it, in `eval`, behind an `await` or a `yield`
//   a read           the name, an arrow called on the spot, a function declared beside it, a list or a template round it, `typeof`
//   the variable     a parameter, a `let`, a `var`, one that a closure has captured, a variable of the file
//   the values       integers, fractions, -0, NaN, numbers past 32 bits, texts, booleans, null, undefined, lists, objects
import type { Random } from "./random";

export function generate(random: Random): { file: string; text: string } {
  const kind = random.weighted([
    [8, "plain"],
    [1, "async"],
    [1, "generator"],
  ] as const);
  const sloppy = kind === "plain" && random.chance(0.15);
  const values = [
    "1",
    "7",
    "1.5",
    "0.25",
    "-0",
    "NaN",
    "2147483648",
    "4294967296.5",
    '"s"',
    '""',
    '"12"',
    "true",
    "null",
    "undefined",
    "[1]",
    "[1.5]",
    "{ a: 1 }",
    "-3",
  ];
  const cases = random.pick([1, 1, 1, 2]);
  const lines: string[] = [];
  const calls: string[] = [];
  for (let at = 0; at < cases; at++) {
    const first = random.pick(values);
    const second = random.pick(values.filter(value => value !== first));
    const captured = random.chance(0.5);
    const read = () =>
      random.weighted([
        [6, "c"],
        [1, "(() => c)()"],
        [1, captured ? `get${at}()` : "c"],
        [1, "[c][0]"],
        [1, "`${c}`"],
        [1, "typeof c"],
      ]);
    const isNumber = /^-?[\d.]+$|NaN/.test(first);
    const store = random.weighted([
      [6, `(c = ${second})`],
      [2, isNumber ? "c++" : `(c = ${second})`],
      [1, isNumber ? "--c" : `(c = ${second})`],
      [2, isNumber ? "(c |= 0)" : `(c += ${second})`],
      [
        1,
        isNumber ? random.pick(["(c >>>= 0)", "(c *= 2)", "(c **= 2)", "(c %= 1)", "(c ^= 1)"]) : `(c ||= ${second})`,
      ],
      [1, `(c += ${second})`],
      [1, `(c ??= ${second})`],
      [1, `([c] = [${second}])`],
      [1, `({ c } = { c: ${second} })`],
      [3, `(() => (c = ${second}))()`],
      [2, isNumber ? "(() => (c |= 0))()" : `(() => (c = ${second}))()`],
      [2, captured ? `set${at}(${second})` : `(c = ${second})`],
      [1, sloppy ? `eval(${JSON.stringify(`c = ${second}`)})` : `(c = ${second})`],
      [
        1,
        kind === "async" ? `(c = await ${second})` : kind === "generator" ? `(c = yield ${second})` : `(c = ${second})`,
      ],
      [
        1,
        kind === "async"
          ? `(await 0, (c = ${second}))`
          : kind === "generator"
            ? `(yield 0, (c = ${second}))`
            : `(0, (c = ${second}))`,
      ],
    ]);
    const [L, S, R] = [read(), store, read()];
    const whole = random.pick<[string, string?]>([
      [`const r = [${L}, ${S}, ${R}];`],
      [`const r = [${L}, ${S}, ${R}];`],
      [`const r = [${L}, ${S}, ${R}];`, "for (const e of r) console.log(e);"],
      [`const r = [${L}, ${S}, ${R}];`, "console.log(r[0]);\nconsole.log(r[2]);"],
      [`const r = [${L}, , ${S}, ${R}];`],
      [`const r = [${L}, ...[${S}], ${R}];`],
      [`const r = [[${L}], [${S}], [${R}]];`],
      [`const r = { a${at}: ${L}, b${at}: ${S}, c${at}: ${R} };`],
      [`const r = { a${at}: ${L}, b${at}: ${S}, c${at}: ${R} };`, `console.log(r.a${at});\nconsole.log(r.c${at});`],
      [`const r = { [${L}]: 1, [${S}]: 2, [${R}]: 3 };`],
      [`const r = {\nget g() {\nreturn c;\n},\nb${at}: ${S},\nset g(x) {},\nd${at}: ${R},\n};`, "console.log(r.g, r);"],
      [`const r = {\nset g(x) {},\nb${at}: ${S},\nget g() {\nreturn c;\n},\n};`, "console.log(r.g);"],
      [`const r = {\na${at}: ${L},\nm() {\nreturn c;\n},\nb${at}: ${S},\n};`, `console.log(r.a${at}, r.m());`],
      [`const r = { ...{ a${at}: ${L} }, b${at}: ${S}, ...{ c${at}: ${R} } };`],
      [`const r = ((x, y, z) => [x, y, z])(${L}, ${S}, ${R});`],
      [`const r = ((...all) => all)(${L}, ${S}, ${R});`],
      [`const r = ((x, y, z) => x)(${L}, ${S}, ${R});`],
      [`const r = ((x, y, z) => z)(${L}, ${S}, ${R});`],
      [`const r = new (class {\nconstructor(x, y, z) {\nthis.x${at} = x;\nthis.z${at} = z;\n}\n})(${L}, ${S}, ${R});`],
      ["const r = `${" + L + "} ${" + S + "} ${" + R + "}`;"],
      ["const r = ((parts, ...all) => all)`${" + L + "} ${" + S + "} ${" + R + "}`;"],
      [`const r = Array.of(${L}, ${S}, ${R});`],
      [`const r = Math.max(${L}, ${S}, ${R});`],
      [`const r = [${L}].concat(${S}, ${R});`],
      [`const r = String(${L}).concat(${S}, ${R});`],
      [`const r = Object.assign({ a${at}: ${L} }, { b${at}: ${S} }, { c${at}: ${R} });`],
      [`const r = JSON.stringify([${L}, ${S}, ${R}]);`],
      [`const r = new Map([\n[${L}, ${S}],\n[${R}, 1],\n]);`],
      [`const r = new Set([${L}, ${S}, ${R}]);`],
      [`const r = ${L} + ${S} + ${R};`],
      [`const r = ${L} + ${S};`],
      [`const r = ${S} + ${R};`],
      [`const r = ${L} * ${S} - ${R};`],
      [`const r = [${L} < ${S}, ${L} === ${R}];`],
      [`const r = ${L} === ${S};`],
      [`const r = (${L}, ${S}, ${R});`],
      [`const r = ${L} ? ${S} : ${R};`],
      [`const r = [${L} && ${S} && ${R}, ${R}];`],
      [`const r = [${L} ?? ${S}, ${R}];`],
      [`const r = {};\nr[${L}] = ${S};`, "console.log(r, c);"],
      [`const r = {};\nr[${S}] = ${R};`, "console.log(r, c);"],
      [`const r = [0, 0, 0];\nr[${isNumber ? "c & 1" : "0"}] = ${S};`, "console.log(r, c);"],
      [`c = [c, ${S}, c];\nconst r = c;`],
      [`c += ${S};\nconst r = c;`],
      [`c = c + ${S} + c;\nconst r = c;`],
      [`const [x = ${L}, y = ${S}, z = ${R}] = [];\nconst r = [x, y, z];`],
      [`const { x = ${L}, y = ${S}, z = ${R} } = {};\nconst r = [x, y, z];`],
      kind === "plain"
        ? [`const r = ((x = ${L}, y = ${S}, z = ${R}) => [x, y, z])();`]
        : [`const r = [${L}, ${S}, ${R}];`],
      kind === "plain"
        ? [`const r = class {\nstatic x = ${L};\nstatic y = ${S};\nstatic z = ${R};\n};`, "console.log(r.x, r.y, r.z);"]
        : [`const r = [${R}, ${S}, ${L}];`],
      [
        `const r = class {\nstatic [${L}] = 1;\nstatic [${S}] = 2;\nstatic [${R}] = 3;\n};`,
        'console.log(Object.keys(r).join("|"));',
      ],
      [
        `let r;\nswitch (${L}) {\ncase ${S}:\nr = "first";\nbreak;\ncase ${R}:\nr = "second";\nbreak;\ndefault:\nr = "none";\n}`,
      ],
      [`const r = [];\nfor (let i = 0, x = ${L}, y = ${S}, z = ${R}; i < 1; i++) r.push(x, y, z);`],
      [`const r = [${L}, ${S}, ${R}].map(x => x);`],
      [`const r = [${L}, ${S}, ${R}].indexOf(c);`],
      [`const r = [${L}, ${S}, ${R}].join();`],
      [`const [x, , z] = [${L}, ${S}, ${R}];\nconst r = z;`, "console.log(x);\nconsole.log(r);"],
    ]);
    const variable = random.pick(["parameter", "parameter", "parameter", "let", "var", "file"]);
    const helpers = captured ? [`const get${at} = () => c;`, `const set${at} = x => (c = x);`] : [];
    const A = kind === "async" ? "async " : "";
    const star = kind === "generator" ? "*" : "";
    const form = kind === "plain" && random.chance(0.4) ? "arrow" : "function";
    const head =
      form === "arrow"
        ? `const f${at} = ${variable === "parameter" ? "c" : "given"} => {`
        : `${A}function${star} f${at}(${variable === "parameter" ? "c" : "given"}) {`;
    if (variable === "file") lines.push("let c;");
    lines.push(
      head,
      variable === "let"
        ? "let c = given;"
        : variable === "var"
          ? "var c = given;"
          : variable === "file"
            ? "c = given;"
            : "",
      ...helpers,
      whole[0],
      whole[1] ?? "console.log(r);",
      random.chance(0.6) ? "console.log(c);" : "",
      form === "arrow" ? "};" : "}",
    );
    calls.push(
      kind === "async"
        ? `await f${at}(${first});`
        : kind === "generator"
          ? `{\nconst steps = f${at}(${first});\nlet step = steps.next();\nwhile (!step.done) step = steps.next(step.value);\n}`
          : `f${at}(${first});`,
    );
    if (variable === "file" && cases > 1) break;
  }
  const text = [...lines, ...calls].filter(Boolean).join("\n") + "\n";
  return {
    file: kind === "async" ? "main.mjs" : sloppy ? "main.cjs" : random.pick(["main.js", "main.mjs", "main.cjs"]),
    text,
  };
}
