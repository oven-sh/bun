// Small programs of three to six files about one object. The file that makes it keeps it and hands it to another file under a written type that does not hold it: a number, a text, `never`, another class. At the
// far end it is taken for what it is again and changed in one way. Then the file that made it reads it under the name it has there. TypeScript accepts every program, and a type changes nothing about what a
// program prints: the executable prints what plain Bun prints. There is one object, one road, one change and one read in a program. In this order are drawn:
//
//   the object    a literal, an instance of a class, a list, a map, a set, a function, a regular expression, a date, bytes, an object inside an object
//   the type      number, string, boolean, bigint, symbol, null, undefined, void, never, a literal type, another class, another object type, a list, a tuple, a function, a promise; unknown, object, `{}`, `any`
//                 and the right type, for comparison
//   the road      what a function returns; a constant; an argument; a field of a carrier, an element of a list and a value of a map that are declared in one more file; a generic function; a callback that
//                 the far end has registered; an awaited promise; files between that export again
//   who says it   TypeScript with `as any`, `as unknown as T`, `// @ts-ignore`, a generic cast; JavaScript with a declaration file or JSDoc
//   the far end   TypeScript that casts in place, through a variable of type `any`, in a file that is not checked, or hands it to JavaScript; JavaScript
//   the change    a store of the same or another kind, a new member, `delete`, `defineProperty`, `Object.assign`, `Reflect.set`, `freeze`, another prototype; `push`, `length`, an element, `sort`; `set`, `clear`;
//                 `lastIndex`, `setTime`
//   the read      a member by name, its kind, the keys, JSON, `in`, the length, an element; behind the change, ahead of it and behind it, in one expression with it, or in a loop of ten thousand turns
import type { Random } from "./random";

/** In a change `§` is the object at the far end. In a read `held` is its name where it was made. */
type Thing = { makes: string; type: string; declares?: string; changes: string[]; reads: string[]; handed?: string };

const ofObjects = {
  changes: [
    "§.a = 2;",
    `§.a = "two";`,
    "§.a = 2.5;",
    "§.a = undefined;",
    "§.a = { deep: 1 };",
    "§.a++;",
    "§.a += 1;",
    "§.c = 3;",
    `§.c = "three";`,
    `§["a"] = 7;`,
    `§["c"] = 7;`,
    "delete §.a;",
    "delete §.b;",
    `Object.defineProperty(§, "a", { get() { return 9; }, configurable: true });`,
    `Object.defineProperty(§, "a", { value: 9 });`,
    `Object.defineProperty(§, "c", { value: 1, enumerable: false });`,
    `Object.defineProperty(§, "c", { value: 1, enumerable: true, writable: true, configurable: true });`,
    "Object.assign(§, { a: 5 });",
    "Object.assign(§, { c: 6 });",
    `Object.assign(§, { a: "five", c: 6 });`,
    `Reflect.set(§, "a", 8);`,
    `Reflect.set(§, "c", 8);`,
    `Reflect.deleteProperty(§, "a");`,
    `Reflect.defineProperty(§, "c", { value: 2, enumerable: true });`,
    "Object.freeze(§);",
    "Object.seal(§);",
    "Object.preventExtensions(§);",
    "Object.setPrototypeOf(§, { inherited: 1 });",
    "Object.setPrototypeOf(§, null);",
    "for (const key in §) §[key] = 0;",
    "for (const key of Object.keys(§)) delete §[key];",
    "[§.a, §.b] = [§.b, §.a];",
    "({ a: §.b, b: §.a } = { a: 10, b: 20 });",
    "§.b += §.a;",
    "§[Symbol.toPrimitive] = () => 42;",
    "§.toJSON = () => 42;",
    "new (class extends (function () { return §; }‹ as any›) { c = 3; })();",
    `new (class extends (function () { return §; }‹ as any›) { a = "field"; })();`,
    "new (class extends (function () { return §; }‹ as any›) { constructor() { super(); (this‹ as any›).c = 3; } })();",
    "(function (‹this: any›) { this.c = 3; }).call(§);",
    "(function (‹this: any›) { this.a = 4; }).apply(§);",
    "(function (‹this: any›) { delete this.a; }).bind(§)();",
    "Reflect.apply(function (‹this: any›) { this.a = 4; }, §, []);",
    "[1].forEach(function (‹this: any›) { this.c = 3; }, §);",
    "[§].forEach(each => { each.a = 4; });",
    "[§].map(each => (each.c = 3));",
    "Array.from([§], each => { each.a = 4; });",
    "new Map([[1, §]]).forEach(each => { each.c = 3; });",
    "new Set([§]).forEach(each => { each.a = 4; });",
    "for (const each of [§]) each.a = 4;",
    "for (const each of new Set([§])) each.c = 3;",
    "JSON.stringify({ toJSON() { §.a = 4; } });",
    '`${{ toString() { §.c = 3; return ""; } }}`;',
    "[2, 1].sort(() => ((§.a = 4), 0));",
    `"x".replace("x", () => ((§.c = 3), ""));`,
    "new Proxy(§, {}).a = 4;",
    "new Proxy(§, {}).c = 3;",
    "Object.create(§).a = 4;",
    "Object.defineProperties(§, { c: { value: 3, enumerable: true } });",
    "Object.entries({ a: 4, c: 3 }).forEach(([key, value]) => { §[key] = value; });",
    `Object.assign(§, JSON.parse('{"a":4,"c":3}'));`,
    "({ set put(value‹: any›) { value.a = 4; } }).put = §;",
    "const [one] = [§];\none.a = 4;",
    "const { inside } = { inside: § };\ninside.c = 3;",
    "const again = (() => §)();\nagain.a = 4;",
    "(function (...all‹: any[]›) { all[0].a = 4; })(§);",
    "(function () { arguments[0].c = 3; }‹ as any›)(§);",
    "(function* (‹one: any›) { one.a = 4; })(§).next();".replace("(‹one: any›)", "(one‹: any›)"),
  ],
  reads: [
    "held.a",
    "held.a + 1",
    "typeof held.a",
    "held.b",
    "typeof held.b",
    "held.a + held.b",
    "(held‹ as any›).c",
    "typeof (held‹ as any›).c",
    "(held‹ as any›).inherited",
    "Object.keys(held).join()",
    "Object.values(held).join()",
    "JSON.stringify(held)",
    "JSON.stringify({ ...held })",
    `"a" in held`,
    `"c" in held`,
    `Object.hasOwn(held, "a")`,
    "Object.isFrozen(held)",
    "Object.isExtensible(held)",
    "Object.getPrototypeOf(held) === Object.prototype",
    "Object.getOwnPropertyNames(held).join()",
    "`${held.a}`",
    "held.a === 1",
  ],
};

