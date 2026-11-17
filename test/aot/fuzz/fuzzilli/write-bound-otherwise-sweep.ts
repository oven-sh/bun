// A function is bound by another road than `f.bind(..)`: the road, times how many arguments are bound, times the function, times what it does with its parameters, times where the call of the bound function
// stands, times where the bound function is kept, times whether the function itself is called too, times how the bound function is called, times the kind of file. Each program holds one of each and is built
// alone.
//
//   bun write-bound-otherwise-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<road>--<bound>--<function>--<does>--<stands>--<kept>--<direct>--<called>.mjs or .cjs
//   bun write-bound-otherwise-sweep.ts count
//   bun write-bound-otherwise-sweep.ts named <pattern> <folder> [most]
import { mkdirSync, writeFileSync } from "fs";

// What stands in front, and the expression. F is the function, ARGS what `bind` takes: `null` and what is bound.
const roads: [string, string, string][] = [
  ["bind-by-call", "", "Function.prototype.bind.call(F, ARGS)"],
  ["bind-itself", "", "F.bind(ARGS)"],
  ["bind-by-apply", "", "Function.prototype.bind.apply(F, [ARGS])"],
  ["bind-by-reflection", "", "Reflect.apply(Function.prototype.bind, F, [ARGS])"],
  ["its-own-bind-by-call", "", "F.bind.call(F, ARGS)"],
  ["bind-kept-in-a-constant", "const bind = Function.prototype.bind;", "bind.call(F, ARGS)"],
  [
    "a-helper-that-applies-bind",
    "const slice = Array.prototype.slice;\nconst nativeBind = Function.prototype.bind;\nconst kit = {};\nkit.bind = function (func, context) {\n  return nativeBind.apply(func, slice.call(arguments, 1));\n};",
    "kit.bind(F, ARGS)",
  ],
  ["a-helper-that-spreads", "const tie = (func, ...rest) => func.bind(...rest);", "tie(F, ARGS)"],
  ["bind-with-a-spread", "", "F.bind(...[ARGS])"],
  ["call-by-call", "", "Function.prototype.call.call(Function.prototype.bind, F, ARGS)"],
];

// How many of the three are bound, and how many of the rest are passed.
const bounds: [string, number, number][] = [
  ["one-is-bound", 1, 2],
  ["none-is-bound", 0, 3],
  ["two-are-bound", 2, 1],
  ["all-are-bound", 3, 0],
  ["one-more-than-it-takes", 4, 0],
  ["one-is-bound-and-one-is-lacking", 1, 1],
];

// BODY is what the function hands back.
const functions: [string, string, string][] = [
  ["a-declared-function", "function join(a, b, c) {\n  return BODY;\n}", "join"],
  ["an-arrow", "const join = (a, b, c) => BODY;", "join"],
  ["a-method", "const holder = {\n  join(a, b, c) {\n    return BODY;\n  },\n};", "holder.join"],
  ["a-static-method", "class Kit {\n  static join(a, b, c) {\n    return BODY;\n  }\n}", "Kit.join"],
];

const does: [string, string, string][] = [
  ["lengths-are-summed", "a.length + b.length + c", "sum += CALL;"],
  ["all-are-joined", "a + b + c", "sum += String(CALL).length;"],
];

// MAKE declares `g`, or what holds it, inside the function; USE is the statement with the call.
const stands: [string, string][] = [
  ["in-a-loop-under-a-test-of-data", "for (let i = 0; i < turns; i++) {\n    if (rows[i & 7] > 3) USE\n  }"],
  ["in-a-loop", "for (let i = 0; i < turns; i++) {\n    USE\n  }"],
  ["straight", "USE"],
  ["in-an-arm-never-taken", "for (let i = 0; i < turns; i++) {\n    if (rows[i & 7] > 99) USE\n  }"],
  [
    "in-an-inner-loop",
    "for (let i = 0; i < turns; i++) {\n    for (let j = 0; j < 2; j++) {\n      if (rows[(i + j) & 7] > 3) USE\n    }\n  }",
  ],
];

const kepts = ["a-constant-of-the-function", "a-constant-of-the-file", "a-field-of-a-record"] as const;

const directs = ["called-itself-at-the-end", "never-called-itself", "called-itself-in-front"] as const;

const calleds: [string, (g: string, passed: string[]) => string][] = [
  ["called", (g, passed) => `${g}(${passed.join(", ")})`],
  ["called-by-call", (g, passed) => `${g}.call(${["null", ...passed].join(", ")})`],
];

const files = ["mjs", "cjs"] as const;

const all =
  roads.length * bounds.length * functions.length * does.length * stands.length * kepts.length * directs.length * calleds.length * files.length; // prettier-ignore

function write(at: number): { name: string; text: string } {
  const pick = <T>(list: readonly T[]): T => {
    const one = list[at % list.length];
    at = Math.floor(at / list.length);
    return one;
  };
  const [road, inFront, made] = pick(roads);
  const [bound, held, handed] = pick(bounds);
  const [stand, shape] = pick(stands);
  const kept = pick(kepts);
  const direct = pick(directs);
  const file = pick(files);
  const [fn, declared, named] = pick(functions);
  const [did, body, use] = pick(does);
  const [called, calls] = pick(calleds);
  const three = ['"x"', '"ab"', "1", "9"];
  const makes = made.replace(/\bF\b/g, named).replace("ARGS", ["null", ...three.slice(0, held)].join(", "));
  const g = kept === "a-field-of-a-record" ? "box.g" : "g";
  const keeps = kept === "a-field-of-a-record" ? `const box = { g: ${makes} };` : `const g = ${makes};`;
  const itself = `${named}("p", "qr", 1)`;
  const text = [
    file === "cjs" && '"use strict";',
    declared.replace("BODY", body),
    inFront,
    'const rows = JSON.parse("[1,9,2,8,3,7,4,6]");',
    direct === "called-itself-in-front" && `console.log(${itself});`,
    kept === "a-constant-of-the-file" && keeps,
    "function run(turns) {",
    kept !== "a-constant-of-the-file" && `  ${keeps}`,
    "  let sum = 0;",
    `  ${shape.replace("USE", use.replace("CALL", calls(g, three.slice(held, held + handed))))}`,
    "  return sum;",
    "}",
    `console.log("SAID " + run(Number(process.argv[2] ?? 1000))${direct === "called-itself-at-the-end" ? `, ${itself}` : ""});`,
  ]
    .filter(Boolean)
    .join("\n");
  return {
    name: `${road}--${bound}--${fn}--${did}--${stand}--${kept}--${direct}--${called}.${file}`,
    text: text + "\n",
  };
}

const pad = (at: number) => String(at).padStart(5, "0");
if (process.argv[2] === "count") console.log(all);
else if (process.argv[2] === "named") {
  const [pattern, folder, atMost] = [new RegExp(process.argv[3]), process.argv[4], Number(process.argv[5] ?? 500)];
  mkdirSync(folder, { recursive: true });
  let laid = 0;
  for (let at = 0; at < all && laid < atMost; at++) {
    const program = write(at);
    if (!pattern.test(program.name)) continue;
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
    laid++;
  }
  console.log(laid);
} else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? all), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, all); step++) {
    const at = (from + step * stride) % all;
    const program = write(at);
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
  }
  console.log(Math.min(count, all));
}
