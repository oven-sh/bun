// `{ ...source }`, `Object.assign({}, source)` and a rest pattern call a getter of the source in the middle of the copy, and the getter
// may change the source, the target, or what lies above the target. A run time that remembers where the properties of such a source
// lie has to notice. Each scene copies at one place many times. The getter does nothing for some rounds, so that whatever the place
// remembers is in use, and then acts: it removes, adds, hides, shows or redefines a property, closes an object, collects, or copies
// at the same place again. What is asked: the keys of copy and source in order, with their descriptors, and the order in which
// getters and setters ran.
import type { Random } from "./random";
import { scriptMarker } from "./runners";

/**
 * Names made at run time are removed by putting them together again: a list of the keys would hold the strings that are to be freed.
 * `filled` is what `make` was last given. `self` is the source, `aim` the target where the scene has one of its own, `above` the prototype of that target.
 */
const effects = [
  "delete self.later;",
  "delete self.later;",
  "delete self.first;",
  "delete self.later;\n        delete self.last;",
  "self.added = round;",
  "self.added = round;",
  'self.later = "changed";',
  'self.first = "changed";',
  'delete self.later;\n        self.later = "again";',
  'Object.defineProperty(self, "later", { enumerable: false });',
  'Object.defineProperty(self, "hidden", { enumerable: true });',
  'Object.defineProperty(self, "later", { get() { seen.push("late getter"); return "late"; }, enumerable: true, configurable: true });',
  'Object.defineProperty(self, "counted", { value: "a value now", enumerable: true, writable: true, configurable: true });',
  'Object.defineProperty(self, "last", { value: "read-only", writable: false });',
  "Object.setPrototypeOf(self, { inherited: 1 });",
  "Object.freeze(self);",
  "Object.preventExtensions(self);",
  'for (let at = 0; at < 40; at++) self["grown" + at] = at;',
  'for (let at = 0; "made " + filled + " " + at in self; at++) delete self["made " + filled + " " + at];\n        collect();',
  'for (let at = 0; "made " + filled + " " + at in self; at++) delete self["made " + filled + " " + at];\n        collect();',
  'for (let at = 0; "made " + filled + " " + at in self; at++) delete self["made " + filled + " " + at];\n        for (let at = 0; at < 6; at++) self["other " + round + " " + at] = at;\n        collect();',
  "collect();",
  "collect();",
  'self[0] = "element";',
  "self[tag] = round;",
  'throw new RangeError("from the getter");',
  "if (aim) Object.freeze(aim);",
  "if (aim) Object.preventExtensions(aim);",
  'if (aim) Object.defineProperty(aim, "later", { set(value) { seen.push("set later " + String(value)); }, enumerable: true, configurable: true });',
  'if (aim) Object.defineProperty(aim, "later", { value: "read-only", writable: false, enumerable: true, configurable: true });',
  "if (aim) delete aim.first;",
  'if (aim) aim.last = "already there";',
  'if (aim) for (let at = 0; at < 40; at++) aim["grown" + at] = at;',
  'if (above) Object.defineProperty(above, "later", { set(value) { seen.push("set above " + String(value)); }, configurable: true });',
  'if (above) Object.defineProperty(above, "last", { value: "above", writable: false, configurable: true });',
  'busy = true;\n        try {\n          seen.push("inside: " + shown(copy(make(round))));\n        } finally {\n          busy = false;\n        }',
  'busy = true;\n        try {\n          seen.push("inside: " + shown(copy(self)));\n        } finally {\n          busy = false;\n        }',
];

/** Each declares `made`. `GETTER` is an accessor in a literal, `DESCRIPTOR` the same as a descriptor. */
const makers = [
  'const made$A = { first: i, GETTER, later: "later", last: i + 1 };',
  'const made$A = { first: i, GETTER, later: "later", last: i + 1 };',
  'const made$A = { first: i, GETTER, later: "later", last: i + 1 };',
  'const made$A = { GETTER, first: i, later: "later", last: i + 1 };',
  'const made$A = { first: i, later: "later", last: i + 1, GETTER };',
  'const made$A = { first: i, GETTER, later: "later", get second() { seen.push("get second"); return "second"; }, last: i + 1 };',
  'const made$A = { first: i, later: "later", last: i + 1 };\n    Object.defineProperty(made, "counted", DESCRIPTOR);',
  'const made$A = { first: i, counted: 0, later: "later", last: i + 1 };\n    Object.defineProperty(made, "counted", DESCRIPTOR);',
  'const made$A = new Row(i);\n    Object.defineProperty(made, "counted", DESCRIPTOR);',
  `const made$A = JSON.parse('{"first":1,"counted":0,"later":"later","last":2}');\n    Object.defineProperty(made, "counted", DESCRIPTOR);`,
  'const made$A = {};\n    for (const key of ["first", "counted", "later", "last"]) made[key] = key.length + i;\n    Object.defineProperty(made, "counted", DESCRIPTOR);',
  'const made$A = Object.defineProperties(Object.create(null), Object.getOwnPropertyDescriptors({ first: i, GETTER, later: "later", last: i + 1 }));',
];

