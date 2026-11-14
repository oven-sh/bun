// A loop reads and stores one field of an object. The stored value is the object itself, another of its fields, the
// loop's counter or sum, another object, or a value of another type. The loop ends in every way a loop can end: its
// test, break, a labeled continue, return, throw, yield and await. The field is read again right after each of them.
// The functions that read and store the field are also called with objects of other shapes, and not the same ones.
import type { Random } from "./random";

/** Expressions that create an object with the fields `f` and `g`. `INIT` is the first value of `f`. */
const holders: Record<string, { make: string; isOnlyUntyped?: true }> = {
  "a literal": { make: "{ f: INIT, g: 1 }" },
  "a literal in another order": { make: "{ g: 2, f: INIT }" },
  "a literal with more members": { make: `{ a: 0, f: INIT, b: "b", g: 3, c: null }` },
  "an instance": { make: "new Holder(INIT)" },
  "an instance of a subclass": { make: "new Wider(INIT)" },
  "a copy": { make: "{ ...{ f: INIT, g: 4 } }" },
  "a result of Object.assign": { make: "Object.assign({ g: 5 }, { f: INIT })" },
  "an object with a prototype": { make: "Object.assign(Object.create({ inherited: 1 }), { f: INIT, g: 6 })", isOnlyUntyped: true }, // prettier-ignore
  "an object that gets the field later": { make: "withFieldLater(INIT)", isOnlyUntyped: true },
};

/** What is stored. `o` is the object, `other` another one, `i` the counter, `sum` what the loop adds up. */
const values = [
  "o",
  "other",
  "o.g",
  "other.f",
  "o.f",
  "i",
  "sum",
  "i * 0.5",
  "-0",
  "2 ** 31 + i",
  "null",
  "undefined",
  `"text" + i`,
  "[i]",
  "{ f: i, g: i }",
  "() => i",
  "i % 2 === 0",
  "BigInt(i)",
];

/** Statements that read the field and change `sum` or `log`. */
const reads = [
  "if (o.f !== null) sum++;",
  "if (o.f === o) sum += 2;",
  "if (o.f === other) sum += 3;",
  `if (typeof o.f === "number") sum += o.f;`,
  "log.push(typeof o.f);",
  "sum += read(o);",
  "if (o.f) sum++;",
  "if (o.f == null) sum += 5;",
  "log.push(kindOf(o.f));",
];

/** `VALUE` is what is stored. */
const stores = ["o.f = VALUE;", "write(o, VALUE);", `o["f"] = VALUE;`, "({ f: o.f } = { f: VALUE });", "Object.assign(o, { f: VALUE });"]; // prettier-ignore

const conditions = ["i === AT", "i % 3 === 1", "i >= AT", "true", "sum > AT", "o.f !== other"];

/** What runs between the read and the store, or after the store. It may read the field without the loop seeing it. */
const between = ["", "", "observe(o);", "hooks[i % hooks.length](o);", "observe(other);", "log.push(JSON.stringify(Object.keys(o)));"]; // prettier-ignore

/**
 * How the loop ends early, after the store, at iteration `LEAVE`. `wrap` puts the loop `LOOP` into the scene's function
 * body. `kind` is the kind of function the scene needs.
 */
const exits: Record<string, { leave: string; wrap: string; kind?: "generator" | "async" }> = {
  "the test": { leave: "", wrap: "LOOP" },
  "break": { leave: "if (i === LEAVE) break;", wrap: "LOOP" },
  "continue": { leave: "if (i === LEAVE) continue;\nsum += 100;", wrap: "LOOP" },
  "a labeled continue": {
    leave: "if (i === LEAVE) continue outer;",
    wrap: `outer: for (let round = 0; round < 2; round++) {\nLOOP\nlog.push("round " + kindOf(o.f));\n}`,
  },
  "a labeled break": {
    leave: "if (i === LEAVE) break outer;",
    wrap: `outer: for (let round = 0; round < 2; round++) {\nLOOP\nlog.push("round " + kindOf(o.f));\n}`,
  },
  "return": { leave: `if (i === LEAVE) return finish("returned");`, wrap: "LOOP" },
  "throw": {
    leave: `if (i === LEAVE) throw new Error("left");`,
    wrap: `try {\nLOOP\n} catch (error) {\nlog.push("caught " + kindOf(o.f));\n}`,
  },
  "a throw in a callee": {
    leave: "if (i === LEAVE) fail();",
    wrap: `try {\nLOOP\n} catch (error) {\nlog.push("caught " + kindOf(o.f));\n}`,
  },
  "finally": {
    leave: "if (i === LEAVE) break;",
    wrap: `try {\nLOOP\n} finally {\nlog.push("finally " + kindOf(o.f));\n}`,
  },
  // The caller reads the field between two steps.
  "yield": { leave: "if (i % 2 === 0) yield o;", wrap: "LOOP", kind: "generator" },
  // `watch` reads the field while the scene is suspended.
  "await": { leave: "if (i % 2 === 0) await null;", wrap: "watched = o;\nLOOP", kind: "async" },
};

