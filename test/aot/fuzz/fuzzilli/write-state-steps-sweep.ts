// Five small steps on one place that holds a value: where the value is held, times what the steps stand in, times the steps. A step stores, reads, asks, hands the place to a function that reads or writes it, or leaves.
// What is read may not be older than the last store, what is stored may not be lost, and neither may pass what leaves.
//
//   bun write-state-steps-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<place>--<wrapper>--<steps>.mjs or .ts
//   bun write-state-steps-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// Lines of the file, lines of the function, how the place is read and how `@` is stored.
const places: [name: string, ofFile: string, ofFunction: string, read: string, store: string][] = [
  ["local", "", "let place = 1;", "place", "place = @"],
  ["parameter", "", "", "c", "c = @"],
  ["of-the-file", "let place = 1;", "place = 1;", "place", "place = @"],
  ["var-of-the-file", "var place = 1;", "place = 1;", "place", "place = @"],
  ["literal", "", "const o = { x: 1, y: 2 };", "o.x", "o.x = @"],
  ["shared-object", "const o = { x: 1, y: 2 };", "o.x = 1;", "o.x", "o.x = @"],
  ["alias", "", "const o = { x: 1 };\nconst p = [o][0];", "o.x", "p.x = @"],
  [
    "two-of-a-class",
    "class Item {\n  x = 1;\n}",
    "const o = new Item();\nconst p = c & 1 ? o : new Item();",
    "o.x",
    "p.x = @",
  ],
  ["static", "class Holder {\n  static x = 1;\n}", "Holder.x = 1;", "Holder.x", "Holder.x = @"],
  ["element", "", "const l = [1, 2, 3];", "l[0]", "l[0] = @"],
  ["element-by-index", "", "const l = [1, 2, 3];\nconst at = c % 3;", "l[at]", "l[at] = @"],
  ["two-indexes", "", "const l = [1, 2, 3];\nconst at = c % 3;", "l[at]", "l[2 - at] = @"],
  ["typed-element", "", "const l = new Int32Array([1, 2, 3]);", "l[1]", "l[1] = @"],
  ["doubles", "", "const l = [1.5, 2.5];", "l[0]", "l[0] = @"],
  ["map", "", "const m = new Map([[1, 1]]);", "m.get(1)", "m.set(1, @)"],
  ["accessor", "let held = 1;\nconst o = {\n  get x() {\n    return held;\n  },\n  set x(value) {\n    held = value;\n  },\n};", "held = 1;", "o.x", "o.x = @"], // prettier-ignore
  ["computed-name", "", 'const o = { a: 1, b: 2 };\nconst key = c & 1 ? "a" : "b";', "o[key]", "o[key] = @"],
  ["late-field", "", "const o = {};", "o.x", "o.x = @"],
  ["global", "", "globalThis.statePlace = 1;", "globalThis.statePlace", "globalThis.statePlace = @"],
  ["inner-object", "", "const o = { inner: { x: 1 } };", "o.inner.x", "o.inner.x = @"],
  ["replaced-object", "", "let o = { x: 1 };", "o.x", "o = { x: @ }"],
  ["length", "", "const l = [1];", "l.length", "l.length = Math.abs(Number(@) | 0) % 5"],
  ["two-lists", "", 'const l = JSON.parse("[1, 2, 3, 4]");\nconst m = [l, [5, 6, 7, 8]][c & 1];', "l[0]", "m[0] = @"],
  [
    "two-lists-by-index",
    "",
    'const l = JSON.parse("[1, 2, 3, 4]");\nconst m = [[5, 6, 7, 8], l][c & 1];',
    "l[c & 3]",
    "m[(c + 1) & 3] = @",
  ],
  [
    "two-lists-handed-over",
    'const handed = JSON.parse("[1, 2, 3, 4]");\nconst two = (c) => [handed, c & 1 ? handed : [9, 9]];',
    "const [l, m] = two(c);",
    "l[1]",
    "m[1] = @",
  ],
  [
    "two-views",
    "",
    "const b = new ArrayBuffer(16);\nconst l = new Int32Array(b);\nconst m = new Uint8Array(b);",
    "l[0]",
    "m[c & 3] = @",
  ],
  ["last-pushed", "", 'const l = JSON.parse("[1]");', "l[l.length - 1]", "l.push(@)"],
  ["inner-list", "", "const l = [[1], [2]];", "l[0][0]", "l[c & 1][0] = @"],
  ["size-of-a-set", "", "const m = new Set([1]);", "m.size", "m.add(@)"],
  ["text", "", 'let place = "a";', "place.length", "place += @"],
  [
    "private-field",
    "class K {\n  #x = 1;\n  ask() {\n    return this.#x;\n  }\n  keep(x) {\n    this.#x = x;\n  }\n}",
    "const k = new K();",
    "k.ask()",
    "k.keep(@)",
  ],
  [
    "box",
    "const box = () => {\n  let held = 1;\n  return { ask: () => held, keep: x => (held = x) };\n};",
    "const o = box();",
    "o.ask()",
    "o.keep(@)",
  ],
  ["copied-object", "", "let o = { x: 1, y: 2 };\nconst p = o;", "p.x", "o = { ...o, x: @ }"],
];
// `R` reads the place, `W(..)` stores into it, `LEAVE` leaves what the steps stand in.
const steps: [name: string, text: string][] = [
  ["stores", "W(c + 4);"],
  ["stores-a-double", "W(2.5);"],
  ["adds", "W(R + 1);"],
  ["notes", "out.push(R);"],
  ["keeps", "last = R;"],
  ["stores-kept", "W(last);"],
  ["peeks", "peek();"],
  ["pokes", "poke();"],
  ["leaves-when-large", "if (R > 3) LEAVE"],
  ["leaves-by-parameter", "if (c === 2) LEAVE"],
  ["stores-sometimes", "if (c & 1) W(7);"],
  ["fails-sometimes", "fail();"],
  ["asks", 'out.push(R === last ? "same" : "new");'],
  ["stores-twice", "W(8);\nW(9);"],
  ["stores-a-text", 'W("t" + c);'],
  ["stores-an-object", "W({ x: c });"],
  ["stores-nothing", "W(undefined);"],
  ["reads-twice", "for (let q = 0; q < 2; q++) out.push(R);"],
  ["stores-in-a-loop", "for (let q = 0; q < 3; q++) W(q * 0.5);"],
];
const wrappers: [name: string, text: string, leave: string][] = [
  ["straight", "@", 'return end("left");'],
  ["loop", "for (let i = 0; i < 3; i++) {\n@\n}", "break;"],
  ["loop-that-goes-on", "for (let i = 0; i < 3; i++) {\n@\n}", "continue;"],
  ["try", "try {\n@\n} catch {\n  out.push(\"caught\", R);\n}", 'throw new Error("left");'],
  ["finally", "try {\n@\n} finally {\n  out.push(\"behind\", R);\n}", 'return end("left");'],
  ["block", "block: {\n@\n}", "break block;"],
  ["switch", "switch (c & 1) {\n  case 1:\n@\n  default:\n    out.push(R);\n}", "break;"],
  ["try-in-a-loop", "for (let i = 0; i < 3; i++) {\n  try {\n@\n  } catch {\n    out.push(R);\n  }\n}", 'throw new Error("left");'],
  ["called-twice", "const twice = () => {\n@\n};\ntwice();\ntwice();", "return;"],
  ["inner-loop", "for (let i = 0; i < 2; i++) {\n  for (let j = 2; j >= 0; j--) {\n@\n  }\n}", "break;"],
]; // prettier-ignore
const length = 5;
const total = places.length * wrappers.length * steps.length ** length;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const place = pick(places);
  const wrapper = pick(wrappers);
  const picked = Array.from({ length }, () => pick(steps));
  const isTyped = cell % 7 === 5;
  const any = isTyped ? ": any" : "";
  const isGenerator = cell % 11 === 3 && wrapper[0] !== "called-twice";
  const isAsync = cell % 11 === 7 && wrapper[0] !== "called-twice";
  const typed = (text: string) => (isTyped ? text.replace(/^( *(?:let|const|var) (?:place|held|o|p|l|m)) = /gm, "$1: any = ").replace("static x = 1", "static x: any = 1").replace("  x = 1;", "  x: any = 1;").replace("set x(value)", "set x(value: any)").replace("get x()", "get x(): any").replaceAll("globalThis.", "(globalThis as any).").replaceAll("(c) =>", "(c: any): any[][] =>").replaceAll("keep(x) {", "keep(x: any) {").replaceAll("#x = 1;", "#x: any = 1;").replaceAll("ask() {", "ask(): any {").replaceAll("keep: x =>", "keep: (x: any) =>").replaceAll("let held = 1;", "let held: any = 1;").replace("const [l, m] = two(c)", "const [l, m]: any[] = two(c)") : text); // prettier-ignore
  const fill = (text: string): string =>
    text
      .replaceAll(/W\((.*)\);/g, (_, value) => place[4].replace("@", () => fill(value)) + ";")
      .replaceAll(/\bR\b/g, () => place[3])
      .replaceAll("LEAVE", wrapper[2]);
  const indent = (lines: string[]) => lines.map(line => "  " + line);
  const body = picked.flatMap(step => fill(step[1]).split("\n")).flatMap((line, at) => (isGenerator && at === 2 ? ["yield out.length;", line] : isAsync && at === 2 ? ["await null;", line] : [line])); // prettier-ignore
  const lines = [
    ...(place[1] ? place[1].split("\n") : []),
    `let calls = 0;`,
    `${isAsync ? "async " : ""}function ${isGenerator ? "*" : ""}run(c${any})${isTyped ? (isAsync ? ": Promise<any>" : ": any") : ""} {`,
    ...indent([
      `const out${any} = [];`,
      `let last${any} = 0;`,
      ...(place[2] ? place[2].split("\n") : []),
      fill("const peek = () => out.push(R);").replace("()", isTyped ? "(): void" : "()").replace("=> out", isTyped ? "=> void out" : "=> out"), // prettier-ignore
      ...["const poke = () => {", "  " + fill("W(Number(R) + 10);"), "};"],
      ...["const fail = () => {", '  if (calls++ % 4 === 2) throw new Error("failed");', "};"],
      `const end = (how${any}) => [how, ...out, "ends with", ${place[3]}, last].map(one => (Object.is(one, -0) ? "-0" : String(one))).join();`,
      ...fill(wrapper[1]).replace("@", () => body.map(line => "  " + line).join("\n")).split("\n"), // prettier-ignore
      'return end("ended");',
    ]),
    "}",
    ...(isGenerator
      ? [`const ask = (c${any}) => {`, "  const turns = run(c);", "  let turn = turns.next();", "  while (!turn.done) turn = turns.next();", "  return turn.value;", "};"] // prettier-ignore
      : ["const ask = run;"]),
    "for (let turn = 0; turn < 2; turn++)",
    `  for (const c of ${Math.floor(cell / 3) % 2 ? 'JSON.parse("[0, 1, 2, 3, 2.5]")' : "[0, 1, 2, 3, 2.5]"}${isTyped ? " as any[]" : ""}) {`,
    "    try {",
    `      console.log(${isAsync ? "await " : ""}ask(c));`,
    "    } catch (error) {",
    `      console.log("threw", ${isTyped ? "(error as any)" : "error"}?.message);`,
    "    }",
    "  }",
    ...(isTyped ? ["export {};"] : []),
  ];
  return { name: `${place[0]}--${wrapper[0]}--${picked.map(step => step[0]).join("--")}${isTyped ? ".ts" : ".mjs"}`.slice(0, 180), text: typed(lines.join("\n")) + "\n" }; // prettier-ignore
}

const padNumber = (index: number) => String(index).padStart(9, "0");
if (process.argv[2] === "count") console.log(total);
else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? total), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, total); step++) {
    const index = (from + step * stride * 1009) % total;
    const program = write(index);
    writeFileSync(`${folder}/${padNumber(index)}-${program.name}`, program.text);
  }
  console.log(Math.min(count, total));
}
