// A static field is declared with a narrow type: an enum, a const enum, flags, a union of number literals, one of these or undefined, null or a
// string. TypeScript lets other values in: any number into a numeric enum, anything through `any` and `as`. A program draws the type, how the class
// is written, two such values and how each gets the type, the way and the place of each store, and a handful of reads. It prints what every read
// gives at the start, while the field holds a member, after each of the two stores and after a member is stored again.
import type { Random } from "./random";

type Declared = {
  declarations: string[];
  type: string;
  members: [string, string];
  /** The checker lets a `number` in without a cast. */
  takesNumbers: boolean;
  /** A `number` can be cast to it with one `as`. */
  isNumeric: boolean;
  asNumber: (read: string) => string;
  hasNames?: boolean;
};

const same = (read: string) => read;
const twoMembers = `enum Mode { Off, On }`;
const declaredTypes: Record<string, Declared> = {
  "enum": {
    declarations: [twoMembers],
    type: "Mode",
    members: ["Mode.Off", "Mode.On"],
    takesNumbers: true,
    isNumeric: true,
    asNumber: same,
    hasNames: true,
  },
  "const-enum": {
    declarations: [`const enum Mode { Off, On }`],
    type: "Mode",
    members: ["Mode.Off", "Mode.On"],
    takesNumbers: true,
    isNumeric: true,
    asNumber: same,
  },
  "flags": {
    declarations: [`enum Mode { None = 0, Read = 1, Write = 2, Run = 4 }`],
    type: "Mode",
    members: ["Mode.Read", "Mode.Write"],
    takesNumbers: true,
    isNumeric: true,
    asNumber: same,
    hasNames: true,
  },
  "enum-at-both-ends-of-int32": {
    declarations: [`enum Mode { Low = -2147483648, High = 2147483647 }`],
    type: "Mode",
    members: ["Mode.Low", "Mode.High"],
    takesNumbers: true,
    isNumeric: true,
    asNumber: same,
    hasNames: true,
  },
  "enum-of-one-member": {
    declarations: [`enum Mode { Only = 3 }`],
    type: "Mode",
    members: ["Mode.Only", "Mode.Only"],
    takesNumbers: true,
    isNumeric: true,
    asNumber: same,
    hasNames: true,
  },
  "one-member-of-an-enum": {
    declarations: [twoMembers],
    type: "Mode.On",
    members: ["Mode.On", "Mode.On"],
    takesNumbers: true,
    isNumeric: true,
    asNumber: same,
    hasNames: true,
  },
  "enum-with-computed-members": {
    declarations: [`enum Mode { Off = "".length, On = "a".length }`],
    type: "Mode",
    members: ["Mode.Off", "Mode.On"],
    takesNumbers: true,
    isNumeric: true,
    asNumber: same,
    hasNames: true,
  },
  "number-literals": {
    declarations: [`type Mode = 0 | 1 | 2;`],
    type: "Mode",
    members: ["0", "1"],
    takesNumbers: false,
    isNumeric: true,
    asNumber: same,
  },
  "one-number-literal": {
    declarations: [`type Mode = 1;`],
    type: "Mode",
    members: ["1", "1"],
    takesNumbers: false,
    isNumeric: true,
    asNumber: same,
  },
  "wide-number-literals": {
    declarations: [`type Mode = -1 | 255 | 65536;`],
    type: "Mode",
    members: ["-1", "65536"],
    takesNumbers: false,
    isNumeric: true,
    asNumber: same,
  },
  "enum-or-undefined": {
    declarations: [twoMembers],
    type: "Mode | undefined",
    members: ["Mode.On", "undefined"],
    takesNumbers: true,
    isNumeric: true,
    asNumber: read => `${read}!`,
    hasNames: true,
  },
  "enum-or-null": {
    declarations: [twoMembers],
    type: "Mode | null",
    members: ["Mode.On", "null"],
    takesNumbers: true,
    isNumeric: true,
    asNumber: read => `${read}!`,
    hasNames: true,
  },
  "enum-or-string": {
    declarations: [twoMembers],
    type: "Mode | string",
    members: ["Mode.On", `"text"`],
    takesNumbers: true,
    isNumeric: true,
    asNumber: read => `(${read} as Mode)`,
    hasNames: true,
  },
  "number-literals-or-undefined": {
    declarations: [`type Mode = 0 | 1 | 2;`],
    type: "Mode | undefined",
    members: ["1", "undefined"],
    takesNumbers: false,
    isNumeric: true,
    asNumber: read => `${read}!`,
  },
  "string-enum": {
    declarations: [`enum Mode { Off = "off", On = "on" }`],
    type: "Mode",
    members: ["Mode.Off", "Mode.On"],
    takesNumbers: false,
    isNumeric: false,
    asNumber: read => `(${read} as unknown as number)`,
  },
  "enum-of-numbers-and-strings": {
    declarations: [`enum Mode { Off, On = "on" }`],
    type: "Mode",
    members: ["Mode.Off", "Mode.On"],
    takesNumbers: false,
    isNumeric: false,
    asNumber: read => `(${read} as unknown as number)`,
  },
  "boolean": {
    declarations: [],
    type: "boolean",
    members: ["false", "true"],
    takesNumbers: false,
    isNumeric: false,
    asNumber: read => `(${read} as unknown as number)`,
  },
  "number": {
    declarations: [],
    type: "number",
    members: ["0", "1"],
    takesNumbers: true,
    isNumeric: true,
    asNumber: same,
  },
};

