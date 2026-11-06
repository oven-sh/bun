// Small programs about one number in one place, which begins as a small whole number and is counted with, and one step that takes it past 32 bits, past 53 bits, to a fraction, to `-0`, `NaN` or
// `Infinity`. Then it is read in a few ways. A number is a double whatever it looked like so far. Half of the programs are TypeScript. There is one scene, and every line is printed at once.
//
//   the place    a member of a literal, a field of a class, a store in a constructor, a static field, a private field, an element of a list, a variable of the file, a variable that a closure
//                holds, a member of an inner object; alone, or beside a twin in the same kind of place that stays small and is read by the same code
//   counted with  `++`, the bound of a loop, an index into a list, `& 3`, or nothing
//   the step     `+=`, `-=`, `*=`, `/=`, `**=`, `%=`, `++`, `--`, `= n + k`, `= n * 2 + 1`, `= -n`, doubling in a loop; where the place is named, in a method, in a closure, in a function
//                that is handed the object
//   from and by  the ends of the 32 bits with and without a sign, of 31 and of 53 bits, zero; one, two, a half, large numbers, `NaN`, `Infinity`, `-0`
//   the reads    as it is, `| 0`, `>>> 0`, `% 7`, `+ 1`, `* 2`, comparisons, `Object.is`, `1 / n`, `typeof`, `String`, `toString(16)`, `JSON.stringify`, `Number.isSafeInteger`, `Math.trunc`, a
//                typed array, `BigInt`, a template, a key
import type { Random } from "./random";

