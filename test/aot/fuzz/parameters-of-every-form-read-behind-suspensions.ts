// Functions that suspend (async functions, generators, async generators, arrows and methods) take parameters of every form: plain, with a default
// that names an earlier parameter or makes a closure over one, taken apart from an object or a list, a rest parameter, `arguments`. In front of,
// between and behind the suspensions the body stores to them straight on, on one path, in a loop, through a closure or through `arguments`, and
// reads them again. The second argument says whether the file is a CommonJS file that is not strict, where `arguments` follows the parameters.
import type { Random } from "./random";

type Parameter = { text: string; names: string[]; isSimple: boolean };

function parameter(random: Random, index: number, earlier: string[]): Parameter {
  const p = `p${index}`;
  const other = earlier.length ? random.pick(earlier) : "7";
  return random.pick<() => Parameter>([
    () => ({ text: p, names: [p], isSimple: true }),
    () => ({ text: p, names: [p], isSimple: true }),
    () => ({ text: `${p} = ${other}`, names: [p], isSimple: false }),
    () => ({ text: `${p} = make("${p}", ${other})`, names: [p], isSimple: false }),
    () => ({ text: `${p} = () => ${other}`, names: [p], isSimple: false }),
    () => ({ text: `${p} = { inner: ${other} }`, names: [p], isSimple: false }),
    () => ({ text: `{ inner: ${p} }`, names: [p], isSimple: false }),
    () => ({ text: `{ inner: ${p} = ${other} }`, names: [p], isSimple: false }),
    () => ({ text: `{ inner: ${p}, ...${p}rest }`, names: [p, `${p}rest`], isSimple: false }),
    () => ({ text: `{ inner: ${p} } = { inner: ${other} }`, names: [p], isSimple: false }),
    () => ({ text: `{ deep: { inner: ${p} } = { inner: "none" } }`, names: [p], isSimple: false }),
    () => ({ text: `[${p}, ${p}second = ${other}]`, names: [p, `${p}second`], isSimple: false }),
    () => ({ text: `[, ...${p}]`, names: [p], isSimple: false }),
  ])();
}

const given = [
  `1`,
  `"text"`,
  `undefined`,
  `{ inner: 5, deep: { inner: 6 }, more: 7 }`,
  `[1, 2, 3]`,
  `make("given", 1)`,
  `{ inner: undefined }`,
  `[]`,
  `{ inner: make("inner", 2), deep: undefined }`,
  `2.5`,
  `null`,
];

