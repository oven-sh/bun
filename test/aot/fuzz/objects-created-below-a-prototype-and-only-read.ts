// `const made = Object.create(shared); made.a = i; sum += made.a;`: an object below a prototype that is only stored into and
// read. Where its own stores answer all its reads, the compiler need not make it, nor link it. But the prototype has a say: a
// setter or a read-only member under the stored name takes the store, a name that was not stored is read from above, and what
// is no object and not null is refused with a TypeError. Each scene picks the prototype, the stores and the reads, runs them in
// a loop, and in a few iterations changes the prototype or lets the object be seen.
import type { Random } from "./random";

/** Expressions for the prototype. */
const prototypes = [
  "shared",
  "shared",
  "shared",
  "null",
  "{}",
  '{ a: "from above" }',
  "Object.prototype",
  "withSetter",
  "withGetter",
  "readOnly",
  "Object.freeze({ a: 1 })",
  "Kind.prototype",
  "new Kind()",
  "function () {}",
  "[]",
  'new Proxy({}, { set: () => (log.push("set trap"), true) })',
  'new Proxy({ a: 5 }, { get: (target, name) => (log.push("get trap"), target[name]) })',
  "undefined",
  "5",
  '"text"',
  "word(shared)",
  "word(null)",
  "word(5)",
  "i % 2 ? shared : null",
  "Object.create(withSetter)",
];

/** Expressions that make the object below PROTO. */
const makers = [
  "Object.create(PROTO)",
  "Object.create(PROTO)",
  "Object.create(PROTO)",
  "Object.create(PROTO, { a: { value: 1, writable: true, enumerable: true, configurable: true } })",
  "Object.create(PROTO, {})",
  "Object.setPrototypeOf({}, PROTO)",
  "{ __proto__: PROTO }",
  "{ __proto__: PROTO, a: 0 }",
  "Object.assign(Object.create(PROTO), { a: 0 })",
];

const stores = [
  "made.a = i;",
  "made.a = i;",
  "made.a = i;\n      made.b = i + 1;",
  "made.b = i;",
  "",
  "made[name] = i;",
  "made.a = i;\n      made.a += 1;",
  "made.a ??= i;",
  'Object.defineProperty(made, "a", { value: i });',
];

const reads = [
  "sum += made.a;",
  "sum += made.a;",
  "sum += made.a + made.b;",
  "sum += made.c === undefined ? 1 : 2;",
  "sum += made.shout ? made.shout().length : 0;",
  'sum += "a" in made ? 1 : 0;',
  'sum += Object.hasOwn(made, "a") ? 1 : 0;',
  "sum += Object.keys(made).length;",
  "sum += Object.getPrototypeOf(made) === shared ? 1 : 0;",
  "sum += made instanceof Kind ? 1 : 0;",
  "sum += typeof made.toString;",
  "for (const each in made) sum += each.length;",
  "sum += shared.isPrototypeOf(made) ? 1 : 0;",
];

const rare = [
  "",
  "",
  "",
  "kept.push(made);",
  'shared.a = "changed above";',
  'Object.defineProperty(shared, "a", { set(value) {\n        log.push("late setter");\n      }, configurable: true });',
  "delete shared.a;",
  "unknown(made);",
  "Object.freeze(shared);",
  "sum += JSON.stringify(made).length;",
];

export function generate(random: Random): string {
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(3, 6); scene < total; scene++) {
    // Half of the scenes are straight: a function makes the object, stores and reads, with no branch and no call in between.
    // Only there can the object stay unmade.
    const isStraight = random.chance(0.5);
    // Mostly a straight scene is the plain case, in which the stores answer the reads. The rest are its neighbors.
    const isUsual = isStraight && random.chance(0.6);
    const made = (isUsual ? makers[0] : random.pick(makers)).replace(
      "PROTO",
      random.pick(isUsual ? prototypes.slice(0, 5) : prototypes),
    );
    const read = isUsual ? [reads[0]] : isStraight ? random.sample(reads.slice(0, 4), random.between(1, 2)) : random.sample(reads, random.between(1, 3)); // prettier-ignore
    const body = `const made = ${made};
      ${isUsual ? stores[0] : random.pick(stores)}
      ${isStraight ? "" : `if (${random.pick(["i === 1", "i % 37 === 5", "false"])}) {\n        ${random.pick(rare)}\n      }`}
      ${read.join("\n      ")}`;
    scenes.push(`const shared${scene} = { shout() {\n  return "shout";\n}, c: ${random.pick(["undefined", "3"])} };
${isStraight ? `function one${scene}(i, name, shared) {\n  let sum = 0;\n      ${body}\n  return sum;\n}` : ""}
function scene${scene}(name) {
  const shared = shared${scene};
  let sum = 0;
  let thrown = "";
  for (let i = 0; i < ${random.pick([1, 3, 60, 400])}; i++) {
    try {
      ${isStraight ? `sum += one${scene}(i, name, shared);` : body}
    } catch (error) {
      if (!thrown.includes(error.name)) thrown += error.name;
    }
  }
  return sum + " | " + thrown;
}
console.log("scene ${scene}", scene${scene}(${random.pick(['"a"', '"b"', '"__proto__"', '"fresh"'])}), "| kept", kept.splice(0).map(each => JSON.stringify(each) + Object.keys(Object.getPrototypeOf(each) ?? {}).join()).join(";"), "| log", log.length, log.splice(0)[0]);`);
  }
  return `const kept = [];
const log = [];
const word = value => (process.argv[9] ? {} : value);
const ways = [made => Object.keys(made).length, made => ((made.seen = true), 1), made => made.a];
let calls = 0;
const unknown = made => ways[calls++ % ways.length](made);
class Kind {
  get a() {
    return "accessor of the class";
  }
  set a(value) {
    log.push("setter of the class");
  }
}
const withSetter = {
  set a(value) {
    log.push("setter");
  },
};
const withGetter = {
  get a() {
    log.push("getter");
    return 7;
  },
};
const readOnly = Object.defineProperty({}, "a", { value: "read-only", writable: false });
${scenes.join("\n")}
`;
}
