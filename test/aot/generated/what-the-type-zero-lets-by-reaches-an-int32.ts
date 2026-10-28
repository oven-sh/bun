// Programs in which a number that is no `int32` stands where TypeScript writes the type `0`, and goes on into a place that is declared `int32`. TypeScript gives `-0` the type `0`, narrows
// a `number` to `0` behind `n === 0`, which `-0` passes, and types `n && 1` as `0 | 1`, which `NaN` comes through. A program is one way to come by such a value and one such place.
type Use = (value: string) => string;
type Source = { name: string; top?: string; files?: Record<string, string>; body: (use: Use) => string };
type Sink = { name: string; top?: string; use: Use };

const notTaken = 'return "not taken";';

// `n` is a number that the build knows nothing of. `use` gives the statements that hand the value on, and they return.
export const sources: Source[] = [
  { name: "aConstantWrittenMinusZero", top: "const negative = -0;", body: use => use("negative") },
  { name: "aConstantOfTheWrittenType", top: "const written: 0 = -0;", body: use => use("written") },
  { name: "aConstantThatSatisfiesTheType", top: "const checked = -0 satisfies 0;", body: use => use("checked") },
  {
    name: "aConstantOfAnotherFile",
    top: 'import { exported } from "./constants";',
    files: { "constants.ts": "export const exported = -0;\n" },
    body: use => use("exported"),
  },
  {
    name: "aMemberOfAnObjectOfAnotherFile",
    top: 'import { limits } from "./constants";',
    files: { "constants.ts": "export const limits = { least: -0, most: 1 } as const;\n" },
    body: use => use("limits.least"),
  },
  {
    name: "aVariableOfTheModule",
    top: "let state: 0 | 1 = 1;",
    body: use => `if (n !== 0) ${notTaken} state = n; ${use("state")}`,
  },
  {
    name: "aVariableThatALoopCarries",
    body: use => `let z: 0 | 1 = 1; for (let i = 0; i < 3; i++) if (n === 0 && i > 0) z = n; ${use("z")}`,
  },
  {
    name: "aVariableThatAClosureStores",
    body: use => `let z: 0 | 1 = 1; const put = (value: 0 | 1) => { z = value; }; if (n === 0) put(n); ${use("z")}`,
  },
  {
    name: "whatAGeneratorYields",
    top: "function* zeros(value: 0 | 1): Generator<0 | 1> { yield value; yield value; }",
    body: use => `if (n !== 0) ${notTaken} for (const z of zeros(n)) { ${use("z")} } ${notTaken}`,
  },
  { name: "aVariableOfTheWrittenType", body: use => `let z: 0 = 0; if (Object.is(n, -0)) z = -0; ${use("z")}` },
  { name: "behindIsZero", body: use => `if (n === 0) { ${use("n")} } ${notTaken}` },
  { name: "behindIsNotZero", body: use => `if (n !== 0) ${notTaken} ${use("n")}` },
  { name: "behindZeroIs", body: use => `if (0 === n) { ${use("n")} } ${notTaken}` },
  { name: "behindLooselyZero", body: use => `if (n == 0) { ${use("n")} } ${notTaken}` },
  { name: "inACase", body: use => `switch (n) { case 0: { ${use("n")} } } ${notTaken}` },
  { name: "leftOfAnd", body: use => `const z = n && 1; ${use("z")}` },
  { name: "eitherOfTwoConstants", body: use => `const z = Object.is(n, -0) ? -0 : 1; ${use("z")}` },
  {
    name: "aGenericGivenItsType",
    top: "function same<T>(value: T): T { return value; }",
    body: use => `if (n !== 0) ${notTaken} ${use("same<0>(n)")}`,
  },
  {
    name: "aGenericBelowZeroOrOne",
    top: "function pick<T extends 0 | 1>(value: T): T { return value; }",
    body: use => `if (n !== 0) ${notTaken} ${use("pick(n)")}`,
  },
  {
    name: "aFieldOfALiteral",
    top: "const holder: { digit: 0 | 1 | 2 } = { digit: 1 };",
    body: use => `if (n !== 0) ${notTaken} holder.digit = n; ${use("holder.digit")}`,
  },
  {
    name: "aFieldOfAClass",
    top: "class Holder { digit: 0 | 1 = 1; }\nconst holder = new Holder();",
    body: use => `if (n !== 0) ${notTaken} holder.digit = n; ${use("holder.digit")}`,
  },
  {
    name: "aParameterProperty",
    top: "class Holder { constructor(readonly digit: 0 | 1) {} }",
    body: use => `if (n !== 0) ${notTaken} ${use("new Holder(n).digit")}`,
  },
  { name: "aStaticConstant", top: "class Named { static readonly zero = -0; }", body: use => use("Named.zero") },
  {
    name: "aGetter",
    top: "class Holder { get zero(): 0 { return -0; } }\nconst holder = new Holder();",
    body: use => use("holder.zero"),
  },
  {
    name: "aMemberOfAConstantObject",
    top: "const table = { zero: -0, one: 1 } as const;",
    body: use => use("table.zero"),
  },
  { name: "anElementOfAConstantList", top: "const pair = [-0, 1] as const;", body: use => use("pair[0]") },
  {
    name: "anElementOfAList",
    top: "const digits: (0 | 1)[] = [1];",
    body: use => `if (n !== 0) ${notTaken} digits[0] = n; ${use("digits[0]")}`,
  },
  {
    name: "anElementOfATuple",
    top: "const couple: [0 | 1, 0 | 1] = [1, 1];",
    body: use => `if (n !== 0) ${notTaken} couple[1] = n; ${use("couple[1]")}`,
  },
  {
    name: "aPattern",
    top: "const holder: { digit: 0 | 1 } = { digit: 1 };",
    body: use => `if (n !== 0) ${notTaken} holder.digit = n; const { digit } = holder; ${use("digit")}`,
  },
  {
    name: "aValueOfAMap",
    top: "const map = new Map<string, 0 | 1>();",
    body: use => `if (n !== 0) ${notTaken} map.set("k", n); ${use('map.get("k")!')}`,
  },
  {
    name: "aMemberOfARecord",
    top: 'const record: Record<"a" | "b", 0 | 1> = { a: 1, b: 1 };',
    body: use => `if (n !== 0) ${notTaken} record.a = n; ${use("record.a")}`,
  },
  {
    name: "aResult",
    top: "function zero(negative: boolean): 0 { return negative ? -0 : 0; }",
    body: use => use("zero(Object.is(n, -0))"),
  },
  { name: "aDefault", body: use => `const inner = (z: 0 = -0): string => { ${use("z")} }; return inner();` },
  {
    name: "aParameterOfTheType",
    body: use => `const inner = (z: 0 | 1): string => { ${use("z")} }; if (n !== 0) ${notTaken} return inner(n);`,
  },
  {
    name: "aPredicate",
    top: "function isZero(value: number): value is 0 { return value === 0; }",
    body: use => `if (!isZero(n)) ${notTaken} ${use("n")}`,
  },
  {
    name: "aFunctionThatAsserts",
    top: 'function mustBeZero(value: number): asserts value is 0 { if (value !== 0) throw new RangeError("not zero"); }',
    body: use => `if (n !== n || n > 0 || n < 0) ${notTaken} mustBeZero(n); ${use("n")}`,
  },
  {
    name: "zeroOrUndefined",
    body: use =>
      `let maybe: 0 | undefined; if (n === 0) maybe = n; if (maybe === undefined) ${notTaken} ${use("maybe")}`,
  },
  { name: "aProduct", body: use => `const product = (n | 0) * -1; if (product !== 0) ${notTaken} ${use("product")}` },
  { name: "aNegation", body: use => `const minus = -n; if (minus !== 0) ${notTaken} ${use("minus")}` },
  {
    name: "aRoundedFraction",
    body: use => `const rounded = Math.ceil(n - 0.5); if (rounded !== 0) ${notTaken} ${use("rounded")}`,
  },
  { name: "aRemainder", body: use => `const rest = (n - 4) % 4; if (rest !== 0) ${notTaken} ${use("rest")}` },
  {
    name: "aParsedText",
    body: use =>
      `const parsed = Number(Object.is(n, -0) ? "-0" : String(n)); if (parsed !== 0) ${notTaken} ${use("parsed")}`,
  },
  {
    name: "anElementOfAFloatArray",
    top: "const floats = new Float64Array(1);",
    body: use => `floats[0] = n; const element = floats[0]; if (element !== 0) ${notTaken} ${use("element")}`,
  },
  {
    name: "parsedDataOfAWrittenType",
    top: "const parsed: { digit: 0 | 1 } = JSON.parse('{\"digit\":-0}');",
    body: use => use("parsed.digit"),
  },
  // These let every number by.
  { name: "anAssertion", body: use => use("(n as 0)") },
  { name: "anythingUnderTheType", body: use => `const anything: any = n; const z: 0 = anything; ${use("z")}` },
  {
    name: "aMemberOfAnEnumeration",
    top: "enum Color { Red, Green, Blue }",
    body: use => `const color: Color = n; ${use("color")}`,
  },
];

