// A function that makes an object or a list only to return it. A caller that reads the parts and drops the whole need not get a whole: the parts can come back by themselves.
// A caller that keeps it, compares it, changes it, lists its keys or hands it on needs the very object, each call another one, with all that the function did to it.
// What is returned x what the caller does with it x how the function is written, each in many places.
import { inEveryPlace, type Stretch } from "./where-a-stretch-stands";

type Result = { type: string; beside?: string; returns: (a: string, b: string) => string; first: (r: string) => string; second: (r: string) => string; pattern?: string; store?: (r: string, value: string) => string };
const named = (type: string, returns: Result["returns"], more: Partial<Result> = {}): Result => ({ type, returns, first: r => `${r}.a`, second: r => `${r}.b`, pattern: "{ a, b }", store: (r, value) => `${r}.a = ${value};`, ...more });
const maybe: Partial<Result> = { first: r => `${r}?.a`, second: r => `${r}?.b`, pattern: undefined, store: (r, value) => `if (${r}) ${r}.a = ${value};` };
const AB = "{ a: number; b: number }";
const results: Record<string, Result> = {
  literal: named(AB, (a, b) => `return { a: ${a}, b: ${b} };`),
  literalOfTwoKinds: named("{ a: number; b: string }", (a, b) => `return { a: ${a}, b: "t" + ${b} };`),
  pairInAList: { type: "[number, number]", returns: (a, b) => `return [${a}, ${b}];`, first: r => `${r}[0]`, second: r => `${r}[1]`, pattern: "[a, b]", store: (r, value) => `${r}[0] = ${value};` },
  list: { type: "number[]", returns: (a, b) => `return [${a}, ${b}, ${a} + ${b}];`, first: r => `${r}[0]`, second: r => `${r}[2]`, pattern: "[a, , b]", store: (r, value) => `${r}[0] = ${value};` },
  instance: named("Pair", (a, b) => `return new Pair(${a}, ${b});`, { beside: "class Pair { a: number; b: number; constructor(a: number, b: number) { this.a = a; this.b = b; } }" }),
  instanceWithInitializers: named("Filled", (a, b) => `const made = new Filled(); made.a = ${a}; made.b += ${b}; return made;`, { beside: "class Filled { a = 0; b = 5; }" }),
  instanceOfAChild: named("Child", (a, b) => `return new Child(${a}, ${b});`, { beside: "class Parent { a: number; constructor(a: number) { this.a = a; } }\nclass Child extends Parent { b: number; constructor(a: number, b: number) { super(a); this.b = b; } }" }),
  objectInAnObject: { type: "{ inner: { a: number }; b: number }", returns: (a, b) => `return { inner: { a: ${a} }, b: ${b} };`, first: r => `${r}.inner.a`, second: r => `${r}.b`, pattern: "{ inner: { a }, b }", store: (r, value) => `${r}.inner.a = ${value};` },
  orNothing: named(`${AB} | undefined`, (a, b) => `if (${a} % 3 === 0) return undefined; return { a: ${a}, b: ${b} };`, maybe),
  orNull: named(`${AB} | null`, (a, b) => `return ${a} % 3 === 0 ? null : { a: ${a}, b: ${b} };`, maybe),
  oneOfTwoShapes: named("{ a: number; b?: number }", (a, b) => `if (${a} % 2) return { a: ${a} }; return { a: ${a}, b: ${b} };`),
  sameNamesInAnotherOrder: named(AB, (a, b) => `if (${a} % 2) return { b: ${b}, a: ${a} }; return { a: ${a}, b: ${b} };`),
  filledStepByStep: named(AB, (a, b) => `const made = { a: 0, b: 0 }; made.a = ${a}; if (${b} > 1) made.b = ${b}; return made;`),
  filledInALoop: named(AB, (a, b) => `const made = { a: ${a}, b: 0 }; for (let at = 0; at < 3; at++) made.b += ${b} + at; return made;`),
  withAClosure: { type: "{ a: number; read: () => number }", returns: (a, b) => `return { a: ${a}, read: () => ${a} * 10 + ${b} };`, first: r => `${r}.a`, second: r => `${r}.read()`, pattern: undefined, store: (r, value) => `${r}.a = ${value};` },
  withAMethodThatReadsIt: { type: "{ a: number; sum(): number }", returns: (a, b) => `return { a: ${a}, sum() { return this.a + ${b}; } };`, first: r => `${r}.a`, second: r => `${r}.sum()`, store: (r, value) => `${r}.a = ${value};` },
  withAGetter: named("{ a: number; readonly b: number }", (a, b) => `return { a: ${a}, get b() { return this.a + ${b}; } };`),
  frozen: named(`Readonly<${AB}>`, (a, b) => `return Object.freeze({ a: ${a}, b: ${b} });`, { store: (r, value) => `(${r} as ${AB}).a = ${value};` }),
  withAKeyOfTheCall: { type: "Record<string, number>", returns: (a, b) => `return { ["k" + (${a} % 2)]: ${a}, b: ${b} };`, first: r => `${r}.k1`, second: r => `${r}.b`, store: (r, value) => `${r}.k1 = ${value};` },
  aCopyOfWhatItIsGiven: named(AB, (a, b) => `const from = { a: ${a}, b: 0 }; return { ...from, b: ${b} };`),
  thatHoldsWhatOthersHold: { type: "{ shared: { a: number }; b: number }", beside: "const shared = { a: 1 };", returns: (a, b) => `shared.a = ${a}; return { shared, b: ${b} };`, first: r => `${r}.shared.a`, second: r => `${r}.b`, pattern: "{ shared: { a }, b }", store: (r, value) => `${r}.shared.a = ${value};` },
  theSameOneNowAndThen: named(AB, (a, b) => `if (${a} % 3 === 0) return lastMade; lastMade = { a: ${a}, b: ${b} }; return lastMade;`, { beside: `let lastMade: ${AB} = { a: -1, b: -1 };` }),
  alsoKeptByTheFunction: named(AB, (a, b) => `const made = { a: ${a}, b: ${b} }; if (${a} % 3 === 0) allMade.push(made); return made;`, { beside: `const allMade: ${AB}[] = [];` }),
  ofManyFields: named("{ a: number; b: number; c: number; d: number; e: number; f: number; g: number; h: number; i: string }", (a, b) => `return { a: ${a}, b: ${b}, c: 3, d: ${a} + 4, e: 5, f: ${b} + 6, g: 7, h: 8, i: "i" + ${a} };`),
  withoutAPrototype: named(AB, (a, b) => `const made = Object.create(null) as ${AB}; made.a = ${a}; made.b = ${b}; return made;`),
  withFractions: named(AB, (a, b) => `return { a: ${a} + 0.5, b: ${b} / 4 };`),
};

