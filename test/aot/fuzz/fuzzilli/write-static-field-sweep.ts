// A static field of a class is read and stored several times in a turn of a loop, and between two of those accesses something is done to the field: how the accesses are written and where the code that
// does the deed runs, times what is done, times the turn in which it is done, times what the field holds, times the loop, times how the class is named, times the kind of file. Each program holds one of
// each and is built alone.
//
//   bun write-static-field-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<accesses>--<deed>--<where>--<when>--<held>--<loop>--<holder>--<file>
//   bun write-static-field-sweep.ts count
//   bun write-static-field-sweep.ts named <pattern> <folder> [most]
//
// A compiler that keeps such a field in a variable has to ask whether the field still lies there: it may have been deleted, or be an accessor by now. One question may serve every access of a stretch, or
// stand in front of the loop, only where nothing in between can reach the field. A call plainly can. So can an operator or a relation, which ask their operands for numbers, and a read off a proxy. The
// deeds follow each other in steps of 144, the number of ways to write the accesses and the step, so that `<folder> <from> 18 144` writes one program under every deed; the first deed does nothing, and
// what a deed changes shows against it. Each program walks the loop three times: before the deed, with it, and behind it; after each it prints what the walk answered and how the field lies on the class
// and on the class below.
import { mkdirSync, writeFileSync } from "fs";

// STEP answers one, and is where the deed is done.
const accesses: [string, string][] = [
  ["raised-and-read-again", "Tally.count += STEP;\nsum = Tally.count;"],
  ["read-added-and-stored", "Tally.count = Tally.count + STEP;\nsum = Tally.count;"],
  ["added-behind-the-step", "Tally.count = STEP + Tally.count;\nsum = Tally.count;"],
  ["stored-and-read-behind", "Tally.count = i;\nconst by = +STEP;\nsum = Tally.count + by;"],
  ["counted-up-on-both-sides", "Tally.count++;\nconst by = +STEP;\nTally.count++;\nsum = Tally.count + by;"],
  ["two-fields-in-turn", "Tally.count += STEP;\nTally.other += Tally.count;\nsum = Tally.other;"],
  ["read-in-front-of-the-step", "const before = Tally.count;\nsum = before + STEP;"],
  ["read-behind-the-step", "const by = +STEP;\nsum = Tally.count + by;"],
  ["read-on-both-sides", "const before = Tally.count;\nconst by = +STEP;\nsum = before + by + Tally.count;"],
  ["read-three-times-in-one-sum", "sum = Tally.count + STEP + Tally.count + Tally.count;"],
  ["compared-and-read", "sum = Tally.count < STEP + Tally.count ? Tally.count : -1;"],
  [
    "stored-by-another-name-between-two-reads",
    "const before = Tally.count;\nSame.count = before + STEP;\nsum = Tally.count;",
  ],
  [
    "stored-through-the-class-below-between-two-reads",
    "const before = Tally.count;\nHeir.count = before + STEP;\nsum = Tally.count + Heir.count;",
  ],
  [
    "stored-under-a-key-out-of-data-between-two-reads",
    "const before = Tally.count;\nTally[key] = before + STEP;\nsum = Tally.count;",
  ],
];

// These stand only where STEP is a record that is asked for a number.
const operators: [string, string][] = [
  ["minus", "-"],
  ["times", "*"],
  ["divided-by", "/"],
  ["the-remainder-by", "%"],
  ["to-the-power-of", "**"],
  ["or", "|"],
  ["and", "&"],
  ["exclusive-or", "^"],
  ["shifted-left-by", "<<"],
  ["shifted-right-by", ">>"],
  ["shifted-right-without-a-sign-by", ">>>"],
];
const relations: [string, string][] = [
  ["at-most", "<="],
  ["above", ">"],
  ["at-least", ">="],
  ["loosely-the-same-as", "=="],
  ["loosely-another-than", "!="],
];
const accessesAroundRecords: [string, string][] = [
  ...operators.map(([name, sign]): [string, string] => [
    `read-${name}-the-step-and-stored`,
    `Tally.count = Tally.count ${sign} STEP;\nsum = Tally.count;`,
  ]),
  ...relations.map(([name, sign]): [string, string] => [
    `asked-whether-${name}-the-step-and-read`,
    `sum = Tally.count ${sign} STEP ? Tally.count : 0 - Tally.count;`,
  ]),
];