/** The exports object of a CommonJS module, emptied and filled again. Split into several files the program is an ES module: an ordinary object. */
const exportsMaker = `const made = typeof module === "object" ? module.exports : {};
    for (const name of Reflect.ownKeys(made)) delete made[name];
    made.first = i;
    Object.defineProperty(made, "counted", DESCRIPTOR);
    made.later = "later";
    made.last = i + 1;`;

/**
 * One object for all rounds, emptied and filled again. It goes through the same shapes every round, so a shape that a place has met
 * the round before is met again behind a getter that has just taken a property away.
 */
const keptMakers = [
  `const made$A = kept;
    for (const name of Reflect.ownKeys(made)) delete made[name];
    made.first = i;
    Object.defineProperty(made, "counted", DESCRIPTOR);
    made.later = "later";
    made.last = i + 1;`,
  `const made$A = kept;
    for (const name of Reflect.ownKeys(made)) delete made[name];
    Object.defineProperty(made, "counted", DESCRIPTOR);
    made.later = "later";`,
  `const made$A = kept;
    for (const name of Reflect.ownKeys(made)) delete made[name];
    Object.assign(made, { first: i, counted: 0, later: "later", last: i + 1 });
    Object.defineProperty(made, "counted", DESCRIPTOR);`,
];

/** What else the source holds. */
const additions = [
  'for (let at = 0; at < 6; at++) made["made " + i + " " + at] = at;',
  'for (let at = 0; at < 6; at++) made["made " + i + " " + at] = at;',
  'for (let at = 0; at < 300; at++) made["made " + i + " " + at] = at;',
  'Object.defineProperty(made, "hidden", { value: "hidden", enumerable: false, writable: true, configurable: true });',
  'Object.defineProperty(made, "hidden", { value: "hidden", enumerable: false, writable: true, configurable: true });',
  'made[tag] = "symbol";',
  'made[0] = "zero";',
  'Object.defineProperty(made, "__proto__", { value: "own", enumerable: true, writable: true, configurable: true });',
  "made.extra = 1;\n    delete made.extra;",
  'for (let at = 0; at < 70; at++) made["name" + at] = at;',
  'made["shape" + (i % 20)] = i;',
  'made["shape" + (i % 20)] = i;',
  'made["shape" + (i % 3)] = i;',
  "Object.seal(made);",
];

/** `isOpen`: only for a source of type any. */
const ways: readonly { text: string; isOpen?: true }[] = [
  { text: "return { ...source };" },
  { text: "return { ...source };" },
  { text: "return { ...source };" },
  { text: "return Object.assign({}, source);" },
  { text: "return Object.assign({}, source);" },
  { text: "return Object.assign({}, source);" },
  { text: 'return { label: "label", ...source };' },
  { text: 'return { ...source, label: "label" };' },
  { text: 'return { first: "default", later: "default", absent: "default", ...source };', isOpen: true },
  { text: "return { ...source, ...source };" },
  { text: 'return { ...source, ...{ later: "over" } };' },
  { text: "return Object.assign({}, source, source);" },
  { text: "return Object.assign({}, null, source, undefined, { z: 1 });" },
  { text: 'aim = { label: "label" };\n    return Object.assign(aim, source);' },
  { text: 'aim = { later: "old", first: "old", label: "label" };\n    return Object.assign(aim, source);' },
  { text: "aim = new Target();\n    return Object.assign(aim, source);" },
  { text: "above = { marker: 1 };\n    aim = Object.create(above);\n    return Object.assign(aim, source);" },
  { text: "above = { marker: 1 };\n    aim = Object.create(above);\n    return Object.assign(aim, source);" },
  { text: "aim = [];\n    return Object.assign(aim, source);" },
  { text: "const { first, ...rest } = source;\n    return rest;" },
  { text: "const { counted, ...rest } = source;\n    return rest;" },
  { text: 'const { [word("later")]: taken, ...rest } = source;\n    return rest;', isOpen: true },
  { text: "return Object.fromEntries(Object.entries(source));" },
  { text: "return { values: Object.values(source).join() };" },
  { text: "return { text: JSON.stringify(source) };" },
];