const numbers: Record<string, string> = {
  "seven": `7`,
  "minus-one": `-1`,
  "two31": `2 ** 31`,
  "below-int32": `-(2 ** 31) - 1`,
  "int32-max": `2147483647`,
  "int32-min": `-2147483648`,
  "two32": `2 ** 32`,
  "two32-plus-one": `2 ** 32 + 1`,
  "uint32-max": `4294967295`,
  "two53": `2 ** 53`,
  "past-two53": `2 ** 53 + 2`,
  "minus-two53": `-(2 ** 53)`,
  "half": `0.5`,
  "minus-zero": `-0`,
  "nan": `NaN`,
  "infinity": `Infinity`,
  "minus-infinity": `-Infinity`,
  "huge": `1e300`,
  "tiny": `5e-324`,
  "just-below-two31": `2 ** 31 - 0.5`,
  "product": `one * 2147483648`,
  "unsigned-shift": `(one << 31) >>> 0`,
  "shift-that-wraps": `one << 31`,
  "sum-past-the-end": `2147483647 + one`,
  "difference-past-the-end": `-2147483648 - one`,
  "quotient": `one / 2`,
  "product-that-is-minus-zero": `-one * 0`,
  "root-of-a-negative": `Math.sqrt(-one)`,
  "parsed": `Number("2147483648")`,
  "parsed-fraction": `parseFloat("1.5")`,
  "element": `[2 ** 31, 2 ** 53][one - 1]`,
  "power": `Math.pow(2, 30 + one)`,
  "past-the-safe-integers": `Number.MAX_SAFE_INTEGER + one`,
  "length": `"abcdefg".length`,
};

const otherValues: Record<string, string> = {
  "text": `"text"`,
  "digits": `"1"`,
  "undefined": `undefined`,
  "null": `null`,
  "true": `true`,
  "bigint": `10n`,
  "object-with-valueOf": `{ valueOf() { return 2 ** 31; } }`,
  "array": `[1]`,
  "symbol": `Symbol.for("s")`,
  "function": `() => 1`,
  "boxed-number": `new Number(1)`,
};

