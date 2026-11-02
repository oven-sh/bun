// Functions created from text at run time read, store, test for and delete the properties of objects that compiled TypeScript created, whatever a field holds, and get the answers an ordinary object gives.
class Point { constructor(public x: number, public y: number) {} }
type Mode = "idle" | "busy" | "done";
enum Level { Low, Middle, High }
class Item {
  small: number = 7; wide: number = 2147483647; big: number = 9007199254740991; ratio: number = 0.5; count: number = 1;
  maybeNumber: number | undefined = undefined; nullableNumber: number | null = null;
  flag: boolean = true; maybeFlag: boolean | undefined = undefined;
  text: string = "text"; mode: Mode = "idle"; level: Level = Level.Middle;
  child: Point = new Point(1, 2); maybeChild: Point | null = null; list: number[] = [1, 2, 3];
  anything: unknown = "any"; huge: bigint = 12345678901234567890n; key: symbol = Symbol.for("key");
  handler = () => this.small; plain = function () { return 1; };
  method(): number { return this.small + 1; }
  get doubled(): number { return this.small * 2; }
  set doubled(value: number) { this.small = value / 2; }
}
interface Options { name: string; size?: number; nested?: { deep: number }; on?: boolean }
const makeOptions = (): Options => ({ name: "options" });

type Step = (o: any) => unknown;
type Store = (o: any, value: unknown) => unknown;
type Operation = string | Step;
type FieldCase = { createFittingValues: () => unknown[]; misfits: unknown[] };

const fromFunction = (parameters: string, body: string): any => new Function(...parameters.split(","), body);
const fromEval = (parameters: string, body: string): any => (0, eval)("(function (" + parameters + ") { " + body + " })");
const createNamedFunctions = (field: string) => ({
  readNamed: fromFunction("o", "return o." + field + ";"),
  storeNamed: fromFunction("o,v", "o." + field + " = v; return o." + field + ";"),
  storeStrict: fromFunction("o,v", "'use strict'; o." + field + " = v; return o." + field + ";"),
  hasNamed: fromFunction("o", "return '" + field + "' in o;"),
  deleteNamed: fromFunction("o", "return delete o." + field + ";"),
});
const readKeyed = fromEval("o,k", "return o[k];");
const storeKeyed = fromEval("o,k,v", "o[k] = v; return o[k];");
const hasKeyed = fromEval("o,k", "return k in o;");
const ownKeyed = fromEval("o,k", "return Object.prototype.hasOwnProperty.call(o, k);");
const deleteKeyed = fromEval("o,k", "return delete o[k];");
const inspect = fromEval("o,show", "return Reflect.ownKeys(o).map(function (k) { return String(k) + '=' + show(o[k]); }).join(' ');");
const makeOrdinaryCopy = fromEval("source", "var copy = Object.create(Object.getPrototypeOf(source)); Reflect.ownKeys(source).forEach(function (k) { copy[k] = source[k]; }); return copy;");

const lines: string[] = [];
let steps = 0;
let differences = 0;
let item: any;
let ordinaryCopy: any;

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(",") + "]";
  const object = value as Record<string, unknown>;
  return "{" + Object.keys(object).map(key => key + ":" + show(object[key])).join(",") + "}";
}

function attempt(run: () => string): string {
  try {
    return run();
  } catch (error) {
    return "throws " + (error as Error).constructor.name;
  }
}
const outcome = (run: () => unknown): string => attempt(() => show(run()));

function reportDifference(text: string): void {
  differences++;
  lines.push("  DIFFERS " + text);
}

function checkEqual(label: string, a: string, b: string): boolean {
  if (a === b) return true;
  reportDifference(label + ": " + a + " | " + b);
  return false;
}

function createPair(typed: object = new Item()): void {
  item = typed;
  ordinaryCopy = makeOrdinaryCopy(typed);
}