const things: Record<string, Thing> = {
  "a literal": { makes: `{ a: 1, b: "two" }`, type: "{ a: number; b: string }", ...ofObjects },
  "an instance": {
    declares: `class Made {\na = 1;\nb = "two";\nread() {\nreturn this.a;\n}\n}`,
    makes: "new Made()",
    type: "Made",
    changes: [
      ...ofObjects.changes,
      "§.read = () => 5;",
      "Object.setPrototypeOf(§, { read() { return 6; } });",
      "§.constructor.prototype.read = function () { return 7; };",
    ],
    reads: [
      ...ofObjects.reads.filter(read => !read.includes("Object.prototype")),
      "held.read()",
      "held.read() + 1",
      "held instanceof Made",
      "Object.getPrototypeOf(held) === Made.prototype",
    ],
  },
  "an instance with a constructor": {
    declares:
      "class Made {\na: number;\nb: string;\nconstructor(a: number, b: string) {\nthis.a = a;\nthis.b = b;\n}\nread() {\nreturn this.a;\n}\n}",
    makes: `new Made(1, "two")`,
    type: "Made",
    changes: [...ofObjects.changes, "§.read = () => 5;"],
    reads: [...ofObjects.reads.filter(read => !read.includes("Object.prototype")), "held.read()", "held.read() + 1"],
  },
  "a list": {
    makes: "[1, 2, 3]",
    type: "number[]",
    changes: [
      "§.push(4);",
      `§.push("four");`,
      "§[0] = 9;",
      `§[0] = "nine";`,
      "§[0] = 2.5;",
      "§[0] = undefined;",
      "§[5] = 6;",
      "§.length = 1;",
      "§.length = 0;",
      "§.length = 5;",
      "§.pop();",
      "§.shift();",
      "§.unshift(0);",
      "§.reverse();",
      "§.sort((one‹: number›, other‹: number›) => other - one);",
      "§.splice(0, 1);",
      "§.splice(1, 0, 7, 8);",
      "delete §[1];",
      "§.fill(0);",
      "§.copyWithin(0, 1);",
      "§.extra = 1;",
      "Object.freeze(§);",
      "Object.defineProperty(§, 0, { get() { return 10; } });",
      `Object.defineProperty(§, "length", { writable: false });`,
      "Object.setPrototypeOf(§, null);",
      "Object.assign(§, [7, 8]);",
      "Reflect.set(§, 0, 8);",
      `Reflect.set(§, "length", 2);`,
      "[§[0], §[2]] = [§[2], §[0]];",
      "§[0]++;",
    ],
    reads: [
      "held.length",
      "held[0]",
      "held[0] + 1",
      "typeof held[0]",
      "held[1]",
      "held[2]",
      "held[held.length - 1]",
      "held.join()",
      "1 in held",
      "5 in held",
      "(held‹ as any›).extra",
      "JSON.stringify(held)",
      "Object.keys(held).join()",
      "Array.isArray(held)",
      "Object.isFrozen(held)",
      "[...held].length",
      "held.indexOf(3)",
      "held.includes(4)",
      "held.reduce((sum, each) => sum + each, 0)",
    ],
  },
  "a map": {
    makes: `new Map([["k", 1]])`,
    type: "Map<string, number>",
    changes: [
      `§.set("k", 2);`,
      `§.set("l", 3);`,
      `§.set("k", "two");`,
      `§.delete("k");`,
      "§.clear();",
      "§.extra = 1;",
      "§.set(§, §);",
    ],
    reads: [
      "held.size",
      `held.get("k")`,
      `held.has("k")`,
      `held.has("l")`,
      "[...held.keys()].length",
      `typeof held.get("k")`,
      "(held‹ as any›).extra",
      `(held.get("k") ?? 0) + 1`,
    ],
  },
  "a set": {
    makes: "new Set([1, 2])",
    type: "Set<number>",
    changes: ["§.add(3);", `§.add("three");`, "§.delete(1);", "§.clear();", "§.add(§);"],
    reads: ["held.size", "held.has(1)", "held.has(3)", "[...held].length"],
  },
  "a function": {
    makes: "function made() {\nreturn 1;\n}",
    type: "() => number",
    changes: [
      "§.count = 1;",
      `Object.defineProperty(§, "name", { value: "renamed" });`,
      `Object.defineProperty(§, "length", { value: 3 });`,
      "§.prototype = { marked: 1 };",
      "§.prototype.marked = 1;",
      "Object.setPrototypeOf(§, null);",
      "Object.freeze(§);",
      "§.call = () => 5;",
    ],
    reads: [
      "(held‹ as any›).count",
      "held.name",
      "held.length",
      "typeof held.prototype",
      "(held‹ as any›).prototype.marked",
      "Object.keys(held).join()",
      "typeof held.call",
      "Object.isFrozen(held)",
      "held()",
    ],
  },
  "a regular expression": {
    makes: "/a/g",
    type: "RegExp",
    changes: [
      "§.lastIndex = 3;",
      `§.lastIndex = "3";`,
      `§.test("aaa");`,
      `§.exec("ba");`,
      "§.extra = 1;",
      `"aaa".replace(§, "b");`,
      "Object.freeze(§);",
      `§.compile("b", "i");`,
    ],
    reads: [
      "held.lastIndex",
      "typeof held.lastIndex",
      "held.lastIndex + 1",
      `held.test("aaaa")`,
      "held.source",
      "held.flags",
      "(held‹ as any›).extra",
    ],
  },
  "a date": {
    makes: "new Date(1000)",
    type: "Date",
    changes: ["§.setTime(0);", "§.setTime(NaN);", "§.setUTCFullYear(2000);", "§.extra = 1;", "§.getTime = () => 5;"],
    reads: [
      "held.getTime()",
      "held.valueOf()",
      "+held",
      "held.toISOString()",
      "(held‹ as any›).extra",
      "JSON.stringify(held)",
    ],
  },
  bytes: {
    makes: "new Uint8Array([1, 2, 3])",
    type: "Uint8Array",
    changes: [
      "§[0] = 9;",
      "§[0] = 300;",
      `§[0] = "7";`,
      "§.fill(5);",
      "§.set([7, 8]);",
      "§.reverse();",
      "new Uint8Array(§.buffer)[1] = 6;",
      "§.extra = 1;",
      "§.sort((one‹: number›, other‹: number›) => other - one);",
    ],
    reads: ["held[0]", "held[0] + 1", "held[1]", "held.join()", "held.length", "(held‹ as any›).extra"],
  },
  "an object inside an object": {
    makes: `{ inner: { a: 1, b: "two" }, mark: 1 }`,
    type: "{ inner: { a: number; b: string }; mark: number }",
    handed: "held.inner",
    changes: ofObjects.changes,
    reads: ofObjects.reads
      .map(read => read.replace(/\bheld\b/g, "held.inner"))
      .concat("JSON.stringify(held)", "held.mark + held.inner.a"),
  },
  "an object inside a list": {
    makes: `[{ a: 1, b: "two" }]`,
    type: "{ a: number; b: string }[]",
    handed: "held[0]",
    changes: ofObjects.changes,
    reads: ofObjects.reads
      .map(read => read.replace(/\bheld\b/g, "held[0]"))
      .concat("JSON.stringify(held)", "held.map(each => each.a).join()"),
  },
};