type Typed = { declarations: string[]; expression: string };
/** How a raw value becomes an expression of the declared type. `raw` names a constant of type number or unknown. */
const entries: Record<string, (raw: string, n: number, declared: Declared, isNumber: boolean) => Typed | undefined> = {
  "number": (raw, _, declared, isNumber) =>
    declared.takesNumbers && isNumber ? { declarations: [], expression: raw } : undefined,
  "as": (raw, _, declared, isNumber) =>
    declared.isNumeric && isNumber ? { declarations: [], expression: `(${raw} as Held)` } : undefined,
  "as-unknown-as": raw => ({ declarations: [], expression: `(${raw} as unknown as Held)` }),
  "any": (raw, n) => ({ declarations: [`const loose${n}: any = ${raw};`], expression: `loose${n}` }),
  "type-argument": (raw, n) => ({
    declarations: [`function hand${n}<Item>(item: Item): Item { return item; }`],
    expression: `hand${n}<Held>(${raw} as any)`,
  }),
  "returned": (raw, n) => ({
    declarations: [`function give${n}(): Held { return ${raw} as any; }`],
    expression: `give${n}()`,
  }),
  "instance-field": (raw, n) => ({
    declarations: [`class Box${n} { kept: Held; constructor(v: Held) { this.kept = v; } }`],
    expression: `new Box${n}(${raw} as any).kept`,
  }),
  "another-static-field": (raw, n, declared) => ({
    declarations: [
      `class Other${n} { static kept: Held = ${declared.members[0]}; }`,
      `Other${n}.kept = ${raw} as any;`,
    ],
    expression: `Other${n}.kept`,
  }),
  "element": (raw, n, declared) => ({
    declarations: [`const list${n}: Held[] = [${declared.members[0]}, ${raw} as any];`],
    expression: `list${n}[1]`,
  }),
  "property": (raw, n) => ({
    declarations: [`const record${n}: { kept: Held } = { kept: ${raw} as any };`],
    expression: `record${n}.kept`,
  }),
};

type Holder = {
  declarations: (type: string, start: string, other: string, members: string) => string[];
  base: string;
  watched: string[];
};
const holders: Record<string, Holder> = {
  "class": {
    declarations: (t, a, _, m) => [`class Shelf { static held: ${t} = ${a}; ${m} }`],
    base: "Shelf",
    watched: [],
  },
  "among-other-fields": {
    declarations: (t, a, _, m) => [
      `class Shelf { static first = "f"; static held: ${t} = ${a}; static last = 1.5; static list: number[] = []; ${m} }`,
    ],
    base: "Shelf",
    watched: ["Shelf.first", "Shelf.last"],
  },
  "below-the-class-that-declares-it": {
    declarations: (t, a, _, m) => [`class Base { static held: ${t} = ${a}; ${m} }`, `class Shelf extends Base {}`],
    base: "Shelf",
    watched: ["Base.held"],
  },
  "declared-again-below": {
    declarations: (t, a, b, m) => [
      `class Base { static held: ${t} = ${b}; }`,
      `class Shelf extends Base { static held: ${t} = ${a}; ${m} }`,
    ],
    base: "Shelf",
    watched: ["Base.held"],
  },
  "class-expression": {
    declarations: (t, a, _, m) => [`const Shelf = class { static held: ${t} = ${a}; ${m} };`],
    base: "Shelf",
    watched: [],
  },
  "made-by-a-function": {
    declarations: (t, a, _, m) => [
      `function makeShelf() { return class { static held: ${t} = ${a}; ${m} }; }`,
      `const Shelf = makeShelf();`,
      `const Twin = makeShelf();`,
    ],
    base: "Shelf",
    watched: ["Twin.held"],
  },
  "stored-in-a-static-block": {
    declarations: (t, a, _, m) => [`class Shelf { static held: ${t}; static { Shelf.held = ${a}; } ${m} }`],
    base: "Shelf",
    watched: [],
  },
  "without-an-initializer": {
    declarations: (t, _, __, m) => [`class Shelf { static held: ${t}; ${m} }`],
    base: "Shelf",
    watched: [],
  },
  "private-behind-accessors": {
    declarations: (t, a, _, m) => [
      `class Shelf { static #kept: ${t} = ${a}; static get held(): ${t} { return Shelf.#kept; } static set held(v: ${t}) { Shelf.#kept = v; } ${m} }`,
    ],
    base: "Shelf",
    watched: [],
  },
  "generic": {
    declarations: (t, a, _, m) => [`class Shelf<Item> { static held: ${t} = ${a}; item?: Item; ${m} }`],
    base: "Shelf<number>",
    watched: [],
  },
  "abstract": {
    declarations: (t, a, _, m) => [`abstract class Shelf { static held: ${t} = ${a}; ${m} }`],
    base: "Shelf",
    watched: [],
  },
  "beside-an-instance-field-of-that-name": {
    declarations: (t, a, b, m) => [
      `class Shelf { static held: ${t} = ${a}; held: ${t} = ${b}; ${m} }`,
      `const shelf = new Shelf();`,
    ],
    base: "Shelf",
    watched: ["shelf.held"],
  },
};