export function generate(random: Random, isTyped: boolean): string {
  const T = isTyped ? ": number" : "";
  const place = random.weighted([
    [5, "literal"],
    [5, "field"],
    [3, "stored"],
    [2, "static"],
    [2, "private"],
    [3, "element"],
    [2, "variable"],
    [2, "captured"],
    [2, "inner"],
  ] as const);
  const [start, steps] = random.pick<[string, string[]]>([
    [
      "2147483647",
      ["N += 1", "N++", "N += 2", "N = N + 1", "N *= 2", "N = N * 2 + 1", "N += 2147483647", "N += 0.5", "N -= -1"],
    ],
    ["2147483646", ["N += 2", "N += 1.5", "N *= 3", "N = N + 2"]],
    ["-2147483648", ["N -= 1", "N--", "N = N - 1", "N = -N", "N *= -1", "N *= 2", "N += -1", "N /= -1"]],
    ["1073741824", ["N += N", "N *= 2", "N = N + N", "N *= 4", "N **= 2"]],
    ["1073741823", ["N = N * 2 + 2", "N += N + 2", "N *= 3"]],
    ["65536", ["N *= N", "N **= 2", "N *= 65536", "N = N * N"]],
    ["46341", ["N *= N", "N = N * N", "N **= 2"]],
    [
      "1",
      [
        "N /= 2",
        "N += 0.5",
        "N -= 0.1",
        "N /= 0",
        "N *= NaN",
        "N += Infinity",
        "N %= 0",
        "N **= 0.5",
        "N /= 3",
        "N *= 1e10",
        "N += 1e21",
        "N -= 1e-7",
      ],
    ],
    ["0", ["N *= -1", "N = -N", "N /= -1", "N /= 0", "N -= 0", "N = 0 * -1", "N %= -1", "N += -0", "N **= -1"]],
    ["-1", ["N *= 0", "N %= 1", "N = Math.round(N / 4)", "N /= Infinity", "N >>>= 0"]],
    ["4294967295", ["N += 1", "N++", "N *= 2", "N |= 0", "N >>= 0"]],
    ["9007199254740991", ["N += 1", "N += 2", "N++", "N *= 2", "N = N + 1"]],
    [
      "5",
      [
        "for (let turn = 0; turn < 40; turn++) N += N",
        "for (let turn = 0; turn < 60; turn++) N *= 2",
        "for (let turn = 0; turn < 33; turn++) N = N * 2 + 1",
        "for (let turn = 0; turn < 3; turn++) N /= 2",
      ],
    ],
  ]);
  const step = random.pick(steps);

  // How the place is written from the scene, and from inside a method.
  const names = {
    literal: ["o.n", "twin.n"],
    field: ["o.n", "twin.n"],
    stored: ["o.n", "twin.n"],
    static: ["K.n", "Twin.n"],
    private: ["o.read()", "twin.read()"],
    element: ["o[0]", "twin[0]"],
    variable: ["n", "small"],
    captured: ["n", "small"],
    inner: ["o.inner.n", "twin.inner.n"],
  }[place];
  const hasTwin = random.chance(0.45);
  const how =
    place === "private"
      ? "method"
      : place === "captured"
        ? "closure"
        : random.pick(["named", "named", "named", "method", "closure", "handed"] as const);
  const canHaveAMethod = place === "field" || place === "stored" || place === "private" || place === "literal";
  const way =
    how === "method" && !canHaveAMethod
      ? "named"
      : how === "handed" && (place === "variable" || place === "static")
        ? "named"
        : how;
  const own = place === "private" ? "this.#n" : "this.n";
  const method = way === "method" ? `grow() {\n${step.replaceAll(/\bN\b/g, own)};\n}` : "";
  const reader = place === "private" ? "read() {\nreturn this.#n;\n}" : "";

  const declared = {
    literal: "",
    field: `class K {\nn = ${start};\n${method ? method + "\n" : ""}}`,
    stored: `class K {\n${isTyped ? "n: number;\n" : ""}constructor(n${T}) {\nthis.n = n;\n}\n${method ? method + "\n" : ""}}`,
    static: `class K {\nstatic n = ${start};\n}${hasTwin ? "\nclass Twin {\nstatic n = 3;\n}" : ""}`,
    private: `class K {\n#n${T};\nconstructor(n${T}) {\nthis.#n = n;\n}\n${method}\n${reader}\n}`,
    element: "",
    variable: `let n = ${start};${hasTwin ? "\nlet small = 3;" : ""}`,
    captured: "",
    inner: "",
  }[place];
  const make = (value: string) =>
    ({
      literal: method ? `{\nn: ${value},\n${method},\n}` : `{ n: ${value} }`,
      field: "new K()",
      stored: `new K(${value})`,
      static: "",
      private: `new K(${value})`,
      element: `[${value}, 1]`,
      variable: "",
      captured: "",
      inner: `{ inner: { n: ${value} } }`,
    })[place];
  const born = [
    make(start) ? `const o = ${make(start)};` : "",
    hasTwin && make("3") ? `const twin = ${make("3")};${place === "field" ? "\ntwin.n = 3;" : ""}` : "",
    place === "captured" ? `let n = ${start};${hasTwin ? "\nlet small = 3;" : ""}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const N = names[0];
  const writable = place === "private" ? "" : N;
  const counts =
    place === "private"
      ? ""
      : random.pick([
          "",
          "",
          `for (let i = 0; i < ${N} && i < 2; i++) console.log("turn", i);`,
          `console.log(["a", "b", "c", "d"][${N} & 3]);`,
          `${N}++;\n${N}--;`,
          `console.log([1, 2, 3].slice(0, ${N} & 1).length);`,
        ]);
  const grows =
    way === "method"
      ? "o.grow();"
      : way === "closure"
        ? `const grow = () => {\n${step.replaceAll(/\bN\b/g, writable)};\n};\ngrow();`
        : way === "handed"
          ? "grow(o);"
          : `${step.replaceAll(/\bN\b/g, writable)};`;
  const shape = isTyped
    ? place === "element"
      ? ": number[]"
      : place === "inner"
        ? ": { inner: { n: number } }"
        : ": { n: number }"
    : "";
  const handed =
    way === "handed"
      ? `function grow(given${shape}) {\n${step.replaceAll(/\bN\b/g, N.replace(/^o/, "given"))};\n}`
      : "";

  const reads = (v: string): string[] => [
    `console.log(${v});`,
    `console.log(${v});`,
    `console.log(${v} | 0, ${v} >>> 0);`,
    `console.log(${v} % 7, ${v} + 1, ${v} * 2);`,
    `console.log(${v} > 2147483647, ${v} < -2147483648, ${v} === ${start});`,
    `console.log(Object.is(${v}, -0), Object.is(${v}, 0), 1 / ${v});`,
    `console.log(typeof ${v}, String(${v}));`,
    `console.log(${v}.toString(16));`,
    `console.log(JSON.stringify({ n: ${v} }), JSON.stringify([${v}]));`,
    `console.log(Number.isSafeInteger(${v}), Number.isInteger(${v}), Number.isNaN(${v}));`,
    `console.log(Math.trunc(${v}), Math.abs(${v}), Math.sign(${v}));`,
    `console.log(new Int32Array([${v}])[0], new Float32Array([${v}])[0], new Uint8Array([${v}])[0]);`,
    `console.log(Number.isInteger(${v}) ? String(BigInt(${v})) : "no whole number");`,
    `console.log(\`\${${v}}\`, { [${v}]: 1 });`,
    `console.log(${v} - 1, ${v} - ${v}, ${v} / 2);`,
    `console.log(${v} == ${v}, ${v} >= ${v}, ${v} !== ${v});`,
    `console.log(~${v}, -${v}, +${v}, !${v});`,
    `console.log(${v} << 1, ${v} >> 1, ${v} & 255);`,
    `console.log([${v}].includes(${v}), [${v}].indexOf(${v}), new Set([${v}, ${v}]).size);`,
    ...(place === "literal" || place === "field" || place === "stored" || place === "inner" || place === "element"
      ? [`console.log(JSON.stringify(${v.split(/[.[]/)[0]}));`]
      : []),
  ];
  const count = random.pick([1, 1, 2, 3]);
  const picked = Array.from({ length: count }, () => random.below(reads("x").length));
  const listed = (v: string) => picked.map(index => reads(v)[index]).join("\n");
  const twinOrder = random.chance(0.5);
  const told = hasTwin
    ? twinOrder
      ? `${listed(names[1])}\n${listed(N)}`
      : `${listed(N)}\n${listed(names[1])}`
    : listed(N);
  const early = random.chance(0.3) ? listed(N) : "";

  const scene = [born, counts, early, grows, told].filter(Boolean).join("\n");
  const head = [declared, handed].filter(Boolean).join("\n");
  const guarded = (text: string) =>
    `try {\n${text}\n} catch (error) {\nconsole.log("THROWS", ${isTyped ? "(error as Error)" : "error"}.constructor.name);\n}`;
  const where =
    place === "variable" || place === "static"
      ? random.pick(["top", "once"] as const)
      : random.pick(["top", "once", "once", "thrice"] as const);
  const tail = isTyped ? "export {};\n" : "";
  if (where === "top") return `${head ? head + "\n" : ""}${guarded(scene)}\n${tail}`;
  return `${head ? head + "\n" : ""}function run() {\n${scene}\n}\n${guarded(where === "once" ? "run();" : "run();\nrun();\nrun();")}\n${tail}`;
}