const deeds: [string, string][] = [
  ["nothing-is-done", ""],
  ["another-integer-is-stored", "Tally.count = 500;"],
  ["a-fraction-is-stored", "Tally.count = 0.5;"],
  ["a-text-is-stored", `Tally.count = "t";`],
  ["undefined-is-stored", "Tally.count = undefined;"],
  ["stored-under-a-key-out-of-data", "Tally[key] = 41;"],
  ["stored-by-reflection", `Reflect.set(Tally, "count", 40);`],
  ["assigned-out-of-a-record-from-data", `Object.assign(Tally, JSON.parse('{"count":43}'));`],
  ["deleted", "delete Tally.count;"],
  ["deleted-under-a-key-out-of-data", "delete Tally[key];"],
  ["deleted-and-laid-again", "delete Tally.count;\nTally.count = 47;"],
  ["deleted-and-found-above", "delete Tally.count;\nObject.setPrototypeOf(Tally, { count: 45 });"],
  [
    "an-accessor-is-laid-over-it",
    `Object.defineProperty(Tally, "count", {\n  get() {\n    return 7;\n  },\n  set(value) {\n    noted.push(String(value).slice(-6));\n  },\n  configurable: true,\n});`,
  ],
  [
    "a-getter-alone-is-laid-over-it",
    `Object.defineProperty(Tally, "count", {\n  get() {\n    return 7;\n  },\n  configurable: true,\n});`,
  ],
  ["defined-anew-as-a-value", `Object.defineProperty(Tally, "count", { value: 9 });`],
  ["made-read-only", `Object.defineProperty(Tally, "count", { writable: false });`],
  ["the-class-is-frozen", "Object.freeze(Tally);"],
  ["the-class-below-gets-one-of-its-own", "Heir.count = 44;"],
];

// What is declared beside the class, what is declared inside it, and STEP. DEED is done when `left` comes down to nothing.
const due = "if (--left === 0) {\nDEED\n}\nreturn 1;";
const wheres: [string, string, string, string][] = [
  ["in-a-function-out-of-a-table", `const table = [\n  () => 1,\n  () => {\n  DUE\n  },\n];`, "", "step()"],
  ["in-a-function-called-by-its-name", `function bump() {\nDUE\n}`, "", "bump()"],
  ["in-a-static-method-of-the-class", "", `static bump() {\nDUE\n}`, "Tally.bump()"],
  ["in-the-value-of-a-record", `const weight = {\n  valueOf() {\n  DUE\n  },\n};`, "", "weight"],
  ["in-what-makes-a-record-primitive", `const weight = {\n  [Symbol.toPrimitive]() {\n  DUE\n  },\n};`, "", "weight"],
  ["in-a-getter-of-a-record", `const scale = {\n  get by() {\n  DUE\n  },\n};`, "", "scale.by"],
  [
    "in-a-trap-of-a-proxy",
    `const scale = new Proxy(\n  {},\n  {\n    get() {\n    DUE\n    },\n  },\n);`,
    "",
    "scale.by",
  ],
  ["in-a-function-handed-to-a-built-in", `function bump() {\nDUE\n}`, "", "single.map(bump)[0]"],
];

const whens: [string, number][] = [
  ["in-front-of-the-loop", 0],
  ["in-the-first-turn", 1],
  ["in-the-middle", 50],
  ["in-the-last-turn", 100],
];

const helds: [string, string][] = [
  ["a-small-integer", "1"],
  ["a-text", `"a"`],
];

const loops: [string, string][] = [
  ["counted", "for (let i = 0; i < turns; i++) {\nBODY\n}"],
  ["over-a-list", "for (const i of Array.from({ length: turns }, (_, at) => at)) {\nBODY\n}"],
  [
    "in-a-loop-inside",
    "for (let outer = 0; outer < turns; outer += 10) {\n  for (let i = outer; i < outer + 10; i++) {\n  BODY\n  }\n}",
  ],
  ["in-a-try", "for (let i = 0; i < turns; i++) {\n  try {\n  BODY\n  } finally {\n    tries++;\n  }\n}"],
];