function warmUp(step: Step): void {
  for (let turn = 0; turn < 4; turn++) step(new Item());
}

function both(label: string, step: Step): string {
  const a = outcome(() => step(item)), b = outcome(() => step(ordinaryCopy));
  steps++;
  if (checkEqual(label, a, b)) checkEqual(label + ", inspect", attempt(() => inspect(item, show)), attempt(() => inspect(ordinaryCopy, show)));
  return b;
}

const compiledArrow = () => 5;
const markerLikeNaNs = new Float64Array(new BigUint64Array([0x7ffa000000000000n, 0x7ffb000000000000n, 0x7ffc000000000000n, 0xfff8000000000001n]).buffer);
const numbers: unknown[] = [
  0, -0, 1, -1, 0.5, NaN, Infinity, -Infinity, 255, 256, 65535, 65536, 2147483647, 2147483648,
  -2147483648, -2147483647, -2147483646, -2147483645, -2147483644, -2147483643,
  4294967295, 4294967296, 9007199254740991, 5e-324, 1e300, null, undefined, ...markerLikeNaNs,
];
const numberField: FieldCase = { createFittingValues: () => numbers, misfits: ["string"] };
const booleanField: FieldCase = { createFittingValues: () => [true, false, null, undefined], misfits: [1] };
const pointField: FieldCase = { createFittingValues: () => [new Point(3, 4), fromFunction("", "return { x: 5, y: 6 };")(), null, undefined], misfits: [7] };
const functionField: FieldCase = { createFittingValues: () => [compiledArrow, fromFunction("", "return 6;"), null, undefined], misfits: [3] };
const fieldCases: Record<string, FieldCase> = {
  small: numberField, wide: numberField, big: numberField, ratio: numberField, count: numberField,
  maybeNumber: numberField, nullableNumber: numberField,
  flag: booleanField, maybeFlag: booleanField,
  text: { createFittingValues: () => ["", "a", "idle", "left" + String(steps), "é€", null, undefined], misfits: [5] },
  mode: { createFittingValues: () => ["busy", "done", "idle", null, undefined], misfits: ["other"] },
  level: { createFittingValues: () => [0, 2, 1, null, undefined], misfits: ["Low"] },
  child: pointField, maybeChild: pointField,
  list: { createFittingValues: () => [[], [1.5, -0], fromFunction("", "return [4, 5];")(), null, undefined], misfits: ["no list"] },
  anything: { createFittingValues: () => [1, 1.5, "s", true, null, undefined, {}, [], 1n, Symbol.for("a"), compiledArrow], misfits: [] },
  huge: { createFittingValues: () => [0n, -1n, 2n ** 64n, null, undefined], misfits: [1] },
  key: { createFittingValues: () => [Symbol.for("other"), Symbol.iterator, null, undefined], misfits: ["k"] },
  handler: functionField, plain: functionField,
};
const fields = Object.keys(fieldCases);
const namedFunctions: Record<string, ReturnType<typeof createNamedFunctions>> = {};
for (const field of fields) namedFunctions[field] = createNamedFunctions(field);

function snapshot(o: Item): string {
  return [
    o.small, o.wide, o.big, o.ratio, o.count, o.maybeNumber, o.nullableNumber, o.flag, o.maybeFlag, o.text, o.mode, o.level,
    o.child, o.maybeChild, o.list, o.anything, o.huge, o.key, o.handler, o.plain,
    o.child?.x, o.maybeChild?.y, o.list?.length, o.text?.length, o.method(), o.doubled,
    typeof o.handler === "function" ? o.handler() : "none",
    typeof o.plain === "function" ? o.plain() : "none",
  ].map(show).join(" ");
}

function checkSnapshot(label: string): void {
  try {
    checkEqual(label + ", snapshot", snapshot(item), snapshot(ordinaryCopy as Item));
  } catch (error) {
    reportDifference(label + ", snapshot throws " + (error as Error).constructor.name);
  }
}