const uses: Record<string, (r: Result, call: (a: string, b: string) => string, turn: string) => string | undefined> = {
  readsBoth: (r, call, turn) => `const got = ${call(turn, "start")}; say(${r.first("got")}, ${r.second("got")});`,
  readsOne: (r, call, turn) => `say(${r.second(`${call(turn, "start")}`)});`,
  takesItApart: (r, call, turn) => r.pattern && `const ${r.pattern} = ${call(turn, "start")}; say(a, b);`,
  readsWhatIsNotThere: (r, call, turn) => `const got = ${call(turn, "start")} as unknown as { missing?: number } | undefined | null; say(got?.missing, ${r.first(`(got as unknown as Made)`)});`,
  keepsIt: (r, call, turn) => `const got = ${call(turn, "start")}; kept.push(got); say(${r.first("got")});`,
  keepsItOnOneTurn: (r, call, turn) => `const got = ${call(turn, "start")}; if ((${turn}) % 3 === 1) kept.push(got); say(${r.first("got")}, ${r.second("got")});`,
  comparesTwo: (r, call, turn) => `const one = ${call(turn, "start")}, two = ${call(turn, "start")}; say(one === two, one == two, Object.is(one, one), ${r.first("two")});`,
  storesThenReads: (r, call, turn) => r.store && `const got = ${call(turn, "start")}; ${r.store("got", "77")} say(${r.first("got")}, ${r.second("got")});`,
  storesThenKeeps: (r, call, turn) => r.store && `const got = ${call(turn, "start")}; ${r.store("got", `${turn} + 70`)} kept.push(got);`,
  handsItOn: (r, call, turn) => `say(look(${call(turn, "start")}));`,
  handsItToWhatKeepsIt: (r, call, turn) => `keep(${call(turn, "start")}); say(kept.length);`,
  comesThroughAnother: (r, call, turn) => `const got = through(${turn}, start); say(${r.first("got")}, ${r.second("got")});`,
  listsItsKeys: (r, call, turn) => `const got = ${call(turn, "start")}; say(got ? Object.keys(got).join("+") : "none", ${r.first("got")});`,
  writesItAsText: (r, call, turn) => `say(JSON.stringify(${call(turn, "start")}));`,
  copiesIt: (r, call, turn) => `const got = ${call(turn, "start")}; const copy = { ...got }; say(Object.keys(copy).length, ${r.first("got")});`,
  asksWhatItIs: (r, call, turn) => `const got: unknown = ${call(turn, "start")}; say(typeof got, Array.isArray(got), got instanceof Object, got === null);`,
  asksForAName: (r, call, turn) => `const got = ${call(turn, "start")}; say(got ? "a" in got : "none", got ? Object.hasOwn(got, "b") : "none", ${r.second("got")});`,
  addsAField: (r, call, turn) => `const got = ${call(turn, "start")} as Made & { more?: number }; if (got && Object.isExtensible(got)) got.more = ${turn}; say(got?.more, ${r.first("got")});`,
  deletesAField: (r, call, turn) => `const got = ${call(turn, "start")} as { b?: unknown } | undefined | null; if (got && !Object.isFrozen(got)) delete got.b; say(got ? Object.keys(got).join("+") : "none");`,
  choosesBetweenTwo: (r, call, turn) => `const got = (${turn}) % 2 ? ${call(turn, "start")} : ${call("start", turn)}; say(${r.first("got")}, ${r.second("got")});`,
  readsItOnALaterTurn: (r, call, turn) => `if (held !== undefined) say("held", ${r.first("held")}, ${r.second("held")}); held = ${call(turn, "start")};`,
  readsItInAClosure: (r, call, turn) => `const got = ${call(turn, "start")}; readers.push(() => ${r.first("got")}); say(${r.second("got")});`,
  dropsIt: (r, call, turn) => `${call(turn, "start")}; say("dropped");`,
};