type Store = { members?: string; below?: string[]; declarations?: string[]; run: string; watched?: string[] };
type Road = (v: string, n: number, declared: Declared, base: string) => Store | undefined;
const arithmetic =
  (write: (v: string) => string): Road =>
  (v, _, declared) =>
    declared.takesNumbers && declared.asNumber === same ? { run: write(v) } : undefined;
const roads: Record<string, Road> = {
  "name": v => ({ run: `Shelf.held = ${v};` }),
  "parameter": (v, n) => ({ declarations: [`function put${n}(v: Held) { Shelf.held = v; }`], run: `put${n}(${v});` }),
  "this": (v, n) => ({ members: `static put${n}(v: Held) { this.held = v; }`, run: `Shelf.put${n}(${v});` }),
  "parameter-that-holds-the-class": (v, n) => ({
    declarations: [`function putInto${n}(holder: typeof Shelf, v: Held) { holder.held = v; }`],
    run: `putInto${n}(Shelf, ${v});`,
  }),
  "parameter-that-holds-the-class-or-a-record": (v, n, declared) => ({
    declarations: [`function putInto${n}(holder: { held: Held }, v: Held) { holder.held = v; }`],
    run: `putInto${n}({ held: ${declared.members[0]} }, ${declared.members[1]}); putInto${n}(Shelf, ${v});`,
  }),
  "written-key": v => ({ run: `Shelf["held"] = ${v};` }),
  "computed-key": v => ({ run: `Shelf[key] = ${v};` }),
  "Reflect.set": v => ({ run: `Reflect.set(Shelf, "held", ${v});` }),
  "Object.assign": v => ({ run: `Object.assign(Shelf, { held: ${v} });` }),
  "Object.defineProperty": v => ({
    run: `Object.defineProperty(Shelf, "held", { value: ${v}, writable: true, enumerable: true, configurable: true });`,
  }),
  "object-pattern": v => ({ run: `({ held: Shelf.held } = { held: ${v} });` }),
  "array-pattern": v => ({ run: `[Shelf.held] = [${v}];` }),
  "head-of-a-loop": v => ({ run: `for (Shelf.held of [${v}]);` }),
  "subclass": (v, n, _, base) => ({
    below: [`class Below${n} extends ${base} {}`],
    run: `Below${n}.held = ${v};`,
    watched: [`Below${n}.held`],
  }),
  "super": (v, n, _, base) => ({
    below: [`class Below${n} extends ${base} { static putAbove(v: Held) { super.held = v; } }`],
    run: `Below${n}.putAbove(${v});`,
    watched: [`Below${n}.held`],
  }),
  "any": v => ({ run: `(Shelf as any).held = ${v};` }),
  "another-name-for-the-class": (v, n) => ({ run: `const same${n} = Shelf; same${n}.held = ${v};` }),
  "either-of-two": (v, _, declared) => ({ run: `Shelf.held = chosen === 1 ? ${v} : ${declared.members[0]};` }),
  "deleted-first": v => ({ run: `delete (Shelf as any).held; Shelf.held = ${v};` }),
  "or-assignment": v => ({ run: `Shelf.held ||= ${v};` }),
  "and-assignment": v => ({ run: `Shelf.held &&= ${v};` }),
  "nullish-assignment": v => ({ run: `Shelf.held ??= ${v};` }),
  "added": arithmetic(v => `Shelf.held += ${v};`),
  "multiplied": arithmetic(v => `Shelf.held *= ${v};`),
  "or-of-bits": arithmetic(v => `Shelf.held |= ${v};`),
  "incremented": arithmetic(v => `Shelf.held = ${v}; Shelf.held++;`),
  "decremented": arithmetic(v => `Shelf.held = ${v}; --Shelf.held;`),
  "negated": arithmetic(v => `Shelf.held = ${v}; Shelf.held = -Shelf.held;`),
  "shifted-left": arithmetic(v => `Shelf.held = ${v}; Shelf.held <<= 31;`),
  "shifted-without-a-sign": arithmetic(v => `Shelf.held = ${v}; Shelf.held >>>= 0;`),
  "divided": arithmetic(v => `Shelf.held = ${v}; Shelf.held /= 3;`),
  "doubled-forty-times": arithmetic(v => `Shelf.held = ${v}; for (let i = 0; i < 40; i++) Shelf.held *= 2;`),
};

