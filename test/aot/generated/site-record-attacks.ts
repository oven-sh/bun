// Random programs about one question: a site in code that runs rarely expects a layout, a slot, a method or a callee, and what arrives is something else, or was right and has changed since.
//
// A program declares a few types, many ways to make objects that have (some of) their fields, and many small functions that each hold one operation on one field of one type: the sites.
// Several sites work on the same field of the same type, so they share what the compiler expects there and what the run learns.
// Then follows a straight line of steps, no loop around them: a site gets an object, an object or a prototype is changed, objects are dropped and a collection runs, an object is listed.
// Every step prints what came back, or the class of what was thrown, and the effects (getters, setters, traps) in their order. Plain Bun prints the reference.
//
//   bun test/aot/generated/site-record-attacks.ts <seed>                            prints the TypeScript program of that seed
//   bun test/aot/generated/site-record-attacks.ts <seed> --js                       the same program without types, as a JavaScript module
//   bun test/aot/generated/site-record-attacks.ts <seed> --count=100 --into=<dir>   writes seed-<n>.ts for the seeds from <seed> on; with --js, seed-<n>.js
//   bun test/aot/generated/site-record-attacks.ts <seed> --steps=300                a longer program (default 140)
//
// The programs touch no built-in prototype, print no function text and no error message, and use no clock and no random number.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const tsconfig =
  JSON.stringify({ compilerOptions: { target: "esnext", module: "preserve", moduleResolution: "bundler", strict: true, allowJs: true, noEmit: true, typeRoots: [join(import.meta.dir, "..", "..", "..", "packages")], types: ["bun-types"] } }) + "\n";

/** The same seed gives the same program on every machine and every version of Bun. */
class Random {
  #state: number;

  constructor(seed: number) {
    this.#state = (Math.floor(seed / 4294967296) * 0x85ebca6b) ^ (seed >>> 0);
    for (let i = 0; i < 4; i++) this.next();
  }

  next(): number {
    this.#state = (this.#state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.#state ^ (this.#state >>> 15), 1 | this.#state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  }

  below(limit: number): number {
    return this.next() % limit;
  }

  between(low: number, high: number): number {
    return low + this.below(high - low + 1);
  }

  chance(probability: number): boolean {
    return this.next() < probability * 4294967296;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.below(items.length)];
  }

  weighted<T>(items: readonly (readonly [number, T])[]): T {
    let left = this.below(items.reduce((sum, [weight]) => sum + weight, 0));
    for (const [weight, item] of items) if ((left -= weight) < 0) return item;
    return items[items.length - 1][1];
  }