function storeInitial(o: Item, field: string): void {
  switch (field) {
    case "small": o.small = 7; break;
    case "wide": o.wide = 2147483647; break;
    case "big": o.big = 9007199254740991; break;
    case "ratio": o.ratio = 0.5; break;
    case "count": o.count = 1; break;
    case "maybeNumber": o.maybeNumber = undefined; break;
    case "nullableNumber": o.nullableNumber = null; break;
    case "flag": o.flag = true; break;
    case "maybeFlag": o.maybeFlag = undefined; break;
    case "text": o.text = "text"; break;
    case "mode": o.mode = "idle"; break;
    case "level": o.level = Level.Middle; break;
    case "child": o.child = new Point(1, 2); break;
    case "maybeChild": o.maybeChild = null; break;
    case "list": o.list = [1, 2, 3]; break;
    case "anything": o.anything = "any"; break;
    case "huge": o.huge = 12345678901234567890n; break;
    case "key": o.key = Symbol.for("key"); break;
    case "handler": o.handler = () => o.small; break;
    case "plain": o.plain = function () { return 1; }; break;
  }
}

function checkDeleteAndAdd(field: string, label: string, remove: Step, store: Store): void {
  const { readNamed, hasNamed } = namedFunctions[field];
  createPair();
  const initial = item[field];
  both(label, remove);
  both(label + ", hasNamed", hasNamed);
  both(label + ", ownKeyed", o => ownKeyed(o, field));
  both(label + ", readNamed", readNamed);
  checkSnapshot(label);
  both(label + " again", remove);
  both(label + ", add again", o => store(o, initial));
  checkEqual(label + ", keys", Object.keys(item).join(), Object.keys(ordinaryCopy).join());
  checkSnapshot(label + ", add again");
}

function checkField(field: string): void {
  const firstStep = steps;
  const { createFittingValues, misfits } = fieldCases[field];
  const { readNamed, storeNamed, storeStrict, hasNamed, deleteNamed } = namedFunctions[field];
  const readByKey: Step = o => readKeyed(o, field);
  const storeByKey: Store = (o, value) => storeKeyed(o, field, value);
  const stores: [string, Store][] = [["storeNamed", storeNamed], ["storeStrict", storeStrict], ["storeKeyed", storeByKey]];
  const warmUpSteps: Step[] = [readNamed, hasNamed, deleteNamed, o => storeNamed(o, o[field]), o => storeStrict(o, o[field])];
  warmUpSteps.forEach(warmUp);

  createPair();
  const initial = item[field];
  both(field + " readNamed", readNamed);
  both(field + " readKeyed", readByKey);
  both(field + " hasNamed", hasNamed);
  both(field + " hasKeyed", o => hasKeyed(o, field));
  both(field + " ownKeyed", o => ownKeyed(o, field));

  for (const [name, store] of stores) {
    createFittingValues().forEach((value, index) => {
      const label = field + " " + name + " of value " + index;
      both(label, o => store(o, value));
      both(label + ", readNamed", readNamed);
      both(label + ", readKeyed", readByKey);
      checkSnapshot(label);
    });
  }

  storeInitial(item, field);
  storeInitial(ordinaryCopy, field);
  both(field + " readNamed after a compiled store", readNamed);

  for (const misfit of misfits) {
    const label = field + " misfit";
    both(label + ", storeNamed", o => storeNamed(o, misfit));
    both(label + ", readNamed", readNamed);
    both(label + ", readKeyed", readByKey);
    both(label + ", hasNamed", hasNamed);
    both(label + ", storeNamed of the initial value", o => storeNamed(o, initial));
    checkSnapshot(label);
  }

  checkDeleteAndAdd(field, field + " deleteNamed", deleteNamed, storeNamed);
  checkDeleteAndAdd(field, field + " deleteKeyed", o => deleteKeyed(o, field), storeByKey);
  lines.push(field + ": " + (steps - firstStep) + " steps, ends as " + show(readNamed(item)));
}