// What a program can tell one number from another by, asked of the place itself.
const observed = (v: string) =>
  `[${[
    `1 / ${v}`,
    `Object.is(${v}, -0)`,
    `Object.is(${v}, 0)`,
    `sign(${v})`,
    `Bun.inspect(${v})`,
    `JSON.stringify([${v}])`,
    `\`\${${v}}\``,
    `1 / Math.sign(${v})`,
    `Math.atan2(${v}, -1)`,
    `1 / (${v} + ${v})`,
    `1 / (${v} - 0)`,
    `1 / (${v} * 5)`,
    `1 / (${v} * -1)`,
    `1 / (${v} / 2)`,
    `1 / (${v} % 3)`,
    `1 / -${v}`,
    `${v} ** -1`,
    `1 / Math.min(${v}, 0)`,
    `1 / Math.max(${v}, -1)`,
    `1 / Math.floor(${v})`,
    `1 / Math.round(${v})`,
    `1 / Math.trunc(${v})`,
    `1 / Math.abs(${v})`,
    `1 / Math.sqrt(${v})`,
    `1 / Math.fround(${v})`,
    `${v} | 0`,
    `${v} >>> 0`,
    `${v} === 0`,
    `${v} !== ${v}`,
    `${v} < 1`,
    `Number.isInteger(${v})`,
    `[${v}].indexOf(0)`,
    `[${v}].includes(${v})`,
    `new Set([${v}, 0]).size`,
  ].join(", ")}].join(" ")`;

const box = `class Box { count: int32; constructor(count: int32) { this.count = count; } }\nfunction read(from: Box): string { return ${observed("from.count")}; }`;
const computed = (name: string, text: (value: string) => string): Sink => ({
  name,
  use: value => `const local: int32 = ${text(value)}; return ${observed("local")};`,
});

export const sinks: Sink[] = [
  { name: "noPlaceAtAll", use: value => `return ${observed(value)};` },
  {
    name: "aParameter",
    top: `function take(v: int32): string { return ${observed("v")}; }`,
    use: value => `return take(${value});`,
  },
  {
    name: "aParameterOfAMethod",
    top: `class Taker { take(v: int32): string { return ${observed("v")}; } }\nconst taker = new Taker();`,
    use: value => `return taker.take(${value});`,
  },
  {
    name: "aParameterOfAnArrow",
    top: `const take = (v: int32): string => ${observed("v")};`,
    use: value => `return take(${value});`,
  },
  {
    name: "aParameterOfAFunctionThatCallsItself",
    top: `function take(v: int32, depth: int32): string { return depth > 0 ? take(v, (depth - 1) | 0) : ${observed("v")}; }`,
    use: value => `return take(${value}, 3);`,
  },
  {
    name: "aParameterOfOneOfTwoMethods",
    top: `interface Takes { take(v: int32): string }\nclass First implements Takes { take(v: int32): string { return ${observed("v")}; } }\nclass Second implements Takes { take(v: int32): string { return "second " + ${observed("v")}; } }\nconst takers: Takes[] = [new First(), new Second()];`,
    use: value => `return takers[given.length & 1].take(${value}) + takers[0].take(${value});`,
  },
  {
    name: "aParameterOfAGenerator",
    top: `function* walk(v: int32): Generator<string> { yield ${observed("v")}; }`,
    use: value => `return [...walk(${value})][0];`,
  },
  {
    name: "aParameterOfACallback",
    top: `function take(v: int32): string { return ${observed("v")}; }`,
    use: value => `return [${value}].map(v => take(v))[0];`,
  },
  {
    name: "theDefaultOfAParameter",
    use: value => `const take = (v: int32 = ${value}): string => ${observed("v")}; return take();`,
  },
  {
    name: "aResult",
    use: value => `const give = (): int32 => ${value}; const got = give(); return ${observed("got")};`,
  },
  {
    name: "aResultHandedOn",
    top: "function handBack(v: int32): int32 { return v; }\nfunction relay(v: int32): int32 { return handBack(v); }",
    use: value => `const got = relay(${value}); return ${observed("got")};`,
  },
  {
    name: "aResultOfAParameterOfALiteralType",
    top: "function through(v: 0 | 1 | 2): int32 { return v; }",
    use: value => `const got = through(${value}); return ${observed("got")};`,
  },
  { name: "aConstant", use: value => `const local: int32 = ${value}; return ${observed("local")};` },
  {
    name: "aVariable",
    use: value => `let local: int32 = 1; if (given.length) local = ${value}; return ${observed("local")};`,
  },
  {
    name: "eitherArm",
    use: value => `const local: int32 = given.length > 2 ? ${value} : 7; return ${observed("local")};`,
  },
  {
    name: "aVariableOfTheModule",
    top: `let kept: int32 = 1;\nfunction read(): string { return ${observed("kept")}; }`,
    use: value => `kept = ${value}; return read();`,
  },
  {
    name: "aCapturedVariable",
    use: value =>
      `let captured: int32 = 1; const store = () => { captured = ${value}; }; store(); return ${observed("captured")};`,
  },
  {
    name: "aField",
    top: `${box}\nconst kept = new Box(1);`,
    use: value => `kept.count = ${value}; return read(kept);`,
  },
  { name: "aFieldOfANewObject", top: box, use: value => `return read(new Box(${value}));` },
  {
    name: "aFieldOfOneOfManyObjects",
    top: box,
    use: value =>
      `const boxes: Box[] = []; for (let i = 0; i < 50; i++) boxes.push(new Box(i === 25 ? ${value} : 7)); return read(boxes[25]) + " " + boxes.reduce((sum, each) => sum + 1 / each.count, 0);`,
  },
  {
    name: "aParameterProperty",
    top: `class Box { constructor(public count: int32) {} }\nfunction read(from: Box): string { return ${observed("from.count")}; }`,
    use: value => `return read(new Box(${value}));`,
  },
  {
    name: "theInitializerOfAField",
    use: value =>
      `class Local { count: int32 = ${value}; } const made = new Local(); return ${observed("made.count")};`,
  },
  {
    name: "aPrivateField",
    top: `class Box { #count: int32 = 1; store(v: int32) { this.#count = v; } read(): string { return ${observed("this.#count")}; } }\nconst kept = new Box();`,
    use: value => `kept.store(${value}); return kept.read();`,
  },
  {
    name: "aStaticField",
    top: `class Box { static count: int32 = 1; }\nfunction read(): string { return ${observed("Box.count")}; }`,
    use: value => `Box.count = ${value}; return read();`,
  },
  {
    name: "aSetter",
    top: `class Box { held: int32 = 1; set count(v: int32) { this.held = v; } get count(): int32 { return this.held; } }\nconst kept = new Box();`,
    use: value => `kept.count = ${value}; return ${observed("kept.count")};`,
  },
  {
    name: "aMemberOfALiteral",
    top: `type Counted = { count: int32 };\nfunction read(from: Counted): string { return ${observed("from.count")}; }`,
    use: value => `const literal: Counted = { count: ${value} }; return read(literal);`,
  },
  {
    name: "aMemberOfASpreadLiteral",
    top: `type Counted = { count: int32 };\nfunction read(from: Counted): string { return ${observed("from.count")}; }`,
    use: value => `const literal: Counted = { ...{ count: ${value} } }; return read(literal);`,
  },
  {
    name: "anOptionalMember",
    top: `type Counted = { count?: int32 };\nfunction read(from: Counted): string { return from.count === undefined ? "none" : ${observed("from.count")}; }`,
    use: value => `const literal: Counted = { count: ${value} }; return read(literal) + read({});`,
  },
  {
    name: "theDefaultOfAPattern",
    use: value => `const { count = ${value} }: { count?: int32 } = {}; return ${observed("count")};`,
  },
  {
    name: "anElementOfAList",
    use: value =>
      `const list: int32[] = [1, ${value}]; list.push(${value}); return ${observed("list[1]")} + ${observed("list[2]")};`,
  },
  {
    name: "anElementOfATuple",
    use: value => `const tuple: [int32, int32] = [1, ${value}]; return ${observed("tuple[1]")};`,
  },
  computed("aSum", value => `${value} + ${value}`),
  computed("aDifference", value => `${value} - 0`),
  computed("aProduct", value => `${value} * 5`),
  computed("aSquare", value => `${value} * ${value}`),
  computed("aRemainder", value => `${value} % 3`),
  computed("thePlusOfIt", value => `+${value}`),
  computed("theLeast", value => `Math.min(${value}, 5)`),
  computed("theGreatest", value => `Math.max(${value}, -5)`),
  computed("theSign", value => `Math.sign(${value})`),
  computed("theDistance", value => `Math.abs(${value})`),
  computed("aFlooredQuotient", value => `Math.floor(${value} / 2)`),
  computed("aTruncatedQuotient", value => `Math.trunc(${value} / 3)`),
  computed("aRoundedQuotient", value => `Math.round(${value} / 4)`),
  computed("aQuotientRoundedUp", value => `Math.ceil(${value} / 3)`),
];

export const program = (source: Source, sink: Sink) => ({
  file: "main.ts",
  files: source.files,
  text: `import type { int32 } from "bun";
const given: number[] = JSON.parse("[0, -0, 1, 2, -1, 1.5, 2147483648]");
given.push(Number("nothing"));
const float = new Float64Array(1);
const words = new Uint32Array(float.buffer);
function sign(value: number): string { float[0] = value; return value !== value ? "none" : words[1] >>> 31 ? "minus" : "plus"; }
${[source.top, sink.top].filter(Boolean).join("\n")}
function run(n: number): string { ${source.body(sink.use)} }
for (const n of given) console.log(Bun.inspect(n), run(n));
let last = "";
for (let round = 0; round < 2000; round++) last = run(given[round & 1 ? 0 : 2]);
console.log(last);
for (const n of given) console.log(Bun.inspect(n), run(n));
`,
});
