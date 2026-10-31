// `made.members = ..; made.properties = ..; made.signatures = ..`: a function stores several new names, one after the other, on
// an object that was made elsewhere. The room for all of them may be taken at the first store. A name whose store did not run
// must still be absent: some stores stand behind a condition, an early return or something that throws, and afterwards the
// program asks which names are there, in which order, and with which values. Each scene has a class or a literal of its own,
// one function that fills the object and is called again and again, and no helper between them.
import type { Random } from "./random";

const names = [
  "members",
  "properties",
  "signatures",
  "flags",
  "target",
  "mapper",
  "id",
  "parent",
  "extra",
  "cache",
  "links",
  "escaped",
];

/** Statements that make `made`. */
const makers = [
  "const made = new Kind(i);",
  "const made = new Kind(i);",
  "const made = new Kind(i);",
  "const made = { a: i, b: 2 };",
  "const made = { a: i };",
  "const made = {};",
  "const made = new Below(i);",
  "const made = Object.create(Kind.prototype);",
  "const made = i % 2 ? new Kind(i) : new Below(i);",
  "const made = new Wide(i);",
  "const made = new Wide(i);",
  "const made = new Wide(i);",
  "const made = new Wide(i);",
];

const values = ["i", "i / 4", '"text" + i', "[i]", "{ n: i }", "undefined", "null", "made", "() => i", "i % 2 === 0"];

/** What may stand between two stores. */
const between = [
  "",
  "",
  "",
  "",
  "if (i % 3 === 0) return;",
  "if (i % 5 === 1) fail();",
  "touch();",
  "if (i % 7 === 2) Object.freeze(made);",
  "if (i % 7 === 2) Object.preventExtensions(made);",
  "if (i % 7 === 2) Object.seal(made);",
  "if (i % 40 === 3) Bun.gc(true);",
  "if (i % 4 === 1) delete made.NAME;",
  "made.a = i + 1;",
  "sum += made.NAME === undefined ? 1 : 2;",
];

export function generate(random: Random): string {
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(2, 4); scene < total; scene++) {
    // An object with many fields keeps the late ones outside its cell.
    const picked = random.sample(
      [...names, ...Array.from({ length: 24 }, (_, at) => `late${at}`)],
      random.pick([2, 4, 8, 16, 30]),
    );
    const stores = picked.map((name, at) => {
      const store = `made.${name} = ${random.pick(values)};`;
      const guarded = random.pick(["STORE", "STORE", "STORE", "STORE", "if (i % 2) STORE", "if (i % 9 !== 4) STORE", "if (i === 3) STORE", "for (let n = 0; n < 2; n++) STORE"]).replace("STORE", store); // prettier-ignore
      return `${random.pick(between).replaceAll("NAME", picked[Math.max(at - 1, 0)])}\n  ${guarded}`;
    });
    const onPrototype = random.pick(["", "", "", `Object.defineProperty(Kind.prototype, "${picked[0]}", { set(value) { sum += 100; }, get() { return "from above"; }, configurable: true });`, `Kind.prototype.${picked[picked.length - 1]} = "from above";`, `Object.defineProperty(Kind.prototype, "${picked[0]}", { value: "read-only above", writable: false });`]); // prettier-ignore
    const text = `class Kind {
  constructor(a) {
    this.a = a;
    this.b = 2;
  }
}
class Below extends Kind {
  c = 3;
}
class Wide {
  constructor(a) {
    this.a = a;
    ${Array.from({ length: random.pick([4, 12, 30, 70]) }, (_, at) => `this.w${at} = ${at};`).join("\n    ")}
  }
}
${onPrototype}
function fill(made, i) {
  ${stores.join("\n  ")}
}
function scene() {
  const seen = new Set();
  let thrown = 0;
  const kept = [];
  for (let i = 0; i < ${random.pick([4, 12, 60, 400])}; i++) {
    ${random.pick(makers)}
    try {
      fill(made, i);
    } catch (error) {
      thrown++;
    }
    let line = Object.keys(made).join();
    ${random
      .sample(picked, Math.min(picked.length, 3))
      .map(name => `line += " " + ("${name}" in made) + typeof made.${name};`)
      .join("\n    ")}
    seen.add(line);
    if (i % 16 === 5) kept.push(made);
  }
  Bun.gc(true);
  let later = "";
  for (const made of kept.slice(0, 3)) later += Object.keys(made).length + ":" + typeof made.${picked[0]} + typeof made.${picked[picked.length - 1]} + ";";
  return [thrown, seen.size, [...seen].sort().slice(0, 5).join(" / "), later].join(" | ");
}
sum = 0;
console.log("scene ${scene}", scene(), sum);`;
    scenes.push(text.replace(/\b(Kind|Below|Wide|fill|scene)\b(?! \d)/g, `$1${scene}`));
  }
  return `let sum = 0;
let touched = 0;
function touch() {
  touched++;
}
function fail() {
  throw new Error("failed");
}
${scenes.join("\n")}
`;
}
