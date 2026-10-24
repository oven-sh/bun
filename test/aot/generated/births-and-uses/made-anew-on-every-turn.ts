// What a turn of a loop makes anew: a closure, a closure that makes a closure, an object, a list, an instance. Every loop that makes it, against every loop or method that reads it,
// and every way by which what the reading turn has made comes to its use: at once, chosen by a test that always holds, out of a list, through a function.
// One small program for each. In it they stand in a function that runs once and often, in the module's own code, in two functions, in a method, around an await and around a yield.
type Thing = { type: string; make: (value: string) => string; fresh: string; freshType: string; use: (fresh: string) => string };

/** `calls` behind a thing make what is new on the turn that reads, of type `freshType`. `rest` behind that reads it. */
const thing = (type: string, make: Thing["make"], fresh: string, freshType: string, rest: string): Thing => ({ type, make, fresh, freshType, use: made => made + rest });
const twoDeep = (result: string, make: Thing["make"], rest = "()"): Thing => thing(`() => () => ${result}`, make, "()", `() => ${result}`, rest);

const things: Record<string, Thing> = {
  closure: thing("() => number", value => `() => ${value}`, "", "() => number", "()"),
  closureOfAClosure: twoDeep("number", value => `() => () => ${value}`),
  closureThreeDeep: thing("() => () => () => number", value => `() => () => () => ${value}`, "()()", "() => number", "()"),
  functionOfAFunction: twoDeep("number", value => `function () { return function () { return ${value}; }; }`),
  closureGivenANumber: thing("(by: number) => () => number", value => `(by: number) => () => ${value} * by`, "(2)", "() => number", "()"),
  closureWhoseClosureIsGivenANumber: thing("() => (by: number) => number", value => `() => (by: number) => ${value} * by`, "()", "(by: number) => number", "(2)"),
  closureWithADefault: thing("(by?: number) => () => number", value => `(by = ${value}) => () => by`, "()", "() => number", "()"),
  closureOfARestList: thing("(...rest: number[]) => () => number", value => `(...rest: number[]) => () => rest.length * 100 + ${value}`, "(1, 2)", "() => number", "()"),
  closureOverACounter: twoDeep("number", value => `() => { let count = ${value}; return () => ++count; }`),
  closureOverAClosure: twoDeep("number", value => `((inner: () => number) => () => inner)(() => ${value})`),
  closureOfAFraction: twoDeep("number", value => `() => () => ${value} + 0.5`),
  closureOfAText: twoDeep("string", value => `() => () => "t" + ${value}`),
  closureOfABigInteger: twoDeep("bigint", value => `() => () => BigInt(${value}) * 10000000000000000000000n`),
  closureOfAnObjectOfTheTurn: twoDeep("{ value: number }", value => `((held: { value: number }) => () => () => held)({ value: ${value} })`, "().value"),
  closureOfAListOfTheTurn: twoDeep("number[]", value => `((held: number[]) => () => () => held)([${value}, ${value} + 1])`, "()[1]"),
  closureThatMakesAnObject: thing("() => { value: number }", value => `() => ({ value: ${value} })`, "()", "{ value: number }", ".value"),
  closureThatMakesAList: thing("() => number[]", value => `() => [${value}, ${value} + 1]`, "()", "number[]", "[1]"),
  closureThatMakesTwoClosures: thing("() => (() => number)[]", value => `() => [() => ${value}, () => ${value} + 1]`, "()", "(() => number)[]", "[1]()"),
  closureThatMakesAnInstance: thing("() => Box", value => `() => new Box(${value})`, "()", "Box", ".value"),
  closureThatMakesAnInstanceThatReads: thing("() => Reader", value => `() => new Reader(() => ${value})`, "()", "Reader", ".read()"),
  closureThatMakesAMap: thing("() => Map<string, number>", value => `() => new Map([["k", ${value}]])`, "()", "Map<string, number>", `.get("k")`),
  objectWithAMethod: thing("{ read(): number }", value => `{ read() { return ${value}; } }`, "", "{ read(): number }", ".read()"),
  objectWithAnArrow: thing("{ read: () => number }", value => `{ read: () => ${value} }`, "", "{ read: () => number }", ".read()"),
  objectWithAGetter: thing("{ readonly value: number }", value => `{ get value() { return ${value}; } }`, "", "{ readonly value: number }", ".value"),
  objectWhoseMethodMakesAClosure: thing("{ reader(): () => number }", value => `{ reader() { return () => ${value}; } }`, ".reader()", "() => number", "()"),
  instanceWithAnArrowField: thing("{ read: () => number }", value => `new (class { read = () => ${value}; })()`, "", "{ read: () => number }", ".read()"),
  boundFunction: thing("(less: number) => number", value => `((more: number, less: number) => more * 10 + less).bind(null, ${value})`, "", "(less: number) => number", "(1)"),
  generatorFunction: { type: "() => Generator<number>", make: value => `function* () { yield ${value}; yield ${value} + 1; }`, fresh: "()", freshType: "Generator<number>", use: made => `[...${made}].join("+")` },
};