function createTextStep(body: string): Step {
  const run = fromFunction("o,show", body);
  const step: Step = o => run(o, show);
  warmUp(step);
  return step;
}

function checkOperations(label: string, operations: Operation[], typed: object = new Item()): void {
  createPair(typed);
  const answers = operations.map((operation, index) =>
    typeof operation === "string" ? both(label + ": " + operation, createTextStep(operation)) : both(label + ": operation " + index, operation),
  );
  lines.push(label + ": " + answers.join(" "));
}

function viaDirectEval(local: Item) {
  const before = eval("local.small + local.count");
  eval("local.small = 8; local.ratio = 2.5; delete local.maybeNumber");
  return [before, local.small, local.ratio, local.maybeNumber, eval("'maybeNumber' in local")];
}

const createIntegrityCase = (label: string, body: string): [string, Operation[]] => [label, [
  body,
  o => namedFunctions.small.storeNamed(o, 8),
  o => namedFunctions.small.storeStrict(o, 9),
  (o: Item) => (o.small = 10),
  "o.added = 1; return o.added;",
  "'use strict'; o.added = 1; return o.added;",
  (o: any) => (o.added = 1),
  namedFunctions.count.deleteNamed,
  "'use strict'; return delete o.ratio;",
  (o: Item) => delete o.maybeNumber,
  "return [Object.isFrozen(o), Object.isSealed(o), Object.isExtensible(o)];",
  (o: Item) => [Object.isFrozen(o), Object.isSealed(o), Object.isExtensible(o)],
]];

const casesWithSnapshot: [string, Operation[]][] = [
  ["extra properties", [
    'for (var i = 0; i < 20; i++) o["extra" + i] = i; o[0] = "zero"; o["1"] = "one"; o[Symbol.for("extra")] = "symbol"; return Object.keys(o).join();',
    "return [o.extra0, o.extra7, o.extra19];",
    o => ["extra7", 0, "1", Symbol.for("extra")].map(key => readKeyed(o, key)),
    "return delete o.extra3;",
    "return Object.keys(o).join();",
  ]],
  ["accessor in place of a field", [
    'Object.defineProperty(o, "small", { get: function () { return 99; }, configurable: true, enumerable: true });',
    (o: Item) => o.small,
    (o: Item) => o.method(),
  ]],
  ["read-only field", [
    'Object.defineProperty(o, "small", { value: 5, writable: false });',
    o => namedFunctions.small.storeNamed(o, 6),
    o => namedFunctions.small.storeStrict(o, 6),
    (o: Item) => (o.small = 6),
  ]],
  createIntegrityCase("freeze", "Object.freeze(o);"),
  createIntegrityCase("seal", "Object.seal(o);"),
  createIntegrityCase("preventExtensions", "Object.preventExtensions(o);"),
  ["becomes a prototype", [
    "return Object.create(o).small;",
    "var derived = Object.create(o); derived.small = 42; return [derived.small, o.small, Object.keys(derived).join()];",
    "var derived = Object.create(o); derived.doubled = 10; return [derived.small, o.small, derived.method()];",
  ]],
  ["method shadowed by an own property", [
    "o.method = function () { return -2; }; return o.method();",
    (o: Item) => o.method(),
    "return delete o.method;",
    (o: Item) => o.method(),
  ]],
  ["copies", [
    "Object.assign(o, { small: 1, extra: 2 });",
    "return show(Object.assign({}, o));",
    "return show({ ...o });",
    "return Object.entries(o).length;",
    "var seen = []; for (var k in o) seen.push(k); return seen.join();",
    'return JSON.stringify(o, function (k, v) { return typeof v === "bigint" || typeof v === "symbol" ? String(v) : v; });',
  ]],
  ["accessors and methods", ["return o.doubled;", "o.doubled = 10; return o.small;", "return o.method() + o.plain();"]],
  ["with", ["with (o) { return small + count; }", "with (o) { small = 3; } return o.small;"]],
  ["direct eval", [viaDirectEval]],
];