export function generate(random: Random, typed: boolean): string {
  const pick = <T>(list: readonly T[]) => list[random.below(list.length)];
  const any = typed ? ": any" : "";
  const scenes: string[] = [];
  let isScript = false;
  const count = random.between(2, 5);
  for (let scene = 0; scene < count; scene++) {
    const rounds = pick([3, 20, 20, 60, 60, 200]);
    const isKept = random.chance(0.3);
    // A shape is met again where the getter does the same thing in a later round.
    const again = [
      `round >= ${rounds >> 1}`,
      "true",
      "round % 2 === 1",
      "round % 7 === 3",
      `round >= ${random.below(rounds)}`,
    ];
    const due = pick(
      isKept && random.chance(0.7)
        ? again
        : [
            `round === ${random.below(rounds)}`,
            `round === ${random.below(rounds)}`,
            `round === ${rounds - 1}`,
            `round === ${rounds >> 1}`,
            "round % 7 === 3",
            `round >= ${rounds >> 1}`,
            "true",
          ],
    );
    const effect = pick(
      isKept && random.chance(0.5) ? effects.filter(text => text.startsWith("delete self.")) : effects,
    );
    const body = `const self = this${typed ? " as any" : ""};
      seen.push("get counted");
      if (!busy && ${due}) {
        struck = true;
        ${effect}
      }
      return "counted " + round;`;
    const isShaped = typed && random.chance(0.4);
    // An effect brings what it acts on: a target, something above the target, names made at run time, a hidden property.
    const acted = effect.includes("above") ? "above = " : effect.includes("aim") ? "aim = " : "";
    const way = pick(ways.filter(each => (!isShaped || !each.isOpen) && each.text.includes(acted)));
    const added = [additions, additions].filter(() => random.chance(0.45)).map(pick);
    const removesNames = effect.includes('"made"');
    if (removesNames)
      added.push(`for (let at = 0; at < ${pick([6, 6, 300, 700])}; at++) made["made " + i + " " + at] = at;`);
    if (effect.includes('"hidden"')) added.push(additions.find(text => text.includes('"hidden"'))!);
    const copiesExports = !typed && !isKept && random.chance(removesNames ? 0.5 : 0.15);
    isScript ||= copiesExports;
    const maker = (copiesExports ? exportsMaker : pick(isKept ? keptMakers : makers))
      .replace("$A", any)
      .replace("GETTER", () => `get counted()${any} {\n      ${body}\n    }`)
      .replace("DESCRIPTOR", () => `{\n      get()${any} {\n      ${body}\n      },\n      enumerable: true,\n      configurable: true,\n    }`); // prettier-ignore
    const isShared = random.chance(0.3);
    scenes.push(`{
  let round = 0;
  let busy = false;
  let struck = false;
  let aim${any};
  let above${any};
  let filled = 0;${isKept ? `\n  const kept${any} = ${pick(["{}", "{}", "Object.create(null)", "new Row(0)", "{ first: 0, later: 0 }"])};` : ""}
  function make(i${typed ? ": number" : ""})${any} {
    filled = i;
    ${maker}${added.map(text => "\n    " + text).join("")}
    return made;
  }
  function copy(source${isShaped ? ": Shape" : any})${any} {
    ${way.text}
  }
  let hash = 0;
  let last = "";
  let atFirst = "";
  ${isShared ? "const shared = make(0);\n  " : ""}for (round = 0; round < ${rounds}; round++) {
    seen.length = 0;
    struck = false;
    aim = above = undefined;
    let source${any};
    try {
      source = ${isShared ? "shared" : "make(round)"};
      last = shown(copy(source));
    } catch (error) {
      last = "threw " + ${typed ? "(error as Error).name" : "error.name"};
    }
    last += " | " + shown(source) + " | " + shown(aim) + " | " + shown(above) + " # " + seen.join();
    if (struck && !atFirst) atFirst = round + ": " + last;
    for (let at = 0; at < last.length; at++) hash = (hash * 31 + last.charCodeAt(at)) | 0;
  }
  console.log("scene ${scene}", hash, short(atFirst));
  console.log("  at the end", short(last));
}`);
  }
  // Without the marker every program becomes an ES module, which has no exports object. Strict, as a module is.
  return `${isScript ? scriptMarker + '"use strict";\n' : ""}const word${typed ? ": (text: string) => string" : ""} = Function("text", "return text")${
    typed ? " as (text: string) => string" : ""
  };
const tag = Symbol("tag");
const seen = ["emptied before each round"];
${typed ? "interface Shape {\n  first: any;\n  counted: any;\n  later: any;\n  last: any;\n}\n" : ""}class Row {
  first${any};
  later${any} = "later";
  last${any};
  constructor(i${typed ? ": number" : ""}) {
    this.first = i;
    this.last = i + 1;
  }
}
class Target {
  label${any} = "target";
  later${any} = "old";
}
function shown(value${any})${typed ? ": string" : ""} {
  if (value === null || typeof value !== "object") return String(value);
  const parts = Reflect.ownKeys(value).map(key => {
    const found = Object.getOwnPropertyDescriptor(value, key)${typed ? "!" : ""};
    const held = "value" in found ? (found.writable ? "=" : "!=") + String(found.value) : ":accessor";
    return String(key) + (found.enumerable ? "" : "~") + (found.configurable ? "" : "^") + held;
  });
  const prototype = Object.getPrototypeOf(value);
  return (
    parts.join() +
    (Object.isExtensible(value) ? "" : " closed") +
    (prototype === Object.prototype ? "" : prototype === null ? " below null" : " below another")
  );
}
// A collection finds strings dead. They are freed when their blocks are swept, which new strings bring about.
let fillers = 0;
function collect() {
  Bun.gc(true);
  let length = 0;
  for (let at = 0; at < 30000; at++) length += ("filler " + fillers++ + " " + at).length;
  return length;
}
function short(text${typed ? ": string" : ""}) {
  return text.length > 600 ? text.slice(0, 400) + " .. " + text.slice(-180) + " (" + text.length + ")" : text;
}
${scenes.join("\n")}
${typed ? "export {};\n" : ""}`;
}