type Placed = { declarations?: string[]; run: string };
const places: Record<string, (run: string, n: number, member: string) => Placed> = {
  "top-level": run => ({ run }),
  "function": (run, n) => ({ declarations: [`function store${n}() { ${run} }`], run: `store${n}();` }),
  "arrow-function": (run, n) => ({ declarations: [`const store${n} = () => { ${run} };`], run: `store${n}();` }),
  "callback": run => ({ run: `[0].forEach(() => { ${run} });` }),
  "async-function": (run, n) => ({
    declarations: [`async function store${n}() { await null; ${run} }`],
    run: `await store${n}();`,
  }),
  "promise-job": run => ({ run: `await Promise.resolve().then(() => { ${run} });` }),
  "timer": run => ({
    run: `await new Promise<void>((done, fail) => setTimeout(() => { try { ${run} done(); } catch (error) { fail(error); } }, 0));`,
  }),
  "generator": (run, n) => ({
    declarations: [`function* store${n}() { yield 1; ${run} yield 2; }`],
    run: `[...store${n}()];`,
  }),
  "catch": run => ({ run: `try { throw new Error("thrown"); } catch { ${run} }` }),
  "finally": run => ({ run: `try { one + 1; } finally { ${run} }` }),
  "last-turn-of-a-loop": (run, _, member) => ({
    run: `for (let turn = 0; turn < 200; turn++) { if (turn === 199) { ${run} } else { Shelf.held = ${member}; } }`,
  }),
  "every-turn-of-a-loop": run => ({ run: `for (let turn = 0; turn < 200; turn++) { ${run} }` }),
  "under-a-condition": run => ({ run: `if (one === 1) { ${run} }` }),
  "method-of-an-object": (run, n) => ({
    declarations: [`const worker${n} = { store() { ${run} } };`],
    run: `worker${n}.store();`,
  }),
  "static-block-of-another-class": (run, n) => ({ run: `class Later${n} { static { ${run} } }` }),
  "constructor": (run, n) => ({
    declarations: [`class Maker${n} { constructor() { ${run} } }`],
    run: `new Maker${n}();`,
  }),
  "code-that-never-runs": run => ({ run: `if (one === 2) { ${run} }` }),
};

type Read = { members?: string; below?: string[]; declarations?: string[]; expression: string };
const reads: Record<string, (n: number, declared: Declared, base: string) => Read> = {
  "name": () => ({ expression: `Shelf.held` }),
  "written-key": () => ({ expression: `Shelf["held"]` }),
  "computed-key": () => ({ expression: `Shelf[key]` }),
  "this": n => ({ members: `static take${n}(): Held { return this.held; }`, expression: `Shelf.take${n}()` }),
  "parameter-that-holds-the-class": n => ({
    declarations: [`function takeFrom${n}(holder: typeof Shelf): Held { return holder.held; }`],
    expression: `takeFrom${n}(Shelf)`,
  }),
  "parameter-that-holds-the-class-or-a-record": (n, declared) => ({
    declarations: [`function takeFrom${n}(holder: { held: Held }): Held { return holder.held; }`],
    expression: `takeFrom${n}(one === 1 ? Shelf : { held: ${declared.members[0]} })`,
  }),
  "pattern": () => ({ expression: `(({ held }: { held: Held }) => held)(Shelf)` }),
  "Reflect.get": () => ({ expression: `(Reflect.get(Shelf, "held") as Held)` }),
  "subclass": (n, _, base) => ({ below: [`class Under${n} extends ${base} {}`], expression: `Under${n}.held` }),
  "another-name-for-the-class": n => ({ declarations: [`const alias${n} = Shelf;`], expression: `alias${n}.held` }),
};

