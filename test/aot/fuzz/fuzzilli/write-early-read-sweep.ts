// A binding or a field that is asked before it has its value: what is declared, times how it is asked, times where both stand, times how often. It is asked once more behind its declaration.
//
//   bun write-early-read-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<declared>--<asked>--<where>--<turns>.mjs or .ts
//   bun write-early-read-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// The declaration and how what it declares is read.
const declared: [name: string, text: string, read: string][] = [
  ["let", "let x = first(1);", "x"],
  ["const", "const x = first(2.5);", "x"],
  ["const-text", 'const x = first("t");', "x"],
  ["let-without-a-value", "let x;", "x"],
  ["var", "var x = first(3);", "x"],
  ["function", "function x() {\n  return 4;\n}", "x()"],
  ["class", "class X {\n  static y = first(5);\n}", "X.y"],
  ["static-of-itself", "class X {\n  static y = first(X.z);\n  static z = 6;\n}", "X.y"],
  ["static-block", "class X {\n  static {\n    note(typeof X.y);\n    X.y = first(7);\n  }\n}", "X.y"],
  ["static-private", "class X {\n  static #y = first(X.ask());\n  static ask() {\n    return #y in X ? X.#y : 8;\n  }\n}", "X.ask()"],
  ["fields-in-order", "class X {\n  a = first(this.b);\n  b = 9;\n}\nconst made = new X();", "made.a"],
  ["field-of-the-heir", "class A {\n  constructor() {\n    this.seen = this.b;\n  }\n}\nclass X extends A {\n  b = first(10);\n}\nconst made = new X();", "made.seen"],
  ["private-field", "class X {\n  a = this.ask();\n  #b = first(11);\n  ask() {\n    try {\n      return this.#b;\n    } catch (error) {\n      return error.name;\n    }\n  }\n}\nconst made = new X();", "made.a"],
  ["parameter", "const x = ((a = b(), c = 12) => a + c)();\nfunction b() {\n  return first(1);\n}", "x"],
  ["parameter-of-itself", "const x = ((a, c = () => a) => c())(first(13));", "x"],
  ["pattern", "const { y: x = first(14), z = 15 } = {};", "x + z"],
  ["two", "const x = first(16), z = x + 1;", "z"],
  ["object", "const x = { y: first(17), get z() {\n  return this.y;\n} };", "x.z"],
  ["closure", "const x = () => later;\nconst later = first(18);", "x()"],
  ["list", "const x = [first(19), first(20)];", "x[1]"],
]; // prettier-ignore
// `R` reads what is declared; what is asked stands in front of the declaration.
const asked: [name: string, text: string][] = [
  ["read", "tell(() => R);"],
  ["read-in-place", "try {\n  note(R);\n} catch (error) {\n  note(error.name);\n}"],
  ["typeof", "tell(() => typeof (R));"],
  ["sum", "try {\n  note(R + 1);\n} catch (error) {\n  note(error.name);\n}"],
  ["called", "const ask = () => R;\ntell(ask);"],
  ["loop", "for (let i = 0; i < 3; i++)\n  try {\n    note(R);\n  } catch (error) {\n    note(error.name);\n  }"],
  ["hoisted", "tell(hoisted);\nfunction hoisted() {\n  return R;\n}"],
  ["chosen", "tell(() => (turn > 5 ? 0 : R));"],
  ["not-reached", "if (turn > 5) note(R);"],
  ["sometimes", "if (turn === 1)\n  try {\n    note(R);\n  } catch (error) {\n    note(error.name);\n  }"],
  ["kept-for-later", "laters.push(() => R);"],
  ["template", "tell(() => `${R}`);"],
  ["two-in-a-row", "tell(() => R);\ntell(() => R);"],
  ["in-a-class", "tell(() => {\n  class Inner {\n    static kept = R;\n  }\n  return Inner.kept;\n});"],
  ["default", "tell(() => ((a = R) => a)());"],
  ["not-at-all", ""],
]; // prettier-ignore
// `FRONT` is what asks, `HERE` the declaration, `BEHIND` the question behind it.
const places: [name: string, text: string][] = [
  ["file", "const turn = 1;\nFRONT\nHERE\nBEHIND"],
  ["function", "function run(turn) {\nFRONT\nHERE\nBEHIND\n}\nfor (let turn = 0; turn < 3; turn++) run(turn);"],
  ["arrow", "const run = turn => {\nFRONT\nHERE\nBEHIND\n};\nrun(0);\nrun(1);"],
  ["block", "const turn = 1;\n{\nFRONT\nHERE\nBEHIND\n}"],
  ["turn-of-a-loop", "for (let turn = 0; turn < 3; turn++) {\nFRONT\nHERE\nBEHIND\n}"],
  ["switch", "function run(turn) {\n  switch (turn) {\n    case 0:\nFRONT\n    case 1:\nHERE\n    default:\nBEHIND\n  }\n}\nfor (let turn = 0; turn < 3; turn++)\n  try {\n    run(turn);\n  } catch (error) {\n    note(error.name);\n  }"],
  ["try", "const turn = 1;\ntry {\nFRONT\nHERE\nBEHIND\n} catch (error) {\n  note(error.name);\n}"],
  ["generator", "function* run(turn) {\nFRONT\n  yield 1;\nHERE\n  yield 2;\nBEHIND\n}\nfor (let turn = 0; turn < 2; turn++) for (const step of run(turn)) note(step);"],
  ["method", "class Runner {\n  run(turn) {\nFRONT\nHERE\nBEHIND\n  }\n}\nfor (let turn = 0; turn < 3; turn++) new Runner().run(turn);"],
]; // prettier-ignore
const total = declared.length * asked.length * places.length * 2;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const what = pick(declared);
  const question = pick(asked);
  // Plain Bun makes a let of a function that is declared in a switch, and does not hoist it.
  const picked = pick(places);
  const place = what[0] === "function" && picked[0] === "switch" ? places[3] : picked;
  const isParsed = rest % 2 === 1;
  const read = what[2];
  const front = question[1].replaceAll(/\bR\b/g, () => read);
  const behind = `try {\n  note(${read});\n} catch (error) {\n  note(error.name);\n}`;
  const lines = [
    "const notes = [];",
    'const note = value => {\n  notes.push(typeof value === "function" ? "function" : typeof value === "object" && value !== null ? "object" : String(value));\n};',
    "const tell = ask => {\n  try {\n    note(ask());\n  } catch (error) {\n    note(error.name);\n  }\n};",
    "const laters = [];",
    `const first = value => ${isParsed ? "[value, 0][process.argv.length > 9 ? 1 : 0]" : "value"};`,
    ...place[1].replace("FRONT", () => front).replace("HERE", () => what[1]).replace("BEHIND", () => behind).split("\n"), // prettier-ignore
    "for (const later of laters) tell(later);",
    "console.log(notes.join());",
  ];
  return { name: `${what[0]}--${question[0]}--${place[0]}--${isParsed ? "unknown" : "known"}.mjs`, text: lines.join("\n") + "\n" }; // prettier-ignore
}

const padNumber = (index: number) => String(index).padStart(4, "0");
if (process.argv[2] === "count") console.log(total);
else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? total), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, total); step++) {
    const index = (from + step * stride) % total;
    const program = write(index);
    writeFileSync(`${folder}/${padNumber(index)}-${program.name}`, program.text);
  }
  console.log(Math.min(count, total));
}
