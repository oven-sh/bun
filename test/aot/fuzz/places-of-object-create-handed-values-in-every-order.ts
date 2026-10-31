// Each place of `Object.create(below)` makes a class of its own. The members of the class are those of the literal that the
// place is handed, and the literal becomes the prototype object of the class at the first call that hands it. What else the
// place is handed, and when, decides what each object is: Object.prototype, null, an array, a function, another literal, an
// object that no place of the program made, an object that the same place made, what is no object at all. Each scene has a
// place, sometimes a second one that makes objects below what the first makes, and a list of calls in a random order. After
// every call it reads a getter, calls two methods and says what lies above every object made so far: an object has the
// members of the literal only while it lies below it.
import type { Random } from "./random";

/** What the first place is handed. `members` comes often: a place that never sees its literal has no class to get wrong. */
const handed = [
  "members",
  "members",
  "members",
  "Object.prototype",
  "Object.prototype",
  "Object.prototype",
  "null",
  "null",
  "[]",
  "function () {}",
  "other",
  "fromText(members)",
  "fromText(Object.prototype)",
  "5",
  '"text"',
  "made[0] ?? null",
  "Object.getPrototypeOf({ plain: 1 })",
  "Object.getPrototypeOf(made[made.length - 1] ?? {})",
];

/** What the second place is handed: it makes objects below what the first place makes. */
const handedBelow = [
  "make(members)",
  "make(members)",
  "make(Object.prototype)",
  "make(null)",
  "fromText(members)",
  "members",
  "made[0] ?? make(members)",
  "fromText(make(members))",
];

/** What a program does between two calls. */
const between = [
  "",
  "",
  "",
  "if (made.length) Object.setPrototypeOf(made[0], members);",
  "if (made.length) Object.setPrototypeOf(made[0], Object.prototype);",
  "if (made.length) Reflect.setPrototypeOf(made[made.length - 1], Object.getPrototypeOf(made[made.length - 1]));",
  'members.later = function () {\n    return "later " + secret.text + " " + this.items;\n  };',
  'Object.defineProperty(members, "size", { get() {\n    return "redefined";\n  }, configurable: true });',
  "members.m = function () {\n    return 3;\n  };",
  "delete members.m;",
  "for (let i = 0; i < 40; i++) made.push(make(i % 2 ? members : Object.prototype));",
  "for (let i = 0; i < 40; i++) made.push(make(i % 3 ? members : null));",
];

export function generate(random: Random): string {
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(2, 4); scene < total; scene++) {
    const hasSecondPlace = random.chance(0.4);
    // Some literals are empty at first and get their members later: a call of a member that is not there yet must throw.
    const literal = random.chance(0.3)
      ? "{}"
      : '{ get size() {\n  return this.items;\n}, m() {\n  return "members";\n} }';
    const steps: string[] = [];
    for (let step = 0, count = random.between(3, 7); step < count; step++) {
      const call =
        hasSecondPlace && random.chance(0.35) ? `leaf(${random.pick(handedBelow)})` : `make(${random.pick(handed)})`;
      steps.push(`  ${random.pick(between)}
  try {
    made.push(${call});
  } catch (error) {
    console.log("scene ${scene} step ${step} threw", error.constructor.name);
  }
  console.log("scene ${scene} step ${step}", tally(made.map(say)));`);
    }
    // Every name of a scene ends in its number: each scene has places, literals and readers of its own.
    scenes.push(
      `const members = ${literal};
const other = { m() {
  return "other";
} };
const made = [];
function make(below) {
  const created = Object.create(below);
  created.items = ${scene + 7};
  return created;
}
function leaf(below) {
  const created = Object.create(below);
  created.extra = 1;
  return created;
}
function read(object) {
  return object.size;
}
function call(object) {
  try {
    return object.m();
  } catch (error) {
    return error.constructor.name;
  }
}
function callLater(object) {
  return object.later?.() ?? "none";
}
function where(object) {
  const above = Object.getPrototypeOf(object);
  return above === members ? "members" : above === Object.prototype ? "Object.prototype" : above === null ? "null" : above === other ? "other" : typeof above;
}
const say = object => read(object) + " " + call(object) + " " + callLater(object) + " " + where(object);
function scene(label) {
  const secret = { text: label + process.argv.length };
${steps.join("\n")}
}
scene("scene");`.replace(
        /\b(members|other|made|make|leaf|read|call|callLater|where|say|scene)\b(?! \d| step)/g,
        `$1${scene}`,
      ),
    );
  }
  return `// An object that no place of this program made: it comes out of a text.
const fromText = above => Object.setPrototypeOf(JSON.parse("{}"), above);
// How many objects say the same, in the order in which each was first said.
const tally = said => [...said.reduce((counts, each) => counts.set(each, (counts.get(each) ?? 0) + 1), new Map())].map(([each, count]) => count + " x " + each).join(" | ");
${scenes.join("\n")}
`;
}