  shuffled<T>(items: readonly T[]): T[] {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.below(i + 1);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  sample<T>(items: readonly T[], count: number): T[] {
    return this.shuffled(items).slice(0, count);
  }
}

interface Field {
  /** As it stands in a literal or a class body. */
  inLiteral: string;
  /** Behind an object: `.a`, `[0]`, `[mark]`. */
  access: string;
  /** The key as an expression. */
  key: string;
  /** The key in JSON text; none for a symbol. */
  inJSON?: string;
  /** Arrays and functions compute it or refuse stores to it. */
  isSpecial?: boolean;
}

const named = (name: string, isSpecial = false): Field => ({ inLiteral: name, access: "." + name, key: JSON.stringify(name), inJSON: name, isSpecial });
const fieldPool: Field[] = [
  named("a"),
  named("b"),
  named("c"),
  named("d"),
  named("value"),
  named("size"),
  named("name", true),
  named("length", true),
  { inLiteral: "0", access: "[0]", key: '"0"', inJSON: "0", isSpecial: true },
  { inLiteral: '"1.5"', access: '["1.5"]', key: '"1.5"', inJSON: "1.5" },
  { inLiteral: '"-1"', access: '["-1"]', key: '"-1"', inJSON: "-1" },
  { inLiteral: "[mark]", access: "[mark]", key: "mark" },
];

interface Kind {
  type: string;
  values: string[];
  /** The same values as JSON text, where there is one. */
  json?: string[];
  update?: string;
}

const kinds: Kind[] = [
  { type: "number", values: ["1", "7", "-3", "1000000"], json: ["1", "7", "-3", "1000000"], update: "+= 1" },
  { type: "number", values: ["0.5", "-2.25", "1e21"], json: ["0.5", "-2.25", "1e21"], update: "*= 2" },
  { type: "string", values: ['"s"', '""', '"a longer text"'], json: ['"s"', '""', '"a longer text"'], update: '+= "+"' },
  { type: "boolean", values: ["true", "false"], json: ["true", "false"] },
  { type: "{ v: number }", values: ["{ v: 1 }", "{ v: 2.5 }"], json: ['{"v":1}', '{"v":2.5}'] },
  { type: "number[]", values: ["[1, 2]", "[]", "[0.5]"], json: ["[1,2]", "[]", "[0.5]"] },
  { type: "string | null", values: ["null", '"or a text"'], json: ["null", '"or a text"'] },
  { type: "number | undefined", values: ["undefined", "4"] },
];

const anyValues = ["0", "-0", "1", "41", "1.5", "2 ** 31", "-(2 ** 31) - 1", "2 ** 53", "NaN", "-Infinity", '""', '"text"', '"7"', "true", "false", "null", "undefined", "7n", 'Symbol.for("y")', "[]", "[1, , 3]", "{}", "{ v: 9 }", "callable"];
const primitives = ["null", "undefined", "0", "5", "0.5", "NaN", "true", '""', '"text"', '"joined ".repeat(3)', "7n", 'Symbol.for("p")'];
const methodNames = ["m0", "m1"];

interface Member {
  field: Field;
  kind: Kind;
  isOptional: boolean;
}

interface Shape {
  name: string;
  isClass: boolean;
  members: Member[];
  methods: string[];
}

interface Site {
  name: string;
  /** How many values it takes behind the object. */
  values: number;
  /** What it takes first: an object, something to call, something to construct, or nothing. */
  takes: "object" | "callee" | "maker" | "values";
  /** For a read: the field, so that a run of new structures can be checked against it. */
  reads?: Field;
}

export function siteRecordAttack(seed: number, isTyped = true, stepCount = 140): { file: string; text: string; files: Record<string, string> } {
  const random = new Random(seed);
  const lines: string[] = [];
  const emit = (text: string) => lines.push(text);
  /** A type annotation, or nothing in JavaScript. */
  const ty = (text: string) => (isTyped ? text : "");
  const loose = (expression: string) => (isTyped ? `(${expression} as any)` : expression);

  emit(`// Seed ${seed}${isTyped ? "" : ", without types"}: what the sites of code that runs rarely expect is wrong or out of date.`);
  emit(`const mark = Symbol("mark");`);
  emit(`const trail${ty(": string[]")} = [];`);
  emit(`const names = new Map${ty("<unknown, string>")}([[Object.prototype, "Object.prototype"], [Array.prototype, "Array.prototype"], [Function.prototype, "Function.prototype"], [null, "null"]]);`);
  emit(`const hidden = (value${ty(": any")})${ty(": any")} => new CustomEvent("hidden", { detail: value }).detail; // what native code hands back is unknown to the compiler`);
  emit(`const callable = Object.assign(() => "called", { toString: () => "callable" }); // the text of a function is never printed`);
  emit(`function note(text${ty(": string")})${ty(": void")} {
  trail.push(text);
}
function show(value${ty(": any")}, depth = 0)${ty(": string")} {
  switch (typeof value) {
    case "number":
      return Object.is(value, -0) ? "-0" : String(value);
    case "string":
      return JSON.stringify(value);
    case "bigint":
      return value + "n";
    case "function":
      return "function";
    case "object":
      break;
    default:
      return String(value);
  }
  if (value === null) return "null";
  if (depth > 2) return "..";
  const parts${ty(": string[]")} = [];
  const keys = Reflect.ownKeys(value);
  for (const key of keys.slice(0, 24)) {
    const property = Reflect.getOwnPropertyDescriptor(value, key)${ty("!")};
    const flags = (property.enumerable ? "" : "!e") + (property.configurable ? "" : "!c") + ("value" in property && !property.writable ? "!w" : "");
    parts.push(String(key) + flags + ":" + ("value" in property ? show(property.value, depth + 1) : (property.get ? "get" : "") + (property.set ? "set" : "")));
  }
  if (keys.length > 24) parts.push("and " + (keys.length - 24) + " more");
  return (Array.isArray(value) ? "array" : "") + "{" + parts.join(",") + "}";
}
function list(value${ty(": any")})${ty(": string")} {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return show(value);
  const prototype = Reflect.getPrototypeOf(value);
  return show(value) + " below " + (names.get(prototype) ?? "another") + (Reflect.isExtensible(value) ? "" : ", closed");
}
function step(label${ty(": string")}, run${ty(": () => unknown")})${ty(": void")} {
  let result${ty(": string")};
  try {
    result = show(run());
  } catch (error) {
    result = "throws " + ${loose("error")}?.constructor?.name;
  }
  console.log(label + " => " + result + (trail.length ? " | " + trail.splice(0).join(";") : ""));
}
function watched(target${ty(": object")}, name${ty(": string")})${ty(": any")} {
  return new Proxy(target, {
    get(inner, key, receiver) {
      note(name + ".get " + String(key));
      return Reflect.get(inner, key, receiver);
    },
    set(inner, key, value, receiver) {
      note(name + ".set " + String(key));
      return Reflect.set(inner, key, value, receiver);
    },
    has(inner, key) {
      note(name + ".has " + String(key));
      return Reflect.has(inner, key);
    },
    deleteProperty(inner, key) {
      note(name + ".delete " + String(key));
      return Reflect.deleteProperty(inner, key);
    },
  });
}
function fillStack(depth${ty(": number")})${ty(": number")} {
  const some = [depth, depth + 1, depth + 2, depth + 3];
  return depth ? fillStack(depth - 1) + some.length : 0;
}
function newStructures(tag${ty(": string")}, key${ty(": PropertyKey")}, read${ty(": (value: any) => unknown")})${ty(": string")} {
  const kept = [];
  let wrong = 0;
  for (let i = 0; i < 300; i++) {
    const value${ty(": any")} = {};
    value[tag + i] = "not it";
    if (i % 3 === 0) value.pad = "not it either";
    if (i % 5 !== 4) value[key] = i;
    if (i % 3 === 1) value.behind = "nor this";
    kept.push(value);
    if (read(hidden(value)) !== (i % 5 !== 4 ? i : undefined)) wrong++;
  }
  return kept.length + " new structures, " + wrong + " wrong";
}`);

  // The declared types.
  const shapes: Shape[] = [];
  const shapeCount = random.between(2, 3);
  for (let index = 0; index < shapeCount; index++) {
    const isClass = random.chance(0.6);
    const members = random.sample(fieldPool, random.between(2, 6)).map(field => ({ field, kind: random.pick(kinds), isOptional: random.chance(0.2) }));
    shapes.push({ name: "T" + index, isClass, members, methods: random.sample(methodNames, random.between(1, 2)).sort() });
  }
  const valueOf = (kind: Kind) => random.pick(kind.values);
  const methodBody = (owner: string, method: string, shape: Shape) => {
    const member = random.pick(shape.members);
    return `return "${owner}.${method} " + show(${isTyped ? "(this as any)" : "this"}${member.field.access}) + " " + show(x);`;
  };

  const makers: string[] = [];
  let pads = 0;
  const classNames: string[] = [];
  const honestMakers: string[][] = shapes.map(() => []);
  const addMaker = (body: string, returns = "any") => {
    const name = "make" + makers.length;
    emit(`function ${name}()${ty(": " + returns)} {\n${body}\n}`);
    makers.push(name);
    return name;
  };

  for (const [index, shape] of shapes.entries()) {
    if (shape.isClass) {
      emit(`class ${shape.name} {`);
      for (const { field, kind, isOptional } of shape.members) {
        if (isOptional) {
          if (isTyped) emit(`  declare ${field.inLiteral}?: ${kind.type};`);
        } else emit(`  ${field.inLiteral}${ty(": " + kind.type)} = ${valueOf(kind)};`);
      }
      for (const method of shape.methods) emit(`  ${method}(x${ty(": unknown")})${ty(": string")} {\n    ${methodBody(shape.name, method, shape)}\n  }`);
      emit(`}`);
      emit(`names.set(${shape.name}.prototype, "${shape.name}.prototype");`);
      classNames.push(shape.name);
      honestMakers[index].push(addMaker(`  return new ${shape.name}();`, shape.name));
    } else {
      if (isTyped) {
        emit(`interface ${shape.name} {`);
        for (const { field, kind, isOptional } of shape.members) emit(`  ${field.inLiteral}${isOptional ? "?" : ""}: ${kind.type};`);
        for (const method of shape.methods) emit(`  ${method}(x: unknown): string;`);
        emit(`}`);
      }
      for (let variant = 0; variant < 2; variant++) {
        const parts = shape.members.filter(member => !member.isOptional || random.chance(0.5)).map(({ field, kind }) => `    ${field.inLiteral}: ${valueOf(kind)},`);
        for (const method of shape.methods) parts.push(`    ${method}(x${ty(": unknown")})${ty(": string")} {\n      ${methodBody(shape.name, method, shape)}\n    },`);
        honestMakers[index].push(addMaker(`  return {\n${parts.join("\n")}\n  };`, shape.name));
      }
    }
  }

  // Objects to hang others below. Nothing ever changes what they hang below themselves, so no chain can close to a ring through a Proxy.
  const prototypes: string[] = [];
  for (let index = 0; index < 3; index++) {
    const shape = random.pick(shapes);
    const parts = random.sample(shape.members, random.between(0, shape.members.length)).map(({ field }) => `  ${field.inLiteral}: ${random.pick(anyValues)},`);
    for (const method of shape.methods) if (random.chance(0.6)) parts.push(`  ${method}(x${ty(": unknown")}) {\n    return "P${index}.${method} " + show(x);\n  },`);
    emit(`const P${index}${ty(": any")} = {\n${parts.join("\n")}\n};`);
    emit(`names.set(P${index}, "P${index}");`);
    prototypes.push("P" + index);
  }
  emit(`const watchedPrototype = watched(${random.pick(prototypes)}, "above");`);
  emit(`names.set(watchedPrototype, "a proxy");`);

  // The impostors.
  for (const shape of shapes) {
    const mixedValue = (member: Member) => (random.chance(0.7) ? valueOf(member.kind) : random.pick(anyValues));
    const someMembers = () => random.shuffled(shape.members).filter(() => random.chance(0.85));
    const closures = (owner: string) => shape.methods.filter(() => random.chance(0.8)).map(method => `${method}: (x${ty(": unknown")}) => "${owner}.${method} " + show(x)`);

    if (shape.isClass) {
      const name = shape.name + "Heir";
      emit(`class ${name} extends ${shape.name} {`);
      emit(`  more = ${random.pick(anyValues)};`);
      const again = random.pick(shape.members);
      if (!again.isOptional && random.chance(0.5)) emit(`  ${again.field.inLiteral}${ty(": " + again.kind.type)} = ${valueOf(again.kind)};`);
      if (random.chance(0.6)) {
        const method = random.pick(shape.methods);
        emit(`  ${method}(x${ty(": unknown")})${ty(": string")} {\n    return "${name}.${method} > " + super.${method}(x);\n  }`);
      }
      emit(`}`);
      emit(`names.set(${name}.prototype, "${name}.prototype");`);
      classNames.push(name);
      addMaker(`  return new ${name}();`);
    }

    {
      const name = shape.name + "Mirror";
      emit(`class ${name} {`);
      for (const member of someMembers()) {
        if (random.chance(0.4)) emit(`  pad${pads++} = ${random.pick(anyValues)};`);
        emit(`  ${member.field.inLiteral}${ty(": any")} = ${mixedValue(member)};`);
      }
      for (const method of shape.methods) if (random.chance(0.8)) emit(`  ${method}(x${ty(": unknown")})${ty(": string")} {\n    return "${name}.${method} " + show(x);\n  }`);
      emit(`}`);
      emit(`names.set(${name}.prototype, "${name}.prototype");`);
      classNames.push(name);
      addMaker(`  return new ${name}();`);
    }

    {
      const parts = someMembers()
        .filter(member => member.field.inJSON !== undefined && member.kind.json)
        .map(member => `${JSON.stringify(member.field.inJSON)}:${random.pick(member.kind.json!)}`);
      if (random.chance(0.5)) parts.splice(random.below(parts.length + 1), 0, `"pad":0`);
      addMaker(`  return Object.assign(JSON.parse(${JSON.stringify("{" + parts.join(",") + "}")}), { ${closures("parsed").join(", ")} });`);
    }

    addMaker(`  const value${ty(": any")} = Object.create(${random.pick([...prototypes, "null", "watchedPrototype"])});\n${someMembers()
      .filter(() => random.chance(0.6))
      .map(member => `  value${member.field.access} = ${mixedValue(member)};`)
      .join("\n")}\n  return value;`);

    addMaker(
      `  return Object.assign(${random.pick(["[1, 2]", "function () {}", "new Map()", "[0.5, , 2.5]"])}, { ${[
        ...someMembers()
          // A Map has a getter `size` and no setter: the store would throw where the object is made.
          .filter(member => !member.field.isSpecial && member.field.inLiteral !== "size")
          .map(member => `${member.field.inLiteral}: ${mixedValue(member)}`),
        ...closures("host"),
        `toString: () => "host"`,
      ].join(", ")} });`,
    );

    {
      const member = random.pick(shape.members);
      addMaker(
        `  return Object.defineProperty(${random.pick(honestMakers[shapes.indexOf(shape)])}(), ${member.field.key}, {\n    get() {\n      note("get ${shape.name} accessor");\n      return ${mixedValue(member)};\n    },\n    set(value${ty(": unknown")}) {\n      note("set ${shape.name} accessor " + show(value));\n    },\n    configurable: true,\n    enumerable: true,\n  });`,
      );
    }

    addMaker(`  return ${random.pick(["Object.freeze", "Object.seal", "Object.preventExtensions"])}(${random.pick(makers)}());`);
    addMaker(`  return ${random.chance(0.5) ? `watched(${random.pick(makers)}(), "proxy")` : `new Proxy(${random.pick(makers)}(), {})`};`);
  }

  // Callees for the calls by value and the constructions.
  const callees = [`(x${ty(": unknown")}) => "arrow " + show(x)`, `function (${ty("this: unknown, ")}x${ty(": unknown")}) {\n  return "function " + show(this) + " " + show(x) + " " + arguments.length;\n}`, `(...all${ty(": unknown[]")}) => "rest " + all.length`, `(x = "default", y = "second default") => "defaults " + show(x) + show(y)`, `Math.max`, `async () => 1`];
  emit(`const callees${ty(": any[]")} = [\n${callees.map(callee => "  " + callee + ",").join("\n")}\n  ${classNames[0] ?? "Map"},\n  ${prototypes[0]},\n  5,\n  undefined,\n];`);
  emit(`callees.push(callees[1].bind("bound", "first"), new Proxy(callees[0], {}), new Proxy(callees[0], { apply: () => "trapped" }));`);
  const calleeCount = callees.length + 4 + 3;
  emit(`const constructors${ty(": any[]")} = [${[...classNames, "Object", "Array", "function () {}", `function (${ty("this: any")}) {\n  this.made = true;\n}`, "() => 0", "Math.max", "null", "{}"].join(", ")}];`);
  emit(`constructors.push(constructors[0].bind(null), new Proxy(constructors[0], {}), new Proxy(constructors[0], { construct: () => ({ trapped: true }) }));`);
  const constructorCount = classNames.length + 8 + 3;

  // The sites.
  const sites: Site[] = [];
  const addSite = (site: Omit<Site, "name">, parameters: string, returns: string, body: string) => {
    const name = "s" + sites.length;
    emit(`function ${name}(${parameters})${ty(": " + returns)} {\n  ${body}\n}`);
    sites.push({ name, ...site });
  };
  for (const shape of shapes) {
    const object = `o${ty(": " + shape.name)}`;
    for (const member of shape.members) {
      const { field, kind } = member;
      const target = "o" + field.access;
      for (let copy = random.between(1, 2); copy > 0; copy--) addSite({ takes: "object", values: 0, reads: field }, object, "unknown", `return ${target};`);
      for (let copy = random.between(1, 2); copy > 0; copy--) addSite({ takes: "object", values: 1 }, `${object}, v${ty(": any")}`, "void", `${target} = v;`);
      if (random.chance(0.4)) addSite({ takes: "object", values: 0 }, `o${ty(": " + shape.name + " | null | undefined")}`, "unknown", `return o?.${field.access.startsWith(".") ? field.access.slice(1) : field.access};`);
      if (random.chance(0.4)) addSite({ takes: "object", values: 0 }, object, "boolean", `return ${field.key} in o;`);
      if (random.chance(0.3)) addSite({ takes: "object", values: 0 }, object, "boolean", `return delete ${loose("o")}${field.access};`);
      if (kind.update && !member.isOptional && random.chance(0.6)) addSite({ takes: "object", values: 0 }, object, "unknown", `return (${target} ${kind.update});`);
      if (random.chance(0.3)) addSite({ takes: "object", values: 1 }, `${object}, v${ty(": any")}`, "unknown", `return (${target} ??= v);`);
      if (random.chance(0.3)) addSite({ takes: "object", values: 0 }, object, "string", `return typeof ${target};`);
    }
    for (const method of shape.methods) {
      for (let copy = random.between(1, 2); copy > 0; copy--) addSite({ takes: "object", values: 1 }, `${object}, v${ty(": any")}`, "unknown", `return o.${method}(v);`);
      if (random.chance(0.5)) addSite({ takes: "object", values: 1 }, `${object}, v${ty(": any")}`, "unknown", `return o.${method}((note("argument"), v));`);
      if (random.chance(0.3)) addSite({ takes: "object", values: 0 }, object, "unknown", `return ${loose("o")}.${method}?.(1, 2, 3);`);
    }
    const two = random.sample(shape.members, 2);
    addSite({ takes: "object", values: 0 }, object, "unknown", `const { ${two.map((member, index) => `${member.field.inLiteral}: p${index}${index ? ' = "default"' : ""}`).join(", ")} } = ${loose("o")};\n  return [${two.map((_member, index) => "p" + index).join(", ")}];`);
    addSite({ takes: "object", values: 0 }, object, "unknown", `return { ...o, extra: 1 };`);
    addSite({ takes: "object", values: 1 }, `${object}, v${ty(": any")}`, "unknown", `return { ${two[0].field.inLiteral}: v, ...${loose("o")} };`);
    const required = shape.members.filter(member => !member.isOptional || random.chance(0.5));
    if (!shape.isClass)
      addSite(
        { takes: "values", values: required.length },
        required.map((_member, index) => `v${index}${ty(": any")}`).join(", "),
        shape.name,
        `return { ${[...required.map((member, index) => `${member.field.inLiteral}: v${index}`), ...shape.methods.map(method => `${method}: () => "made by a site"`)].join(", ")} };`,
      );
    else addSite({ takes: "maker", values: 0 }, `K${ty(": new () => " + shape.name)}`, "unknown", `return new K();`);
  }
  for (let copy = 0; copy < 3; copy++) addSite({ takes: "callee", values: 1 }, `f${ty(": (x: unknown) => unknown")}, v${ty(": any")}`, "unknown", `return f(v);`);
  addSite({ takes: "callee", values: 0 }, `f${ty(": () => unknown")}`, "unknown", `return f();`);
  addSite({ takes: "maker", values: 1 }, `K${ty(": new (x: unknown) => unknown")}, v${ty(": any")}`, "unknown", `return new K(v);`);

  // The objects.
  const slots = 7;
  for (let slot = 0; slot < slots; slot++) emit(`let o${slot}${ty(": any")} = ${random.pick(makers)}();`);
  const anySlot = () => "o" + random.below(slots);
  const anyField = () => random.pick(random.pick(shapes).members).field;
  const anyValue = () => (random.chance(0.1) ? anySlot() : random.pick(anyValues));
  const anyPrototype = () => random.pick([...prototypes, ...prototypes, ...classNames.map(name => name + ".prototype"), "null", "watchedPrototype", "Object.prototype"]);
  const accessor = (label: string) => `{\n    get() {\n      note("get ${label}");\n      return ${random.pick(anyValues)};\n    },\n    ${random.chance(0.7) ? `set(value${ty(": unknown")}) {\n      note("set ${label} " + show(value));\n    },\n    ` : ""}configurable: true,\n    enumerable: ${random.chance(0.7)},\n  }`;

  let number = 0;
  const addStep = (what: string, body: string) => emit(`step("${++number} ${what}", () => ${body});`);
  const block = (statements: string) => `{\n  ${statements}\n}`;

  const useSite = () => {
    const site = random.pick(sites);
    const values = Array.from({ length: site.values }, anyValue);
    let first: string[];
    if (site.takes === "object") {
      const object = random.weighted([
        [10, anySlot()],
        [2, loose(random.pick(makers) + "()")],
        [1, loose(random.pick(primitives))],
      ]);
      first = [random.chance(0.3) ? `hidden(${object})` : object];
    } else if (site.takes === "callee") first = [`callees[${random.below(calleeCount)}]`];
    else if (site.takes === "maker") first = [`constructors[${random.below(constructorCount)}]`];
    else first = [];
    const call = `${site.name}(${[...first, ...values].join(", ")})`;
    addStep(call.replaceAll('"', "'").replaceAll("\n", " "), random.chance(0.15) ? `[${call}, ${call}]` : call);
  };
  const changeObject = () => {
    const object = anySlot();
    const field = anyField();
    const method = random.pick(methodNames);
    const [what, body] = random.weighted<[string, string]>([
      [4, ["delete", `delete ${object}${field.access}`]],
      [4, ["store", block(`${object}${field.access} = ${anyValue()};`)]],
      [3, ["add", block(`${object}.added${random.below(4)} = ${anyValue()};`)]],
      [3, ["accessor", block(`Object.defineProperty(${object}, ${field.key}, ${accessor("own")});`)]],
      [2, ["read-only", block(`Object.defineProperty(${object}, ${field.key}, { value: ${random.pick(anyValues)}, writable: false, configurable: true, enumerable: true });`)]],
      [1, ["hide", block(`Object.defineProperty(${object}, ${field.key}, { enumerable: false });`)]],
      [1, ["plain again", block(`Object.defineProperty(${object}, ${field.key}, { value: ${random.pick(anyValues)}, writable: true, configurable: true, enumerable: true });`)]],
      [1, ["freeze", block(`Object.freeze(${object});`)]],
      [1, ["seal", block(`Object.seal(${object});`)]],
      [1, ["close", block(`Object.preventExtensions(${object});`)]],
      [4, ["hang", block(`Object.setPrototypeOf(${object}, ${anyPrototype()});`)]],
      [3, ["own method", block(`${object}.${method} = (x${ty(": unknown")}) => "own ${method} " + show(x);`)]],
      [1, ["method is no function", block(`${object}.${method} = ${random.pick(["5", "null", "{}", '"text"'])};`)]],
      [2, ["delete method", `delete ${object}.${method}`]],
      [1, ["delete and add again", block(`const held = ${object}${field.access};\n  delete ${object}${field.access};\n  ${object}.between${random.below(3)} = 0;\n  ${object}${field.access} = held;`)]],
      [1, ["grow", block(`for (let i = 0; i < 70; i++) ${object}["grown" + i] = i;`)]],
      [1, ["grow and shrink", block(`for (let i = 0; i < 70; i++) ${object}["grown" + i] = i;\n  for (let i = 0; i < 70; i++) delete ${object}["grown" + i];`)]],
    ]);
    addStep(`${what} ${object}`, body);
  };
  const changePrototype = () => {
    const target = random.pick([...prototypes, ...classNames.map(name => loose(name + ".prototype"))]);
    const field = anyField();
    const method = random.pick(methodNames);
    const [what, body] = random.weighted<[string, string]>([
      [3, ["store above", block(`${target}${field.access} = ${random.pick(anyValues)};`)]],
      [3, ["delete above", `delete ${target}${field.access}`]],
      [3, ["accessor above", block(`Object.defineProperty(${target}, ${field.key}, ${accessor("above")});`)]],
      [1, ["read-only above", block(`Object.defineProperty(${target}, ${field.key}, { value: ${random.pick(anyValues)}, writable: false, configurable: true });`)]],
      [4, ["replace method", block(`${target}.${method} = function (${ty("this: any, ")}x${ty(": unknown")}) {\n    return "replaced ${method} ${number} " + show(x);\n  };`)]],
      [2, ["delete method above", `delete ${target}.${method}`]],
      [1, ["method getter", block(`Object.defineProperty(${target}, "${method}", {\n    get() {\n      note("get ${method}");\n      return () => "from a getter";\n    },\n    configurable: true,\n  });`)]],
    ]);
    addStep(what, body);
    if (classNames.length > 1 && random.chance(0.15)) {
      const [below, above] = random.sample(classNames, 2);
      addStep("hang a class elsewhere", block(`Object.setPrototypeOf(${below}.prototype, ${random.chance(0.7) ? above + ".prototype" : random.pick(prototypes)});`));
    }
  };
  const collect = () => {
    const dropped = random.sample(
      Array.from({ length: slots }, (_each, slot) => "o" + slot),
      random.between(1, 4),
    );
    addStep("drop and collect", block(`${dropped.map(object => `${object} = null;`).join("\n  ")}\n  fillStack(40);\n  Bun.gc(true);`));
    const reads = sites.filter(site => site.reads && !site.reads.isSpecial);
    if (reads.length && random.chance(0.7)) {
      const site = random.pick(reads);
      addStep("new structures at " + site.name, `newStructures("n${number}x", ${site.reads!.key}, ${site.name})`);
    }
    for (const object of dropped) addStep("make " + object, block(`${object} = ${random.pick(makers)}();`));
  };

  for (let slot = 0; slot < slots; slot++) addStep("list o" + slot, `list(o${slot})`);
  while (number < stepCount) {
    random.weighted([
      [50, useSite],
      [20, changeObject],
      [8, changePrototype],
      [4, collect],
      [8, () => addStep("make", block(`${anySlot()} = ${random.pick(makers)}();`))],
      [10, () => {
        const object = anySlot();
        addStep("list " + object, `list(${object})`);
      }],
    ])();
  }
  for (let slot = 0; slot < slots; slot++) addStep("list o" + slot, `list(o${slot})`);
  emit(`\nexport {};`);
  return { file: isTyped ? "main.ts" : "main.js", text: lines.join("\n") + "\n", files: { "tsconfig.json": tsconfig } };
}

if (import.meta.main) {
  const flags = new Map(
    process.argv
      .slice(2)
      .filter(argument => argument.startsWith("--"))
      .map(argument => {
        const [name, value = ""] = argument.slice(2).split("=");
        return [name, value] as const;
      }),
  );
  const seed = Number(process.argv.slice(2).find(argument => !argument.startsWith("--")));
  if (!Number.isSafeInteger(seed) || seed < 0) {
    console.error("usage: bun test/aot/generated/site-record-attacks.ts <seed> [--js] [--steps=140] [--count=<n> --into=<folder>]");
    process.exit(1);
  }
  const isTyped = !flags.has("js");
  const steps = Number(flags.get("steps")) || 140;
  const into = flags.get("into");
  if (into) {
    mkdirSync(into, { recursive: true });
    for (let each = seed; each < seed + (Number(flags.get("count")) || 1); each++) writeFileSync(join(into, `seed-${each}${isTyped ? ".ts" : ".js"}`), siteRecordAttack(each, isTyped, steps).text);
  } else process.stdout.write(siteRecordAttack(seed, isTyped, steps).text);
}
