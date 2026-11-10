// A closure stores into a variable of the function that makes it, and a loop of that function uses the variable: the loop, times how it uses the variable, times the closure, times where the closure is called,
// times what stands around the loop, untyped and with written types. Each program holds one of each and is built alone.
//
//   bun write-closure-beside-loop-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<loop>--<use>--<closure>--<call>--<around>.<mjs|ts>
//   bun write-closure-beside-loop-sweep.ts count
//   bun write-closure-beside-loop-sweep.ts named <pattern> <folder> [most]
//
// Such a variable lives in a scope object, so a read of it is a read of memory that any call may change. A compiler that walks a loop under what it believes of the variable, finds the belief broken by a turn and
// walks again has to have learned something by then: a build that does not end is a find here, as an answer that differs is.
import { mkdirSync, writeFileSync } from "fs";

// HEAD is a test of the variable for the loop's own condition, BODY what a turn does.
const loops: [string, string][] = [
  ["a-counted-loop", "for (let i = 0; i < 3 && HEAD; i++) {\n  BODY\n}"],
  ["a-loop-that-counts-down", "let left = 3;\nwhile (left-- > 0 && HEAD) {\n  BODY\n}"],
  ["a-do-while", "let left = 2;\ndo {\n  BODY\n} while (--left > 0 && HEAD);"],
  [
    "a-walk-of-a-written-list",
    "for (const each of [v0, v1, 7]) {\n  if (!(HEAD)) break;\n  v0 = (v0 + each) | 0;\n  BODY\n}",
  ],
  [
    "a-walk-of-a-list-from-data",
    "for (const each of list) {\n  if (!(HEAD)) break;\n  v0 = (v0 + each) | 0;\n  BODY\n}",
  ],
  ["a-walk-of-keys", "for (const key in record) {\n  if (!(HEAD)) break;\n  v0 = (v0 + key.length) | 0;\n  BODY\n}"],
  ["an-endless-loop-that-is-left", "let turns = 0;\nfor (;;) {\n  BODY\n  if (++turns > 2 || !(HEAD)) break;\n}"],
  [
    "a-loop-in-a-loop",
    "for (let i = 0; i < 2; i++) {\n  let left = 2;\n  while (left-- > 0 && HEAD) {\n    BODY\n  }\n}",
  ],
  [
    "a-do-while-that-holds-a-loop",
    "let outer = 1;\ndo {\n  BODY\n  let left = 1;\n  while (left-- > 0) {\n    v0 = (v1 + v0) | 0;\n  }\n} while (--outer > 0 && HEAD);",
  ],
  ["a-labeled-loop-that-goes-on", "again: for (let i = 0; i < 3; i++) {\n  if (!(HEAD)) continue again;\n  BODY\n}"],
];

// The test for the head and the statement for the body.
const uses: [string, string, string][] = [
  ["read-in-the-head", "v1 < 1e9", "v0 = (v0 + 1) | 0;"],
  ["read-in-the-body", "v0 < 1e9", "v0 = (v0 + v1) | 0;"],
  ["read-by-a-switch", "v0 < 1e9", "switch (v1 & 3) {\n  case 0:\n    box.n = (v0 + v0) | 0;\n}"],
  ["stored-in-the-body", "v0 < 1e9", "v1 = (v0 ^ 5) | 0;"],
  ["read-and-stored", "v1 < 1e9", "v1 = (v1 + v0) | 0;"],
];

const closures: [string, string][] = [
  ["an-arrow", "const store = (x) => {\n  v1 = (v1 + x) | 0;\n  return v1;\n};"],
  ["a-declared-function", "function store(x) {\n  v1 = (v1 + x) | 0;\n  return v1;\n}"],
  [
    "a-method",
    "const holder = {\n  put(x) {\n    v1 = (v1 + x) | 0;\n    return v1;\n  },\n};\nconst store = (x) => holder.put(x);",
  ],
  [
    "one-that-stores-and-one-that-reads",
    "const other = (x) => {\n  v1 = (v1 + x) | 0;\n};\nconst store = (x) => {\n  if (x === 1e9) other(x);\n  return v0 ^ v1;\n};",
  ],
  ["one-that-stores-a-fraction", "const store = (x) => {\n  v1 = v1 + x + 0.5;\n  return v1;\n};"],
  [
    "one-that-stores-and-one-that-answers-nothing",
    "const other = (x) => {\n  v1 = (v1 + x) | 0;\n};\nconst store = (x) => {};",
  ],
];