const wrongTypes = [
  "number",
  "number",
  "number",
  "string",
  "string",
  "boolean",
  "bigint",
  "symbol",
  "null",
  "undefined",
  "void",
  "never",
  "5",
  `"text"`,
  "true",
  "Other",
  "Other",
  "{ z: number }",
  "{ a: string }",
  "string[]",
  "[number]",
  "() => void",
  "Promise<number>",
  "number | string",
  "number | null",
  "readonly number[]",
  "Readonly<{ a: number; b: string }>",
  "unknown",
  "object",
  "{}",
  "any",
  "RIGHT",
];

export function generate(random: Random): { file: string; text: string; files: Record<string, string> } {
  // The relations first.
  const thing = things[random.pick(Object.keys(things))];
  const drawnType = random.pick(wrongTypes);
  const road = random.weighted([
    [5, "returned"],
    [2, "a constant"],
    [4, "an argument"],
    [2, "a field of a carrier"],
    [2, "an element of a list"],
    [1, "a value of a map"],
    [2, "a generic function"],
    [2, "a callback"],
    [1, "awaited"],
  ] as const);
  const saying = random.weighted([
    [4, "as any"],
    [3, "as unknown as T"],
    [2, "@ts-ignore"],
    [1, "a generic cast"],
    [3, "a declaration file"],
    [2, "JSDoc"],
  ] as const);
  const farEnd = random.weighted([
    [3, "casts in place"],
    [2, "a variable of type any"],
    [2, "is not checked"],
    [2, "hands it to JavaScript"],
    [3, "JavaScript"],
  ] as const);
  const reading = random.weighted([
    [5, "behind"],
    [3, "ahead and behind"],
    [2, "in one expression"],
    [2, "in a loop"],
  ] as const);
  const reader = random.weighted([
    [4, "the file that made it"],
    [2, "the first file"],
  ] as const);
  const isBetween = random.chance(0.2);
  const guard = random.chance(0.5);
  const isStrict = random.chance(0.85);
  const writesEnds = random.chance(0.5);
  const drawnChange = random.pick(thing.changes);
  const read = random.pick(thing.reads);

  const isNearTyped = saying !== "a declaration file" && saying !== "JSDoc";
  const isFarTyped = farEnd !== "JavaScript";
  const files: Record<string, string> = {};
  const type = drawnType === "RIGHT" ? (thing.handed ? "{ a: number; b: string }" : thing.type) : drawnType;
  // A class of the file that makes the object is named there alone.
  const isLocalType = type === "Made";
  const said = isLocalType ? "Made" : type;
  const usesOther = said === "Other";
  const ts = (name: string) => (writesEnds ? `./${name}.ts` : `./${name}`);
  const nearPath = isNearTyped ? ts("near") : "./near.js";
  const farPath = isFarTyped ? ts("far") : "./far.js";
  const inTypeScript = (text: string) => text.replace(/‹([^›]*)›/g, "$1");
  const inJavaScript = (text: string) => text.replace(/‹[^›]*›/g, "");
  const erased = (text: string) =>
    text.replace(/^(\w+): \w+;\n/gm, "").replace(/\((\w+): \w+, (\w+): \w+\)/, "($1, $2)");
  if (usesOther) files["other.ts"] = 'export class Other {\n  z = 0;\n  name = "other";\n}\n';
  const otherImport = (typed: boolean) =>
    usesOther && typed ? [`import type { Other } from ${JSON.stringify(ts("other"))};`] : [];
  const madeImport = (typed: boolean) =>
    isLocalType && typed ? [`import type { Made } from ${JSON.stringify(nearPath)};`] : [];
  const jsdocType = usesOther ? `import(${JSON.stringify(ts("other"))}).Other` : said;

  const handed = thing.handed ?? "held";
  /** The object under the type, where the file that makes it is TypeScript. */
  const nearHead: string[] = [...otherImport(isNearTyped)];
  const disguised = (write: (text: string) => string): string[] => {
    if (!isNearTyped) return [write(handed)];
    if (saying === "as any") return [write(`${handed} as ${said === "never" ? "never" : "any"}`)];
    if (saying === "as unknown as T") return [write(`${handed} as unknown as ${said}`)];
    if (saying === "@ts-ignore") return ["// @ts-ignore", write(handed)];
    nearHead.push("function cast<T>(value: unknown): T {\nreturn value as T;\n}");
    return [write(`cast<${said}>(${handed})`)];
  };

  // The far end.
  const far: string[] = [];
  const farHead: string[] = [
    ...(farEnd === "is not checked" ? ["// @ts-nocheck"] : []),
    ...otherImport(isFarTyped),
    ...madeImport(isFarTyped),
  ];
  const changed = (x: string): string[] => {
    const change = (farEnd === "casts in place" || farEnd === "a variable of type any" ? inTypeScript : inJavaScript)(
      drawnChange,
    );
    switch (farEnd) {
      case "casts in place":
        return change.replaceAll("§", `(${x} as any)`).split("\n");
      case "a variable of type any":
        return [`const real: any = ${x};`, ...change.replaceAll("§", "real").split("\n")];
      case "hands it to JavaScript":
        files["touch.js"] = `export function touch(real) {\n${change.replaceAll("§", "real")}\n}\n`;
        files["touch.d.ts"] = "export declare function touch(real: unknown): void;\n";
        farHead.push(`import { touch } from "./touch.js";`);
        return [`touch(${x});`];
      default:
        return change.replaceAll("§", x).split("\n");
    }
  };
  const of = (annotation: string, typed: boolean) => (typed ? annotation : "");

  // The road. `go` is what the reader writes to make the object travel and be changed.
  const near: string[] = [];
  const nearDeclared: string[] = [];
  const carrier: string[] = [];
  const mainHead: string[] = [];
  const declares = thing.declares ? (isNearTyped ? thing.declares : erased(thing.declares)) : "";
  if (declares) near.push((isLocalType || reader === "the first file" ? "export " : "") + declares);
  near.push(
    `${reader === "the first file" ? "export " : ""}const held${isNearTyped && random.chance(0.4) ? `: ${thing.type}` : ""} = ${thing.makes};`,
  );
  if (!isNearTyped && declares && (isLocalType || reader === "the first file"))
    nearDeclared.push(
      "export declare class Made {\n  a: number;\n  b: string;\n  constructor(a?: number, b?: string);\n  read(): number;\n}",
    );
  if (!isNearTyped && reader === "the first file") nearDeclared.push(`export declare const held: ${thing.type};`);
  const doc = (text: string) => (saying === "JSDoc" ? [`/** ${text} */`] : []);
  const isAsync = road === "awaited";
  let go: string;
  const goNeeds: [string, string][] = [];
  const importsInto = (head: string[], names: string[], from: string) =>
    head.push(`import { ${names.join(", ")} } from ${JSON.stringify(from)};`);
  const between = (name: string, from: string) => {
    if (!isBetween) return from;
    files["between.ts"] = (files["between.ts"] ?? "") + `export { ${name} } from ${JSON.stringify(from)};\n`;
    return ts("between");
  };
  const carrierPath = ts("carrier");
  switch (road) {
    case "returned":
    case "awaited":
    case "a generic function": {
      near.push(
        ...doc(`@returns {${isAsync ? `Promise<${jsdocType}>` : jsdocType}}`),
        `export ${isAsync ? "async " : ""}function give()${of(`: ${isAsync ? `Promise<${said}>` : said}`, isNearTyped)} {`,
        ...disguised(text => `return ${text};`),
        "}",
      );
      nearDeclared.push(`export declare function give(): ${isAsync ? `Promise<${said}>` : said};`);
      // What is awaited is no promise any more.
      far.push(
        `export function change(x${of(`: ${isAsync && said === "Promise<number>" ? "number" : said}`, isFarTyped)}) {`,
        ...changed("x"),
        "}",
      );
      goNeeds.push(["give", between("give", nearPath)], ["change", between("change", farPath)]);
      if (road === "a generic function") {
        carrier.push("export function through<T>(value: T): T {", "return value;", "}");
        goNeeds.push(["through", carrierPath]);
        go = random.pick([
          "change(through(give()))",
          reader === "the first file" || isNearTyped
            ? `change(through<${said === "Made" || said === "Other" ? "ReturnType<typeof give>" : said}>(give()))`
            : "change(through(through(give())))",
          "through(change)(give())",
        ]);
      } else go = isAsync ? "change(await give())" : "change(give())";
      break;
    }
    case "a constant": {
      near.push(
        ...doc(`@type {${jsdocType}}`),
        ...disguised(text => `export const given${of(`: ${said}`, isNearTyped)} = ${text};`),
      );
      nearDeclared.push(`export declare const given: ${said};`);
      far.push(`export function change(x${of(`: ${said}`, isFarTyped)}) {`, ...changed("x"), "}");
      goNeeds.push(["given", between("given", nearPath)], ["change", between("change", farPath)]);
      go = "change(given)";
      break;
    }
    case "an argument": {
      far.push(`export function change(x${of(`: ${said}`, isFarTyped)}) {`, ...changed("x"), "}");
      importsInto(nearHead, ["change"], between("change", farPath));
      near.push("export function send() {", ...disguised(text => `change(${text});`), "}");
      nearDeclared.push("export declare function send(): void;");
      goNeeds.push(["send", nearPath]);
      go = "send()";
      break;
    }
    case "a field of a carrier":
    case "an element of a list":
    case "a value of a map": {
      const [declared, puts, takes] = {
        "a field of a carrier": [
          [
            "export class Carrier {",
            `constructor(public cargo: ${said}) {}`,
            "}",
            "export const carriers: Carrier[] = [];",
          ],
          (text: string) => `carriers.push(new Carrier(${text}));`,
          "carriers[0].cargo",
        ],
        "an element of a list": [
          [`export const cargo: ${said.includes(" ") ? `(${said})` : said}[] = [];`],
          (text: string) => `cargo.push(${text});`,
          "cargo[0]",
        ],
        "a value of a map": [
          [`export const cargo = new Map<string, ${said}>();`],
          (text: string) => `cargo.set("key", ${text});`,
          `cargo.get("key")`,
        ],
      }[road] as [string[], (text: string) => string, string];
      carrier.push(...otherImport(true), ...madeImport(true), ...declared);
      const names = road === "a field of a carrier" ? ["Carrier", "carriers"] : ["cargo"];
      importsInto(nearHead, names, isNearTyped || saying === "JSDoc" ? carrierPath : "./carrier.ts");
      importsInto(farHead, [names.at(-1)!], isFarTyped ? carrierPath : "./carrier.ts");
      near.push("export function send() {", ...disguised(puts), "}");
      nearDeclared.push("export declare function send(): void;");
      far.push("export function change() {", ...changed(takes), "}");
      goNeeds.push(["send", nearPath], ["change", between("change", farPath)]);
      go = "(send(), change())";
      break;
    }
    case "a callback": {
      carrier.push(
        ...otherImport(true),
        ...madeImport(true),
        `const handlers: ((x: ${said}) => void)[] = [];`,
        `export function on(handler: (x: ${said}) => void) {`,
        "handlers.push(handler);",
        "}",
        `export function fire(x: ${said}) {`,
        "for (const handler of handlers) handler(x);",
        "}",
      );
      importsInto(farHead, ["on"], isFarTyped ? carrierPath : "./carrier.ts");
      importsInto(nearHead, ["fire"], isNearTyped || saying === "JSDoc" ? carrierPath : "./carrier.ts");
      far.push(`on((x${of(`: ${said}`, isFarTyped)}) => {`, ...changed("x"), "});");
      near.push("export function send() {", ...disguised(text => `fire(${text});`), "}");
      nearDeclared.push("export declare function send(): void;");
      mainHead.push(`import ${JSON.stringify(farPath)};`);
      goNeeds.push(["send", nearPath]);
      go = "send()";
      break;
    }
  }

  // The read.
  const isReaderTyped = reader === "the first file" ? true : isNearTyped;
  const shown = (isReaderTyped ? inTypeScript : inJavaScript)(read);
  let lines: string[];
  if (reading === "behind") lines = [`${go};`, `console.log(${shown});`];
  else if (reading === "ahead and behind") lines = [`console.log(${shown});`, `${go};`, `console.log(${shown});`];
  else if (reading === "in one expression")
    lines = [
      random.chance(0.5)
        ? `console.log(${shown}, (${go}, ${shown}));`
        : `console.log([${shown}, ${go}, ${shown}].length, ${shown});`,
    ];
  else
    lines = [
      "let last;",
      "for (let turn = 0; turn < 10000; turn++) {",
      `if (turn === 9998) ${go};`,
      `last = ${shown};`,
      "}",
      "console.log(last);",
    ];
  if (guard)
    lines = [
      "try {",
      ...lines,
      "} catch (error) {",
      `console.log("THROWS", error instanceof TypeError ? "TypeError" : error instanceof RangeError ? "RangeError" : typeof error);`,
      "}",
    ];

  const main: string[] = [...mainHead];
  const ignored = (from: string, typed: boolean) => (typed && from === "./far.js" && isStrict ? ["// @ts-ignore"] : []);
  if (reader === "the first file") {
    const wanted = new Map<string, string[]>();
    for (const [name, from] of goNeeds) wanted.set(from, [...(wanted.get(from) ?? []), name]);
    wanted.set(nearPath, [...(wanted.get(nearPath) ?? []), "held", ...(/\bMade\b/.test(shown) ? ["Made"] : [])]);
    for (const [from, names] of wanted)
      main.push(...ignored(from, true), `import { ${names.join(", ")} } from ${JSON.stringify(from)};`);
    main.push(...lines);
  } else {
    // The file that made it reads it: what it needs of the far end it imports itself.
    for (const [name, from] of goNeeds)
      if (from !== nearPath && !["give", "given", "send"].includes(name))
        nearHead.push(
          ...ignored(from, isNearTyped),
          `import { ${name} } from ${JSON.stringify(!isNearTyped && saying !== "JSDoc" && /^\.\/\w+$/.test(from) ? from + ".ts" : from)};`,
        );
    near.push(`export ${isAsync ? "async " : ""}function report() {`, ...lines, "}");
    nearDeclared.push(`export declare function report(): ${isAsync ? "Promise<void>" : "void"};`);
    main.push(`import { report } from ${JSON.stringify(nearPath)};`, `${isAsync ? "await " : ""}report();`);
  }
  // Imports of the far end that TypeScript knows nothing about.
  const fixed = (head: string[], typed: boolean) =>
    head.flatMap(line =>
      typed && isStrict && /from "\.\/far\.js";$|^import "\.\/far\.js";$/.test(line) ? ["// @ts-ignore", line] : [line],
    );

  files[isNearTyped ? "near.ts" : "near.js"] =
    [
      ...fixed(
        nearHead.filter(line => line !== "// @ts-ignore"),
        isNearTyped,
      ),
      ...near,
    ].join("\n") + "\n";
  if (saying === "a declaration file") files["near.d.ts"] = [...otherImport(true), ...nearDeclared].join("\n") + "\n";
  files[isFarTyped ? "far.ts" : "far.js"] = [...farHead, ...far].join("\n") + "\n";
  if (carrier.length) files["carrier.ts"] = carrier.join("\n") + "\n";
  if (files["between.ts"] && isStrict)
    files["between.ts"] = files["between.ts"].replace(
      /^(export \{ \w+ \} from "\.\/far\.js";)$/gm,
      "// @ts-ignore\n$1",
    );
  files["tsconfig.json"] =
    JSON.stringify(
      {
        compilerOptions: {
          target: "esnext",
          module: "preserve",
          moduleResolution: "bundler",
          noEmit: true,
          strict: isStrict,
          types: [],
          ...(saying === "JSDoc" && { allowJs: true }),
          ...(writesEnds && { allowImportingTsExtensions: true }),
        },
      },
      null,
      2,
    ) + "\n";
  return {
    file: "main.ts",
    text:
      fixed(
        main.filter(line => line !== "// @ts-ignore"),
        true,
      ).join("\n") + "\n",
    files,
  };
}