type Use = { declarations?: string[]; body: string };
/** `x` reads the field with its declared type, `n` is the same read as something arithmetic accepts. */
const uses: Record<string, (x: string, n: string, k: number, declared: Declared) => Use | undefined> = {
  "shown": x => ({ body: `return show(${x});` }),
  "typeof": x => ({ body: `return typeof ${x};` }),
  "arithmetic": (_, n) => ({
    body: `return [${n} + 1, ${n} - 1, ${n} * 2, ${n} / 2, ${n} % 7, -${n}, +${n}, ${n} ** 2].map(show).join();`,
  }),
  "operators-on-bits": (_, n) => ({
    body: `return [${n} | 0, ${n} >> 1, ${n} >>> 0, ${n} << 1, ${n} & 255, ${n} ^ 1, ~${n}].join();`,
  }),
  "comparisons": (x, n, _, d) => ({
    body: `return [${x} === ${d.members[0]}, ${x} !== ${d.members[1]}, ${x} == ${d.members[1]}, ${n} > 5, ${n} < 0, ${n} >= 2147483647, ${n} <= -2147483648, Object.is(${x}, ${d.members[0]})].join();`,
  }),
  "index": (_, n) => ({
    body: `return [[10, 20, 30][${n}], "abc"[${n}], new Uint8Array([1, 2, 3])[${n}], ({ 0: "zero", 1: "one", 2147483648: "wide" } as Record<number, string>)[${n}]].join();`,
  }),
  "name-of-the-member": (_, n, __, d) => (d.hasNames ? { body: `return Mode[${n}];` } : undefined),
  "switch": (x, _, __, d) => ({
    body: `switch (${x}) { case ${d.members[0]}: return "first"; case ${d.members[1]}: return "second"; default: return "neither " + show(${x}); }`,
  }),
  "closure": x => ({ body: `const read = () => ${x}; return show(read());` }),
  "text": (x, n) => ({ body: `return [\`\${${n}}\`, "" + ${n}, String(${x})].join();` }),
  "methods-of-numbers": (_, n) => ({
    body: `return [${n}.toString(), ${n}.toFixed(1), ${n}.toString(2).length, ${n}.toPrecision(3)].join();`,
  }),
  "truthiness": x => ({
    body: `return [${x} ? "yes" : "no", !${x}, ${x} ?? "none", ${x} || "none"].map(show).join();`,
  }),
  "Math": (_, n) => ({
    body: `return [Math.abs(${n}), Math.floor(${n}), Math.max(${n}, 1), Math.sign(${n}), Math.clz32(${n}), Math.imul(${n}, 3), Math.fround(${n}), Math.trunc(${n}), Math.round(${n})].map(show).join();`,
  }),
  "argument": (x, _, k, d) => ({
    declarations: [`function use${k}(v: Held): string { return show(v) + " " + (v === ${d.members[0]}); }`],
    body: `return use${k}(${x});`,
  }),
  "bound-of-a-loop": (_, n) => ({
    body: `let turns = 0; for (let i = 0; i < ${n} && i < 3; i++) turns++; return turns;`,
  }),
  "collections": (x, _, __, d) => ({
    body: `const both: Held[] = [${d.members[0]}, ${d.members[1]}]; return [new Map<Held, string>([[${d.members[0]}, "a"]]).get(${x}), new Set<Held>([${x}]).has(${d.members[0]}), both.includes(${x}), both.indexOf(${x})].join();`,
  }),
  "JSON": x => ({ body: `return JSON.stringify({ held: ${x}, list: [${x}] });` }),
  "local": (x, _, __, d) => ({
    body: `const local: Held = ${x}; return show(local) + " " + show(${d.asNumber("local")} + 1);`,
  }),
  "list": x => ({ body: `const list: Held[] = [${x}, ${x}]; return list.map(item => show(item)).join();` }),
  "typed-arrays": (_, n) => ({
    body: `return [new Int32Array([${n}])[0], new Float64Array([${n}])[0], new Uint8Array([${n}])[0], new Float32Array([${n}])[0]].map(show).join();`,
  }),
  "instance-field": (x, _, k) => ({
    declarations: [`class Kept${k} { kept: Held; constructor(v: Held) { this.kept = v; } }`],
    body: `return show(new Kept${k}(${x}).kept);`,
  }),
  "sum": (_, n) => ({ body: `let total = 0; for (let i = 0; i < 4; i++) total += ${n}; return show(total);` }),
  "tests-for-whole-numbers": (x, n) => ({
    body: `return [Number.isInteger(${x}), Number.isSafeInteger(${x}), Number.isNaN(${x}), isFinite(${n})].join();`,
  }),
  "positions": (_, n) => ({
    body: `return ["abc".charAt(${n}), "abc".slice(${n}), [1, 2, 3].at(${n}), [1, 2, 3].slice(${n}).join("")].join();`,
  }),
  "BigInt": (_, n) => ({ body: `return String(BigInt(${n}));` }),
  "descriptor": () => ({ body: `return show(Object.getOwnPropertyDescriptor(Shelf, "held")?.value);` }),
  "entries": () => ({ body: `return Object.entries(Shelf).map(([name, value]) => name + "=" + show(value)).join();` }),
  "copy-that-is-incremented": (_, n) => ({ body: `let copy: number = ${n}; copy++; return show(copy);` }),
};