// Statements in front of the loop, in a turn, and behind the loop.
const calls: [string, string, string, string][] = [
  ["it-is-never-called", "", "", ""],
  ["called-in-front", "v0 = (v0 + store(1)) | 0;", "", ""],
  ["called-in-a-turn", "", "v0 = (v0 + store(2)) | 0;", ""],
  ["called-in-a-turn-in-a-try", "", "try {\n  v0 = store(v0) | 0;\n} catch (thrown) {\n  v0 = 0;\n}", ""],
  ["called-behind", "", "", "v0 = (v0 + store(3)) | 0;"],
  ["handed-to-a-callee-in-a-turn", "", "v0 = (v0 + calls(store)) | 0;", ""],
  ["called-in-front-in-a-try", "try {\n  v0 = store(v0) | 0;\n} catch (thrown) {\n  v0 = 0;\n}", "", ""],
  ["its-answer-is-stored-as-it-is-in-front", "v0 = store(1)RAW;", "", ""],
  ["its-answer-is-stored-as-it-is-in-front-in-a-try", "try {\n  v0 = store(1)RAW;\n} catch (thrown) {}", "", ""],
  ["its-answer-is-stored-as-it-is-in-a-turn", "", "v0 = store(2)RAW;", ""],
];

const arounds: [string, (loop: string) => string][] = [
  ["bare", loop => loop],
  ["in-a-try-with-a-catch", loop => `try {\n${indented(loop)}\n} catch (thrown) {\n  v0 = -1;\n}`],
  ["in-a-try-with-a-finally", loop => `try {\n${indented(loop)}\n} finally {\n  v0 = (v0 + 1) | 0;\n}`],
  ["in-a-case", loop => `switch (v0 & 1) {\n  case 0:\n  case 1: {\n${indented(indented(loop))}\n  }\n}`],
  ["in-a-labeled-block", loop => `block: {\n  if (v0 === 1e9) break block;\n${indented(loop)}\n}`],
  [
    "in-a-case-that-is-never-taken",
    loop => `v0 = (v1 & v0) | 1;\nswitch (v0 & 3) {\n  case 0: {\n${indented(indented(loop))}\n  }\n}`,
  ],
];

const forms = ["mjs", "ts"] as const;
const all = loops.length * uses.length * closures.length * calls.length * arounds.length * forms.length;

function indented(text: string): string {
  return text
    .split("\n")
    .map(line => (line ? "  " + line : line))
    .join("\n");
}

function write(at: number): { name: string; text: string } {
  const pick = <T>(list: readonly T[]): T => {
    const one = list[at % list.length];
    at = Math.floor(at / list.length);
    return one;
  };
  const [loop, shape] = pick(loops);
  const [call, front, inTurn, behind] = pick(calls);
  const [use, head, body] = pick(uses);
  const [closure, made] = pick(closures);
  const [around, wrap] = pick(arounds);
  const form = pick(forms);
  const typed = form === "ts";

  const turn = [body, inTurn].filter(Boolean).join("\n");
  const depth = (line: string) => /^( *)BODY$/m.exec(line)![1];
  const written = shape.replace(/HEAD/g, head).replace(
    /^( *)BODY$/m,
    turn
      .split("\n")
      .map(line => depth(shape) + line)
      .join("\n"),
  );
  const inside = [
    typed
      ? made.replace(/\(x\) (=>|\{)/g, "(x: number) $1").replace("(x: number) => {};", "(x: number): any => {};")
      : made,
    wrap([front, written, behind].filter(Boolean).join("\n")),
  ]
    .join("\n")
    .replace(/RAW/g, typed ? " as any" : "");
  const text = `class Box {
  n${typed ? ": number" : ""};
  constructor(n${typed ? ": number" : ""}) {
    this.n = n;
  }
}
const list${typed ? ": number[]" : ""} = JSON.parse("[4, 5, 6]");
const record${typed ? ": Record<string, number>" : ""} = JSON.parse('{"a": 1, "bc": 2}');
function calls(given${typed ? ": (x: number) => number" : ""}) {
  return given(4);
}
function f(a${typed ? ": number" : ""}, b${typed ? ": number" : ""}) {
  let v0 = (a * 3 + b) | 0,
    v1 = (a + b * 7) | 0;
  const box = new Box(a);
${indented(inside)}
  return v0 + v1 + box.n;
}
let hash = 0;
for (let i = 0; i < 40; i++) hash = (Math.imul(hash, 31) + f(i, (i * 7) & 63) * 2) | 0;
console.log(hash);
export {};
`;
  return { name: `${loop}--${use}--${closure}--${call}--${around}.${form}`, text };
}

const pad = (at: number) => String(at).padStart(5, "0");
if (process.argv[2] === "count") console.log(all);
else if (process.argv[2] === "named") {
  const [pattern, folder, atMost] = [new RegExp(process.argv[3]), process.argv[4], Number(process.argv[5] ?? 500)];
  mkdirSync(folder, { recursive: true });
  let written = 0;
  for (let at = 0; at < all && written < atMost; at++) {
    const program = write(at);
    if (!pattern.test(program.name)) continue;
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
    written++;
  }
  console.log(written);
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