const sharedWarmUpSteps: Step[] = [
  o => readKeyed(o, "small"),
  o => storeKeyed(o, "small", 7),
  o => hasKeyed(o, "small"),
  o => ownKeyed(o, "small"),
  o => deleteKeyed(o, "small"),
  o => inspect(o, show),
  makeOrdinaryCopy,
];
sharedWarmUpSteps.forEach(warmUp);
fields.forEach(checkField);

for (const [label, operations] of casesWithSnapshot) {
  checkOperations(label, operations);
  checkSnapshot(label);
}
checkOperations("another prototype", [
  "Object.setPrototypeOf(o, { method: function () { return -1; } });",
  (o: Item) => o.method(),
  (o: Item) => "doubled" in o,
]);

const closureSteps: Step[] = [
  createTextStep("return o.handler() === o.small;"),
  createTextStep("var h = o.handler; return h() === o.small;"),
  createTextStep("return o.handler === o.handler;"),
  createTextStep("return ({ ...o }).handler === o.handler;"),
  (o: Item) => namedFunctions.handler.readNamed(o) === o.handler,
  (o: Item) => o.handler === namedFunctions.handler.readNamed(o),
];
lines.push("closure in a field: " + closureSteps.map(step => outcome(() => step(new Item()))).join(" "));

const optionalMembers: [string, unknown][] = [["size", 3], ["nested", { deep: 1 }], ["on", true]];
const [size, nested, on] = optionalMembers;
const createMemberStore = ([key, value]: [string, unknown]): Step => o => storeKeyed(o, key, value);
const readOptions = (o: Options) => [o.size, o.nested?.deep, o.on];
checkOperations(
  "typed literal with absent fields",
  [
    ...optionalMembers.flatMap(([key]): Step[] => [o => hasKeyed(o, key), o => readKeyed(o, key)]),
    ...optionalMembers.map(createMemberStore),
    readOptions,
    ...optionalMembers.map(([key]): Step => o => deleteKeyed(o, key)),
    readOptions,
    ...[on, size, nested].map(createMemberStore),
    o => inspect(o, show),
    readOptions,
  ],
  makeOptions(),
);

createPair();
const callees = [item.handler, item.plain, item.method, Item.prototype.method, compiledArrow, fromFunction("", "return 6;")];
const callEach = fromFunction("callees,o", "var out = []; for (var turn = 0; turn < 50; turn++) for (var i = 0; i < callees.length; i++) out.push(callees[i].call(o)); return out.length + ':' + out.slice(-callees.length).join();");
const callEveryCallee: Step = o => callEach(callees, o);
warmUp(callEveryCallee);
lines.push("one call site, many callees: " + both("one call site, many callees", callEveryCallee));

const objects: any[] = [];
for (let index = 0; index < 50; index++) {
  const typed = new Item();
  typed.small = index;
  typed.ratio = index / 4;
  typed.child = new Point(index, -index);
  if (index % 3 === 0) {
    namedFunctions.wide.deleteNamed(typed);
    namedFunctions.wide.storeNamed(typed, 2147483647);
  }
  objects.push(index % 7 === 0 ? makeOrdinaryCopy(typed) : typed);
}
let sum = 0;
let last: any[] = [];
for (const object of objects) {
  last = [namedFunctions.small.readNamed(object), namedFunctions.ratio.readNamed(object), namedFunctions.child.readNamed(object)];
  sum += last[0] + last[1] + last[2].x;
}
lines.push("many objects at one site: " + sum + " " + show(last));

lines.push(steps + " steps", differences === 0 ? "every answer agrees" : differences + " answers differ");
console.log(lines.join("\n"));

export {};