const holders = ["by-its-name", "by-this-in-a-static-method", "a-class-written-into-a-constant"] as const;

const files: [string, string, string][] = [
  ["sloppy", "cjs", ""],
  ["a-module", "mjs", ""],
];

const places: [string, string, number][] = [
  ...accesses.flatMap(([access, stretch]) =>
    wheres.map((_, where): [string, string, number] => [access, stretch, where]),
  ),
  ...accessesAroundRecords.flatMap(([access, stretch]) =>
    wheres.flatMap(([, , , step], where): [string, string, number][] =>
      step === "weight" ? [[access, stretch, where]] : [],
    ),
  ),
];

const all = places.length * deeds.length * whens.length * helds.length * loops.length * holders.length * files.length;

const indented = (text: string, by: string) =>
  text
    .split("\n")
    .map(line => (line ? by + line : line))
    .join("\n");
const laidAt = (shape: string, word: string, text: string) => shape.replace(new RegExp(`^( *)${word}$`, "m"), (_, by: string) => indented(text, by + "  ")); // prettier-ignore

function write(at: number): { name: string; text: string } {
  const pick = <T>(list: readonly T[]): T => {
    const one = list[at % list.length];
    at = Math.floor(at / list.length);
    return one;
  };
  const [access, stretch, place] = pick(places);
  const [deed, done] = pick(deeds);
  const [where, beside, inside, step] = wheres[place];
  const [when, turn] = pick(whens);
  const [held, first] = pick(helds);
  const [loop, shape] = pick(loops);
  const holder = pick(holders);
  const [file, extension, head] = pick(files);

  const inTurns = turn > 0 ? done : "";
  const whenDue = inTurns ? laidAt(due, "DEED", inTurns) : "left--;\nreturn 1;";
  const isMethod = holder === "by-this-in-a-static-method";
  const turnOfLoop = stretch
    .replaceAll("STEP", step)
    .replace(/\bTally\.(count|other)\b/g, isMethod ? "this.$1" : "Tally.$1");
  const walk = `raise(turns, which) {
${where === "in-a-function-out-of-a-table" ? "  const step = table[which];\n" : ""}  let sum = "";
${indented(laidAt(shape, "BODY", turnOfLoop), "  ")}
  return sum;
}`;
  const members = [`static count = ${first};`, "static other = 0;", inside && laidAt(inside, "DUE", whenDue), isMethod && `static ${walk}`].filter(Boolean).join("\n"); // prettier-ignore
  const call = isMethod ? "Tally.raise" : "raise";
  const text = `${head}const said = [];
const noted = [];
let left = 0;
let tries = 0;
const through = new Function("x", "return x");
const key = JSON.parse('"count"');
const single = JSON.parse("[0]");
${holder === "a-class-written-into-a-constant" ? "const Tally = class {" : "class Tally {"}
${indented(members, "  ")}
}${holder === "a-class-written-into-a-constant" ? ";" : ""}
class Heir extends Tally {}
const Same = Tally;
${beside ? laidAt(beside, "DUE", whenDue) + "\n" : ""}${isMethod ? "" : `function ${walk}\n`}function lies() {
  const own = Object.getOwnPropertyDescriptor(Tally, "count");
  const how = own ? [Object.keys(own).join(), String(own.value), own.writable, own.enumerable, own.configurable].join(" ") : "is not its own";
  return [typeof Tally.count, String(Tally.count), how, Object.keys(Tally).join(), Object.hasOwn(Heir, "count"), String(Heir.count), String(Tally.other), noted.length, noted.slice(-3).join(), tries].join(" | ");
}
function tell(what) {
  try {
    said.push(String(what()));
  } catch (error) {
    said.push(error.constructor.name + ": " + error.message);
  }
  said.push(lies());
}
tell(() => ${call}(through(100), through(1)));
${
  turn > 0
    ? `left = through(${turn});`
    : `tell(() => {
${indented(done || "left = 0;", "  ")}
  return "done";
});`
}
tell(() => ${call}(through(100), through(1)));
tell(() => ${call}(through(100), through(1)));
console.log(said.join("\\n"));
`;
  return { name: `${access}--${deed}--${where}--${when}--${held}--${loop}--${holder}--${file}.${extension}`, text };
}

const pad = (at: number) => String(at).padStart(6, "0");
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