const changes: Record<string, string> = {
  "frozen": `Object.freeze(Shelf);`,
  "sealed": `Object.seal(Shelf);`,
  "closed": `Object.preventExtensions(Shelf);`,
  "made-read-only": `Object.defineProperty(Shelf, "held", { writable: false });`,
  "deleted": `delete (Shelf as any).held;`,
  "made-an-accessor": `{ let kept: unknown = "kept"; Object.defineProperty(Shelf, "held", { get() { return kept; }, set(v) { kept = v; }, configurable: true }); }`,
};

function namesOf(declarations: string[]): { values: string[]; types: string[] } {
  const values: string[] = [];
  const types: string[] = [];
  for (const declaration of declarations) {
    const found = /^(?:abstract class|class|const enum|enum|const|async function|function\*?|type) (\w+)/.exec(
      declaration,
    );
    if (found) (declaration.startsWith("type ") ? types : values).push(found[1]);
  }
  return { values, types };
}

function importFrom(file: string, declarations: string[]): string {
  const { values, types } = namesOf(declarations);
  return `import { ${[...values, ...types.map(name => "type " + name)].join(", ")} } from "./${file}";`;
}

const exported = (declarations: string[]) => declarations.map(declaration => "export " + declaration).join("\n");

function pickFitting<Written>(
  random: Random,
  table: Record<string, unknown>,
  write: (name: string) => Written | undefined,
): [string, Written] {
  for (;;) {
    const name = random.pick(Object.keys(table));
    const written = write(name);
    if (written) return [name, written];
  }
}

export type Generated = { name: string; text: string; files: Record<string, string> };

export function generate(random: Random): string {
  return generateFiles(random, false).text;
}