export function generate(random: Random, isSloppy = false): string {
  const lines: string[] = [
    `const log = [];`,
    `const make = (name, value) => ({ name, value, inner: name + "-inner" });`,
    `const show = (value, depth = 0) => { try { return typeof value === "function" ? (depth > 3 ? "function" : "function:" + show(value(), depth + 1)) : JSON.stringify(value) ?? String(value); } catch (error) { return "threw " + error.name; } };`,
    `const tell = (where, ...values) => log.push(where + ": " + values.map(value => show(value)).join(" | "));`,
    `const later = value => new Promise(resolve => setTimeout(resolve, 0, value));`,
  ];
  const calls: string[] = [];
  const count = random.between(2, 5);
  for (let f = 0; f < count; f++) {
    const kind = random.pick([
      "async",
      "async",
      "generator",
      "asyncGenerator",
      "asyncArrow",
      "asyncMethod",
      "generatorMethod",
    ] as const);
    const isArrow = kind === "asyncArrow";
    const yields = kind === "generator" || kind === "generatorMethod" || kind === "asyncGenerator";
    const awaits = kind !== "generator" && kind !== "generatorMethod";
    const parameters: Parameter[] = [];
    const names: string[] = [];
    for (let index = 0, n = random.between(1, 4); index < n; index++) {
      const made = parameter(random, index, names);
      parameters.push(made);
      names.push(...made.names);
    }
    if (random.chance(0.25)) {
      parameters.push({ text: `...rest`, names: ["rest"], isSimple: false });
      names.push("rest");
    }
    const usesArguments = !isArrow && random.chance(0.4);
    const suspend = () =>
      random.pick([
        ...(awaits
          ? [
              `await 0;`,
              `await later(1);`,
              `await null;`,
              `for await (const step of [1, 2]) tell("step", step);`,
              `await Promise.all([later(1), 2]);`,
              `try { await Promise.reject(new Error("no")); } catch {}`,
            ]
          : []),
        ...(yields ? [`yield "out";`, `tell("sent", yield "ask");`, `yield* ["a", "b"];`] : []),
      ]);
    const name = () => random.pick(names);
    const step = (where: string) =>
      random.pick<() => string>([
        () => `tell("${where}", ${random.sample(names, random.between(1, 3)).join(", ")});`,
        () => `tell("${where}", ${names.join(", ")});`,
        () => `${name()} = "stored at ${where}";`,
        () => `${name()} = make("${where}", ${name()});`,
        () => `if (turn % 2) ${name()} = "on one path at ${where}";`,
        () => `for (let k = 0; k < 3; k++) ${name()} = [k, ${name()}].length + k;`,
        () => {
          const n = name();
          return `(() => { ${n} = "by a closure at ${where}"; })();`;
        },
        () => {
          const n = name();
          return `const read${where} = () => ${n};\n  keep.push(read${where});`;
        },
        () =>
          usesArguments
            ? `arguments[${random.below(3)}] = "through arguments at ${where}";`
            : `tell("${where}", typeof ${name()});`,
        () =>
          usesArguments
            ? `tell("${where} arguments", arguments.length, arguments[0], arguments[1], arguments[2]);`
            : `tell("${where}", ${name()});`,
        () => (usesArguments ? `tell("${where} list", [...arguments]);` : `${name()} = undefined;`),
        () => {
          const n = name();
          return `{ const ${n} = "shadow at ${where}"; tell("${where} inner", ${n}); }`;
        },
        () => `[${name()}, ${name()}] = [${name()}, "swapped at ${where}"];`,
        () => `try { ${name()}.inner = "member at ${where}"; } catch (error) { tell("${where}", error.name); }`,
        () => `${name()} ??= "filled at ${where}";`,
        () => `tell("${where}", eval("${name()}"));`,
      ])();
    const body: string[] = [`const keep = [];`];
    for (let part = 0, parts = random.between(1, 4); part <= parts; part++) {
      for (let n = random.between(0, 3); n > 0; n--) body.push(step(`f${f}part${part}n${n}`));
      if (part < parts) body.push(suspend());
    }
    body.push(`tell("f${f} end", ${names.join(", ")});`, `tell("f${f} kept", ...keep);`);
    const list = ["turn", ...parameters.map(p => p.text)].join(", ");
    const text = `{\n  ${body.join("\n  ")}\n}`;
    const callee =
      kind === "async"
        ? `async function f${f}(${list}) ${text}`
        : kind === "generator"
          ? `function* f${f}(${list}) ${text}`
          : kind === "asyncGenerator"
            ? `async function* f${f}(${list}) ${text}`
            : kind === "asyncArrow"
              ? `const f${f} = async (${list}) => ${text};`
              : kind === "asyncMethod"
                ? `const f${f} = { async run(${list}) ${text} }.run;`
                : `const f${f} = { *run(${list}) ${text} }.run;`;
    lines.push(callee);
    for (let turn = 0, turns = random.pick([1, 2, 2, 30]); turn < turns; turn++) {
      if (turn >= 3) {
        calls.push(
          `for (let turn = 3; turn < ${turns}; turn++) { log.length = Math.min(log.length, 400); ${drive(kind, `f${f}(turn, ${random.sample(given, random.between(0, 5)).join(", ")})`)} }`,
        );
        break;
      }
      calls.push(drive(kind, `f${f}(${turn}, ${random.sample(given, random.between(0, 5)).join(", ")})`));
    }
  }
  lines.push(
    `async function main() {`,
    ...calls.map(call => "  " + call),
    `  console.log(log.join("\\n"));`,
    `}`,
    `main();`,
  );
  return (isSloppy ? "" : `"use strict";\n`) + lines.join("\n") + "\n";
}

function drive(kind: string, call: string): string {
  const guarded = (text: string) => `try { ${text} } catch (error) { tell("thrown", error.name); }`;
  if (kind === "generator" || kind === "generatorMethod")
    return guarded(
      `let sent = 0; const steps = ${call}; for (let step = steps.next(); !step.done; step = steps.next(++sent)) tell("yielded", step.value);`,
    );
  if (kind === "asyncGenerator")
    return guarded(
      `let sent = 0; const steps = ${call}; for (let step = await steps.next(); !step.done; step = await steps.next(++sent)) tell("yielded", step.value);`,
    );
  return guarded(`await ${call};`);
}