type Form = { suspends?: "await"; declare: (r: Result) => string; call: (a: string, b: string) => string };
const forms: Record<string, Form> = {
  declared: { declare: r => `function make(a: number, b: number): Made { ${r.returns("a", "b")} }`, call: (a, b) => `make(${a}, ${b})` },
  arrow: { declare: r => `const make = (a: number, b: number): Made => { ${r.returns("a", "b")} };`, call: (a, b) => `make(${a}, ${b})` },
  method: { declare: r => `class Maker { by = 1; make(a: number, b: number): Made { b += this.by; ${r.returns("a", "b")} } }\nconst maker = new Maker();`, call: (a, b) => `maker.make(${a}, ${b})` },
  underACleanup: { declare: r => `let cleanups = 0;\nfunction make(a: number, b: number): Made { try { ${r.returns("a", "b")} } finally { cleanups++; } }`, call: (a, b) => `make(${a}, ${b})` },
  thatMayThrow: { declare: r => `function make(a: number, b: number): Made { fail(a === 13); ${r.returns("a", "b")} }`, call: (a, b) => `make(${a}, ${b})` },
  thatCallsItself: { declare: r => `function make(a: number, b: number, depth = 0): Made { if (depth < 2) return make(a, b + 1, depth + 1); ${r.returns("a", "b")} }`, call: (a, b) => `make(${a}, ${b})` },
  thatWaits: { suspends: "await", declare: r => `function made(a: number, b: number): Made { ${r.returns("a", "b")} }\nasync function make(a: number, b: number): Promise<Made> { await null; return made(a, b); }`, call: (a, b) => `(await make(${a}, ${b}))` },
};

function stretch(resultName: string, useName: string, formName: string): Stretch | undefined {
  const [result, form] = [results[resultName], forms[formName]];
  const body = (turn: string) => uses[useName](result, form.call, turn);
  if (body("0") === undefined) return undefined;
  const isAsync = form.suspends === "await";
  return {
    name: `${resultName}-${useName}-${formName}`,
    beside: `type Made = ${result.type};
${result.beside ?? ""}
const kept: unknown[] = [];
const readers: (() => unknown)[] = [];
${form.declare(result)}
function look(got: Made): string { return String(${result.first("got")}) + ":" + String(${result.second("got")}); }
function keep(got: Made): void { kept.push(got); }
${isAsync ? "async " : ""}function through(a: number, b: number)${isAsync ? ": Promise<Made>" : ": Made"} { return ${form.call("a", "b").replace("(await ", "(")}; }
function left(): string { const text = kept.map(each => JSON.stringify(each)).join("|") + "/" + new Set(kept).size + "/" + readers.map(each => each()).join("|"); kept.length = 0; readers.length = 0; return text; }`,
    before: seed => `const start = ${seed}; let held = undefined as Made | undefined;`,
    body: turn => (isAsync ? body(turn)!.replace("through(", "await through(") : body(turn)!),
    after: "left()",
    suspends: form.suspends,
  };
}

const somePlaces = ["once", "often", "moduleLoop", "loop", "loopOften", "twoLoops", "loopWithContinue", "loopWithBreak", "branches", "handlerInALoop", "cleanup", "copiedIntoALoop", "alsoCalledWhereItSeldomRuns", "heldByAClosure", "inAClosure", "method", "callsItself", "loopWithAYield", "loopWithAnAwait", "awaitUnderAHandler"];

export const oneIn = 200;

export function programs(isTyped?: boolean) {
  const all: Stretch[] = [];
  for (const result in results)
    for (const use in uses)
      for (const form in forms) {
        const made = stretch(result, use, form);
        if (made) all.push(made);
      }
  return inEveryPlace(all, isTyped, somePlaces);
}