/** How what the turn has made comes to its use. `other` was made ahead of the loop and is kept. `count` is a whole number that the program does not know ahead. */
const ways: Record<string, (fresh: string, count: string) => string> = {
  atOnce: fresh => fresh,
  whereANumberIsItself: (fresh, count) => `((${count} ^ ${count}) === 0 ? ${fresh} : other)`,
  whereADifferenceIsZero: (fresh, count) => `(${count} - ${count} === 0 ? ${fresh} : other)`,
  whereNoBitIsLeft: (fresh, count) => `((${count} & 0) === 0 ? ${fresh} : other)`,
  whereTheLowBitIsSet: (fresh, count) => `(((${count} | 1) & 1) === 1 ? ${fresh} : other)`,
  whereHalfTwiceIsNoMore: (fresh, count) => `(((${count} >>> 1) << 1) <= ${count} ? ${fresh} : other)`,
  whereATestNeverHolds: (fresh, count) => `((${count} ^ ${count}) !== 0 ? other : ${fresh})`,
  whereATestHoldsSoFar: (fresh, count) => `(${count} < 1000 ? ${fresh} : other)`,
  madeOnBothWays: (fresh, count) => `(${count} % 2 ? ${fresh} : ${fresh})`,
  unlessItIsMissing: fresh => `(${fresh} ?? other)`,
  outOfAList: fresh => `[${fresh}][0]`,
  outOfAnObject: fresh => `({ held: ${fresh} }).held`,
  throughAFunction: fresh => `same(${fresh})`,
};
const loopsForEveryWay = ["counted", "ofAList", "map"];

/** `push` answers the statement that makes the thing over a number of this turn and keeps it. `n` is how many turns there are. */
const loops: Record<string, (push: (value: string) => string, make: (value: string) => string) => string> = {
  counted: push => `for (let i = 0; i < n; i++) ${push("i")}`,
  countedDown: push => `for (let i = n - 1; i >= 0; i--) ${push("i")}`,
  countedAndChangedInTheBody: push => `for (let i = 0; i < n + 1; i++) { ${push("i")} if (i === 1) i++; }`,
  countedByTwoVariables: push => `for (let i = 0, j = 10; i < n; i++, j += 3) ${push("(i * 100 + j)")}`,
  countedWithOneMadeInTheHead: (push, make) => `for (let i = 0, first = ${make("i")}; i < n; i++) { if (i === 0) made.push(first); ${push("i")} }`,
  countedByOneVariableForAllTurns: push => `for (var v = 0; v < n; v++) ${push("v")}`,
  constantOfTheBody: push => `for (let i = 0; i < n; i++) { const here = i * 2; ${push("here")} }`,
  variableOfTheBodyChangedBehind: push => `for (let i = 0; i < n; i++) { let here = i; ${push("here")} here += 10; }`,
  ofAList: push => `for (const each of list(n)) ${push("each")}`,
  ofAListChangedBehind: push => `for (let each of list(n)) { ${push("each")} each += 10; }`,
  ofEntries: push => `for (const [at, each] of list(n).entries()) ${push("(at * 10 + each)")}`,
  ofAGenerator: push => `for (const each of counting(n)) ${push("each")}`,
  ofASet: push => `for (const each of new Set(list(n))) ${push("each")}`,
  inAnObject: push => `for (const name in { a: 1, bc: 2, def: 3 }) ${push("name.length")}`,
  whileWithAConstant: push => `let w = 0; while (w < n) { const here = w++; ${push("here")} }`,
  doWithAConstant: push => `let w = 0; do { const here = w; ${push("here")} } while (++w < n);`,
  oneLoopInAnother: push => `for (let i = 0; i < n; i++) for (let j = 0; j < 2; j++) ${push("(i * 10 + j)")}`,
  withATurnLeftOut: push => `for (let i = 0; i < n + 1; i++) { if (i === 1) continue; ${push("i")} }`,
  leftForTheOuterLoop: push => `outer: for (let i = 0; i < n; i++) for (let j = 0; j < 3; j++) { if (j === 1) continue outer; ${push("(i * 10 + j)")} }`,
  caught: push => `for (let i = 0; i < n; i++) try { throw i * 3; } catch (thrown) { const held = Number(thrown); ${push("held")} }`,
  inAFinally: push => `for (let i = 0; i < n; i++) try { if (i === 1) continue; } finally { ${push("i")} }`,
  inACase: push => `for (let i = 0; i < n; i++) switch (i % 2) { case 0: { const even = i; ${push("even")} break; } default: { const odd = -i; ${push("odd")} } }`,
  forEach: push => `list(n).forEach(each => { ${push("each")} });`,
  map: (_, make) => `made.push(...list(n).map(each => (${make("each")})));`,
  mapBehindMap: (_, make) => `made.push(...list(n).map(each => each + 1).map(each => (${make("each")})));`,
  flatMap: (_, make) => `made.push(...list(n).flatMap(each => [${make("each")}, ${make("-each")}]));`,
  arrayFrom: (_, make) => `made.push(...Array.from({ length: n }, (_, at) => (${make("at")})));`,
  reduce: (_, make) => `list(n).reduce((all, each) => (all.push(${make("each")}), all), made);`,
  aFunctionThatCallsItself: push => `(function again(i: number) { if (i < n) { ${push("i")} again(i + 1); } })(0);`,
  aParameter: push => `const add = (given: number) => { ${push("given")} }; for (let i = 0; i < n; i++) add(i);`,
};