/** With `isSplit` the class, the reads and the stores stand in three modules. `name` says what was drawn. */
export function generateFiles(random: Random, isSplit: boolean): Generated {
  const typeName = random.pick(Object.keys(declaredTypes));
  const declared = declaredTypes[typeName];
  const holderName = random.pick(Object.keys(holders));
  const holder = holders[holderName];
  const [first, second] = declared.members;
  const picked = [typeName, holderName];

  const members: string[] = [];
  const below: string[] = [];
  const valueDeclarations: string[] = [];
  const storeDeclarations: string[] = [];
  const watched = [...holder.watched];
  let canThrow = false;

  const writeStore = (n: number, isMember: boolean): string => {
    let value: string;
    if (isMember) value = n % 2 ? second : first;
    else {
      const isNumber = random.chance(0.8);
      const valueName = random.pick(Object.keys(isNumber ? numbers : otherValues));
      valueDeclarations.push(
        `const raw${n}: ${isNumber ? "number" : "unknown"} = ${(isNumber ? numbers : otherValues)[valueName]};`,
      );
      const [entryName, typed] = pickFitting(random, entries, name => entries[name](`raw${n}`, n, declared, isNumber));
      valueDeclarations.push(...typed.declarations);
      value = typed.expression;
      picked.push(valueName, entryName);
      if (!isNumber) canThrow = true;
    }
    const [roadName, store] = isMember
      ? ["name", roads["name"](value, n, declared, holder.base)!]
      : pickFitting(random, roads, name => roads[name](value, n, declared, holder.base));
    const placeName = isMember ? "top-level" : random.pick(Object.keys(places));
    const placed = places[placeName](store.run, n, first);
    if (store.members) members.push(store.members);
    below.push(...(store.below ?? []));
    watched.push(...(store.watched ?? []));
    storeDeclarations.push(...(store.declarations ?? []), ...(placed.declarations ?? []));
    if (!isMember) picked.push(roadName, placeName);
    return placed.run;
  };
  const steps: [string, string][] = [
    ["member", writeStore(1, true)],
    ["first", writeStore(2, false)],
    ["second", writeStore(3, false)],
    ["back", writeStore(4, true)],
  ];

  const readerDeclarations: string[] = [];
  const readers: string[] = [];
  const count = random.between(4, 7);
  for (let k = 0; k < count; k++) {
    const readName = k === 0 ? "name" : random.pick(Object.keys(reads));
    const read = reads[readName](k, declared, holder.base);
    const [useName, use] =
      k === 0
        ? ["shown", uses["shown"](read.expression, "", k, declared)!]
        : pickFitting(random, uses, name =>
            uses[name](read.expression, declared.asNumber(read.expression), k, declared),
          );
    if (read.members) members.push(read.members);
    below.push(...(read.below ?? []));
    readerDeclarations.push(
      ...(read.declarations ?? []),
      ...(use.declarations ?? []),
      `function read${k}(): unknown { ${use.body} }`,
    );
    readers.push(`["${readName} ${useName}", read${k}]`);
    if (k) picked.push(readName, useName);
  }
  watched.forEach((expression, k) => {
    readerDeclarations.push(`function watch${k}(): unknown { return show(${expression}); }`);
    readers.push(`["${expression}", watch${k}]`);
  });
  const turns = random.pick([1, 1, 3]);
  readerDeclarations.push(
    `const readers: [string, () => unknown][] = [${readers.join(", ")}];`,
    `function look(label: string) { for (let turn = 0; turn < ${turns}; turn++) for (const [name, read] of readers) { try { console.log(label, name, String(read())); } catch (error) { console.log(label, name, "threw", (error as Error).constructor.name); } } }`,
  );

  const change = random.chance(0.15) ? random.pick(Object.keys(changes)) : undefined;
  if (change) picked.push(change);
  const changedBefore = change ? random.pick(["first", "second", "back"]) : undefined;
  const isGuarded = canThrow || change !== undefined || random.chance(0.5);
  const sequence = [`look("start");`];
  for (const [label, run] of steps) {
    if (label === changedBefore) sequence.push(changes[change!]);
    sequence.push(
      isGuarded
        ? `try { ${run} } catch (error) { console.log("${label}", "threw", (error as Error).constructor.name); }`
        : run,
      `look("${label}");`,
    );
  }

  const basics = [
    ...declared.declarations,
    `type Held = ${declared.type};`,
    `const one: number = Date.now() > 0 ? 1 : 2;`,
    `const chosen: number = Date.now() > 0 ? 1 : 2;`,
    `const key = ("he" + (one === 1 ? "ld" : "")) as "held";`,
    `function show(v: unknown): string { return typeof v + " " + (Object.is(v, -0) ? "-0" : typeof v === "function" ? "function" : String(v)); }`,
  ];
  // The first of the two values can be what the field starts with, where it stands in front of the class.
  const start =
    !isSplit && random.chance(0.15)
      ? /^const raw2: number/.test(valueDeclarations[0])
        ? `raw2 as any`
        : first
      : first;
  const classes = [...holder.declarations(declared.type, start, second, members.join(" ")), ...below];
  const name = picked.join(".");
  if (!isSplit)
    return {
      name,
      text:
        [
          ...basics,
          ...valueDeclarations,
          ...classes,
          ...readerDeclarations,
          ...storeDeclarations,
          ...sequence,
          `export {};`,
        ].join("\n") + "\n",
      files: {},
    };
  const shelf = [...basics, ...classes];
  return {
    name,
    text:
      [
        importFrom("shelf", shelf),
        `import { look } from "./readers";`,
        ...valueDeclarations,
        ...storeDeclarations,
        ...sequence,
      ].join("\n") + "\n",
    files: {
      "shelf.ts": exported(shelf) + "\n",
      "readers.ts":
        [importFrom("shelf", shelf), ...readerDeclarations.slice(0, -1), "export " + readerDeclarations.at(-1)].join(
          "\n",
        ) + "\n",
    },
  };
}