const loops = [
  "for (let i = 0; i < COUNT; i++) {\nBODY\n}",
  "let i = -1;\nwhile (++i < COUNT) {\nBODY\n}",
  "for (const i of counters(COUNT)) {\nBODY\n}",
  "for (let i = COUNT - 1; i >= 0; i--) {\nBODY\n}",
];

const indented = (text: string, by: string) =>
  text
    .split("\n")
    .map(line => (line ? by + line : line))
    .join("\n");

export function generate(random: Random, typed: boolean): string {
  const any = typed ? ": any" : "";
  const as = (type: string) => (typed ? `: ${type}` : "");
  const available = Object.values(holders).filter(holder => !typed || !holder.isOnlyUntyped);
  const make = (init: string) => {
    const made = random.pick(available).make.replace("INIT", init);
    return typed ? `(${made}) as Shape` : made;
  };
  const initial = () => random.pick(["null", "0", "1.5", `"first"`, "undefined", "[]"]);
  const scenes: string[] = [];
  const calls: string[] = [];
  for (let scene = 0, count = random.between(2, 5); scene < count; scene++) {
    // Make the random choices first.
    const exit = random.pick(Object.values(exits));
    const iterations = random.pick([3, 8, 40, 300]);
    const at = random.below(iterations);
    const store = () =>
      `if (${random.pick(conditions).replace("AT", String(at))}) ${random.pick(stores).replace("VALUE", random.pick(values))}`;
    const body = [
      random.pick(reads),
      random.pick(between),
      store(),
      random.chance(0.3) ? store() : "",
      random.pick(between),
      random.chance(0.5) ? random.pick(reads) : "",
      exit.leave.replace("LEAVE", String(random.between(at, iterations - 1))),
      random.chance(0.3) ? random.pick(reads) : "",
    ]
      .filter(Boolean)
      .join("\n");
    const loop = random.pick(loops).replaceAll("COUNT", String(iterations)).replace("BODY", indented(body, "  "));
    const head = { generator: "function* ", async: "async function " }[exit.kind!] ?? "function ";
    scenes.push(`${head}scene${scene}() {
  const o${any} = ${make(initial())};
  const other${any} = ${random.chance(0.2) ? "o" : make(initial())};
  const log${as("string[]")} = [];
  let sum = 0;
  const finish = (how${as("string")}) => [how, sum, kindOf(o.f), kindOf(other.f), kindOf(o.g), log.join()].join(" ");
${indented(exit.wrap.replace("LOOP", loop), "  ")}
  return finish("ended");
}`);
    calls.push(
      exit.kind === "generator"
        ? `{
  const steps = scene${scene}();
  const suspended${as("string[]")} = [];
  for (let step = steps.next(); ; step = steps.next()) {
    if (step.done) {
      console.log("scene ${scene}", step.value, suspended.slice(0, 8).join());
      break;
    }
    suspended.push(kindOf(step.value.f));
  }
}`
        : exit.kind === "async"
          ? `{
  const watching = watch();
  console.log("scene ${scene}", await scene${scene}());
  await watching;
}`
          : `console.log("scene ${scene}", scene${scene}());`,
    );
  }
  // `read` and `write` see different sets of shapes.
  const seenByRead = Array.from({ length: random.between(0, 3) }, () => `read(${make(initial())});`);
  const seenByWrite = Array.from({ length: random.between(0, 3) }, () => `write(${make(initial())}, ${initial()});`);
  return `${typed ? "type Shape = { f: any; g: number };\n" : ""}class Holder {
  f${any};
  g = 7;
  constructor(f${any}) {
    this.f = f;
  }
}
class Wider extends Holder {
  h = "h";
}
function withFieldLater(f${any}) {
  const made${any} = { g: 8 };
  made.f = f;
  return made;
}
function kindOf(value${as("unknown")})${as("string")} {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array of " + value.length;
  if (typeof value === "object") return "object with " + Object.keys(value).join("+");
  if (typeof value === "function") return "function";
  return typeof value + " " + (Object.is(value, -0) ? "-0" : String(value));
}
function read(o${any})${as("number")} {
  return typeof o.f === "number" ? o.f : 1;
}
function write(o${any}, value${any}) {
  o.f = value;
}
const seen${as("string[]")} = [];
function observe(o${any}) {
  seen.push(kindOf(o.f));
}
const hooks = [observe, (o${any}) => void (o.g += 1), (o${any}) => void seen.push(String(o.f === o))];
let watched${any};
async function watch() {
  for (let tick = 0; tick < 6; tick++) {
    await null;
    if (watched) seen.push("tick " + kindOf(watched.f));
  }
}
function fail() {
  throw new Error("left");
}
function counters(count${as("number")}) {
  return Array.from({ length: count }, (_, index) => index);
}
${[...seenByRead, ...seenByWrite].join("\n")}
${scenes.join("\n")}
${calls.join("\n")}
console.log(seen.length, seen.slice(0, 12).join(), seen.slice(-4).join());
`;
}