/** `read` answers the expression that reads a thing. What is read goes into `seen`. */
const readers: Record<string, (read: (thing: string) => string) => string> = {
  counted: read => `for (let k = 0; k < made.length; k++) seen.push(${read("made[k]")});`,
  countedThroughAConstant: read => `for (let k = 0; k < made.length; k++) { const thing = made[k]; seen.push(${read("thing")}); }`,
  countedDown: read => `for (let k = made.length - 1; k >= 0; k--) seen.push(${read("made[k]")});`,
  ofTheList: read => `for (const thing of made) seen.push(${read("thing")});`,
  ofTheListAndMore: read => `for (const thing of made) seen.push("<" + ${read("thing")} + ">");`,
  ofTheListIntoAText: read => `let text = ""; for (const thing of made) text += ${read("thing")} + ";"; seen.push(text);`,
  ofEntries: read => `for (const [place, thing] of made.entries()) seen.push(place, ${read("thing")});`,
  ofACopy: read => `for (const thing of [...made]) seen.push(${read("thing")});`,
  ofASet: read => `for (const thing of new Set(made)) seen.push(${read("thing")});`,
  ofTheValuesOfAMap: read => `for (const thing of new Map(made.entries()).values()) seen.push(${read("thing")});`,
  inTheKeys: read => `for (const key in made) seen.push(${read("made[Number(key)]")});`,
  while: read => `let k = 0; while (k < made.length) seen.push(${read("made[k++]")});`,
  do: read => `let k = 0; if (made.length) do seen.push(${read("made[k]")}); while (++k < made.length);`,
  twiceATurn: read => `for (const thing of made) seen.push(${read("thing")}, ${read("thing")});`,
  twiceATurnThroughConstants: read => `for (const thing of made) { const first = ${read("thing")}; const second = ${read("thing")}; seen.push(first, second); }`,
  onEitherWay: read => `for (const thing of made) seen.push(seen.length % 2 ? ${read("thing")} : ${read("thing")});`,
  inTwoLoops: read => `for (let round = 0; round < 2; round++) for (const thing of made) seen.push(${read("thing")});`,
  inALoopOfItsOwn: read => `for (const thing of made) for (let again = 0; again < 2; again++) seen.push(${read("thing")});`,
  ofTheListIntoASum: read => `let sum = 0; for (const thing of made) sum += Number(${read("thing")}); seen.push(sum);`,
  inATry: read => `for (const thing of made) try { seen.push(${read("thing")}); } catch { seen.push("threw"); }`,
  forEach: read => `made.forEach(thing => { seen.push(${read("thing")}); });`,
  map: read => `seen.push(...made.map(thing => ${read("thing")}));`,
  mapThenMap: read => `seen.push(...made.map(thing => ${read("thing")}).map(each => "<" + each + ">"));`,
  filterThenMap: read => `seen.push(...made.filter(thing => ${read("thing")} !== undefined).map(thing => ${read("thing")}));`,
  sliceThenMap: read => `seen.push(...made.slice(1).map(thing => ${read("thing")}));`,
  mapThenJoin: read => `seen.push(made.map(thing => ${read("thing")}).join("+"));`,
  reduce: read => `seen.push(made.reduce((text, thing) => text + ${read("thing")} + ";", ""));`,
  reduceRight: read => `seen.push(made.reduceRight((text, thing) => text + ${read("thing")} + ";", ""));`,
  flatMap: read => `seen.push(...made.flatMap(thing => [${read("thing")}, ${read("thing")}]));`,
  every: read => `made.every(thing => seen.push(${read("thing")}) > 0);`,
  find: read => `made.find(thing => seen.push(${read("thing")}) > 2);`,
  arrayFrom: read => `seen.push(...Array.from(made, thing => ${read("thing")}));`,
  oneByOne: read => `if (made.length > 2) seen.push(${read("made[0]")}, ${read("made[1]")}, ${read("made[2]")});`,
  takenApart: read => `const [first, second, third] = made; if (third) seen.push(${read("first")}, ${read("second")}, ${read("third")});`,
  byAClosure: read => `const one = (thing: Made) => ${read("thing")}; for (const thing of made) seen.push(one(thing));`,
  byAFunction: () => `for (const thing of made) seen.push(readOne(thing));`,
  byAFunctionHandedToMap: () => `seen.push(...made.map(readOne));`,
  byCall: () => `for (const thing of made) seen.push(readOne.call(undefined, thing));`,
  byApply: () => `for (const thing of made) seen.push(Reflect.apply(readOne, undefined, [thing]));`,
  byAFunctionThatCallsItself: read => `(function again(k: number) { if (k < made.length) { seen.push(${read("made[k]")}); again(k + 1); } })(0);`,
  byAGenerator: read => `seen.push(...(function* () { for (const thing of made) yield ${read("thing")}; })());`,
  throughNewClosures: read => `const reads = made.map(thing => () => ${read("thing")}); for (const each of reads) seen.push(each());`,
  takenOffTheEnd: read => `const rest = made.slice(); while (rest.length) seen.push(${read("rest.pop()!")});`,
};

