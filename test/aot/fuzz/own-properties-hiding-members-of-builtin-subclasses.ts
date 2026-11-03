// A class extends a built-in class and its objects are born with properties: fields of the class, or names the built-in
// constructor puts on them. A call of a method or a read of a getter goes to the class only while no own property of the
// object hides the member. Each scene calls the members often, then hides one on one object in one of many ways (or
// changes the prototype chain), asks again, takes the change back and asks once more. Other objects must not notice.
import type { Random } from "./random";

const bases: Record<string, { type?: string; args: string }> = {
  Map: { type: "Map<string, number>", args: "" },
  Set: { type: "Set<number>", args: "" },
  WeakMap: { type: "WeakMap<object, number>", args: "" },
  WeakSet: { type: "WeakSet<object>", args: "" },
  Array: { type: "Array<number>", args: "" },
  Error: { args: '"e"' },
  TypeError: { args: '"e"' },
  RangeError: { args: '"e"' },
  Date: { args: "0" },
  RegExp: { args: '"a"' },
  Promise: { type: "Promise<number>", args: "() => {}" },
  Uint8Array: { args: "2" },
};

/** Members that make the objects be born with properties. */
const fields = ["field = 1;", 'field = 1;\n  second = "s";', "", "field = [1];", "#hidden = 1;\n  field = 2;"];

/** Statements that change `raw`, one object of class NAME seen without its type, and the statement that undoes each. */
const changes: [change: string, undo: string][] = [
  ['raw.m = () => "own m";', "delete raw.m;"],
  ['raw["m"] = () => "own m";', "delete raw.m;"],
  ['raw[key("m")] = () => "own m";', 'delete raw[key("m")];'],
  ['Object.defineProperty(raw, "m", { value: () => "own m", configurable: true });', "delete raw.m;"],
  ['Object.defineProperty(raw, "g", { get: () => "own g", configurable: true });', "delete raw.g;"],
  ['Object.defineProperty(raw, "g", { value: "own g", configurable: true });', "delete raw.g;"],
  // A descriptor without a value, a getter or a setter still makes an own property, which holds undefined.
  ['Object.defineProperty(raw, "g", { enumerable: false, configurable: true });', "delete raw.g;"],
  ['Object.defineProperty(raw, "m", { configurable: true });', "delete raw.m;"],
  ['Object.assign(raw, { m: () => "own m" });', "delete raw.m;"],
  ['Reflect.set(raw, "m", () => "own m");', 'Reflect.deleteProperty(raw, "m");'],
  [
    'Reflect.defineProperty(raw, "m", { value: () => "own m", configurable: true, enumerable: true });',
    "delete raw.m;",
  ],
  ['raw.m = () => "own m";\nraw.extra = 1;', "delete raw.extra;"],
  ["raw.extra = 1;", "delete raw.extra;"],
  ["raw.m = undefined;", "delete raw.m;"],
  ['raw.g = "assigned";', ""],
  ["delete raw.field;", "raw.field = 1;"],
  ['PROTO.m = function () {\n  return "replaced m";\n};', 'PROTO.m = function () {\n  return "put back m";\n};'],
  ['Object.defineProperty(PROTO, "g", { get: () => "replaced g", configurable: true });', "delete PROTO.g;"],
  ["delete PROTO.m;", 'PROTO.m = function () {\n  return "put back m";\n};'],
  ['Object.setPrototypeOf(raw, { __proto__: PROTO, m: () => "between m" });', "Object.setPrototypeOf(raw, PROTO);"],
  ["Object.setPrototypeOf(raw, Object.getPrototypeOf(PROTO));", "Object.setPrototypeOf(raw, PROTO);"],
  ['Object.setPrototypeOf(PROTO, { __proto__: Object.getPrototypeOf(PROTO), inherited: () => "new parent" });', ""],
];

/** What runs between the calls that come first and the change. */
const between = [
  "",
  "",
  "Bun.gc(true);",
  'for (let k = 0; k < 70; k++) {\n  const other ANY = new NAME();\n  other["x" + k] = k;\n  ask(other);\n}',
  'for (let k = 0; k < 70; k++) {\n  const other ANY = new NAME();\n  other["x" + k] = k;\n  ask(other);\n}\nBun.gc(true);',
];

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(1, 3); scene < total; scene++) {
    const name = `C${scene}`;
    const baseName = random.pick(Object.keys(bases));
    const base = bases[baseName];
    const [change, undo] = random.pick(changes);
    const filled = (text: string) =>
      text
        .replaceAll("NAME", name)
        .replaceAll("PROTO", `proto${scene}`)
        .replaceAll(" ANY", as("any"))
        .replaceAll("ask(", `ask${scene}(`)
        .replaceAll("\n", "\n  ");
    const warm = random.pick([0, 1, 3, 300, 5000]);
    const isSameObject = random.chance(0.5);
    scenes.push(`class ${name} extends ${(typed && base.type) || baseName} {
  ${random.pick(fields)}
  constructor() {
    super(${base.args});
  }
  m()${as("string")} {
    return "class m";
  }
  get g()${as("string")} {
    return "class g";
  }
  viaThis()${as("string")} {
    return this.m() + "+" + this.g;
  }
}
const proto${scene}${as("any")} = ${name}.prototype;
function ask${scene}(it${as(name)})${as("string")} {
  return it.m() + "," + it.g + "," + it.viaThis() + "," + ("m" in it) + "," + Object.hasOwn(it, "m");
}
{
  const usual = new ${name}();
  const raw${as("any")} = ${isSameObject ? "usual" : `new ${name}()`};
  ${warm ? `for (let i = 0; i < ${warm}; i++) {\n    ask${scene}(usual);\n    ask${scene}(raw);\n  }` : ""}
  console.log("scene ${scene} before", told(() => ask${scene}(raw)));
  ${filled(random.pick(between))}
  console.log("scene ${scene} change", told(() => {
  ${filled(change)}
  }));
  console.log("scene ${scene} changed", told(() => ask${scene}(raw)), "|", told(() => ask${scene}(usual)), "|", told(() => ask${scene}(new ${name}())));
  console.log("scene ${scene} undo", told(() => {
  ${filled(undo)}
  }));
  console.log("scene ${scene} undone", told(() => ask${scene}(raw)), "|", told(() => ask${scene}(usual)), "|", Object.keys(raw).join());
}`);
  }
  return `const key = (name${as("string")})${as("string")} => process.argv[9] ?? name;
function told(ask${as("() => unknown")})${as("unknown")} {
  try {
    return ask();
  } catch (error) {
    return "threw " + ${typed ? "(error as Error)" : "error"}.name;
  }
}
${scenes.join("\n")}
`;
}