export const oneIn = 100;

export function programs(typed = false) {
  const made: { name: string; file: string; text: string }[] = [];
  for (const [thingName, thing] of Object.entries(things))
    for (const [loopName, loop] of Object.entries(loops))
      for (const [readerName, reader] of Object.entries(readers))
        for (const [wayName, way] of Object.entries(ways)) {
          if (wayName !== "atOnce" && !loopsForEveryWay.includes(loopName)) continue;
          const other = way("", "").includes("other") ? `const other: Fresh = (${thing.make("99")})${thing.fresh}; kept.push(other); ` : "";
          const born = `const made: Made[] = []; ${loop(value => `made.push(${thing.make(value)});`, thing.make)}`;
          const read = `const seen: unknown[] = []; ${other}${reader(held => thing.use(way(held + thing.fresh, "seen.length")))}`;
          const text = () => `type Made = ${thing.type};
type Fresh = ${thing.freshType};
class Box { value: number; constructor(value: number) { this.value = value; } }
class Reader { read: () => number; constructor(read: () => number) { this.read = read; } }
const kept: unknown[] = [];
function same<T>(value: T): T { return value; }
function list(n: number): number[] { const all: number[] = []; for (let at = 0; at < n; at++) all.push(at + 4); return all; }
function* counting(n: number): Generator<number> { for (let at = 0; at < n; at++) yield at + 7; }
function show(seen: unknown[]): string { let text = ""; for (let at = 0; at < seen.length; at++) text += (at ? "," : "") + String(seen[at]); return text; }
function readOne(thing: Made) { ${other}return ${thing.use(way("thing" + thing.fresh, "kept.length"))}; }
function together(n: number): string { ${born} ${read} return show(seen); }
function makes(n: number): Made[] { ${born} return made; }
function reads(made: Made[]): string { ${read} return show(seen); }
class Holder { n = 3; run(): string { const n = this.n; ${born} ${read} return show(seen); } }
async function waits(n: number): Promise<string> { ${born} await null; ${read} return show(seen); }
function* yields(n: number): Generator<number, string> { ${born} yield made.length; ${read} return show(seen); }
console.log("once", together(3));
console.log("apart", reads(makes(3)));
{ const n = 3; ${born} ${read} console.log("module", show(seen)); }
console.log("method", new Holder().run());
console.log("await", await waits(3));
{ const steps = yields(3); steps.next(); console.log("yield", steps.next().value); }
{ const said = new Set<string>(); for (let turn = 0; turn < 200; turn++) said.add(together(3 + (turn % 2))); console.log("often", [...said].join(" | ")); }
{ const said = new Set<string>(); for (let turn = 0; turn < 200; turn++) said.add(reads(makes(3 + (turn % 2)))); console.log("often apart", [...said].join(" | ")); }
console.log("kept", kept.length);
export {};
`;
          made.push({
            name: `${thingName}-${loopName}-${readerName}${wayName === "atOnce" ? "" : "-" + wayName}`,
            file: typed ? "program.ts" : "program.mjs",
            get text() {
              return typed ? text() : new Bun.Transpiler({ loader: "ts" }).transformSync(text());
            },
          });
        }
  return made;
}
