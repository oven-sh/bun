// What a turn of a loop makes anew: a closure, a closure that makes a closure, an object, a list, a rest list, an instance, a bound function, a started generator, what a tag is given.
// Every loop that makes it, against every loop, method, declared function or callback of a built-in that reads it,
// and every way by which what the reading turn has made comes to its use: at once, chosen by a test that always holds, out of a list, through a function.
// One small program for each. In it they stand in a function that runs once and often, in the module's own code, in two functions, in a method, around an await and around a yield.
type Thing = { type: string; make: (value: string) => string; fresh: string; freshType: string; use: (fresh: string) => string; beside?: string };

/** `calls` behind a thing make what is new on the turn that reads, of type `freshType`. `rest` behind that reads it. */
const thing = (type: string, make: Thing["make"], fresh: string, freshType: string, rest: string, beside?: string): Thing => ({ type, make, fresh, freshType, use: made => made + rest, beside });
/** A closure without parameters whose call makes a `freshType`. */
const maker = (freshType: string, body: Thing["make"], rest: string, beside?: string): Thing => thing(`() => ${freshType}`, value => `() => ${body(value)}`, "()", freshType, rest, beside);
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

/** More of what a call makes on the turn that reads. These stand behind `loopsForEveryWay` alone. */
const moreThings: Record<string, Thing> = {
  closureThatAnswersItsRestList: thing("(...rest: number[]) => number[]", value => `(...rest: number[]) => (rest.push(${value}), rest)`, "(1, 2)", "number[]", "[2]"),
  functionThatAnswersItsArguments: thing("(first: number, second: number) => IArguments", value => `function (first: number, second: number) { arguments[1] = first + ${value}; return arguments; }`, "(5, 0)", "IArguments", "[1]"),
  closureThatBindsAFunction: maker("(less: number) => number", value => `((more: number, less: number) => more * 10 + less).bind(null, ${value})`, "(1)"),
  closureThatBindsToAnObject: maker("() => number", value => `(function (this: { value: number }) { return this.value; }).bind({ value: ${value} })`, "()"),
  generatorTakenOneStep: thing("() => Generator<number>", value => `function* () { yield ${value}; yield ${value} + 1; }`, "()", "Generator<number>", ".next().value"),
  generatorOverAVariable: { type: "() => Generator<number>", make: value => `function* () { let count = ${value}; for (;;) yield ++count; }`, fresh: "()", freshType: "Generator<number>", use: made => `((steps: Generator<number>) => (steps.next(), steps.next().value))(${made})` },
  closureThatStartsAGenerator: maker("Generator<number>", value => `(function* () { yield ${value}; })()`, ".next().value"),
  closureThatMakesAnInstanceWithAHiddenField: maker("Hidden", value => `new Hidden(${value})`, ".read()", "class Hidden { #value: number; constructor(value: number) { this.#value = value; } read() { return this.#value; } }"),
  closureThatMakesAnInstanceOfAChild: maker("Child", value => `new Child(${value})`, ".sum()", "class Child extends Box { more: number; constructor(value: number) { super(value); this.more = value + 1; } sum() { return this.value * 100 + this.more; } }"),
  closureThatMakesAnInstanceThatCounts: maker("Counter", value => `new Counter(${value})`, ".next()", "class Counter { count: number; constructor(count: number) { this.count = count; } next() { return ++this.count; } }"),
  closureThatMakesAnInstanceAndFillsIt: maker("Box", value => `{ const filled = new Box(0); filled.value = ${value}; return filled; }`, ".value"),
  closureThatMakesAnInstanceOfAFunction: maker("{ value: number }", value => `new (Old as unknown as new (value: number) => { value: number })(${value})`, ".value", "function Old(this: { value: number }, value: number) { this.value = value; }"),
  closureThatMakesAnInstanceByReflect: maker("Box", value => `Reflect.construct(Box, [${value}]) as Box`, ".value"),
  closureThatMakesAnInstanceOfAClassOfTheTurn: maker("{ value: number }", value => `new (class { value = ${value}; })()`, ".value"),
  closureThatMakesAClass: maker("{ value: number }", value => `class { static value = ${value}; }`, ".value"),
  closureThatTagsATemplate: {
    ...maker("Tagged", value => "tag`a${" + value + "}b`", ""),
    use: made => `((tagged: Tagged) => tagged.strings[0] + tagged.values[0] + tagged.strings.raw[1])(${made})`,
    beside: "type Tagged = { strings: TemplateStringsArray; values: number[] };\nfunction tag(strings: TemplateStringsArray, ...values: number[]): Tagged { return { strings, values }; }",
  },
  closureThatSpreadsAnObject: thing("() => { value: number; more: number }", value => `((held: { value: number }) => () => ({ ...held, more: 1 }))({ value: ${value} })`, "()", "{ value: number; more: number }", ".value"),
  closureThatSpreadsAList: thing("() => number[]", value => `((held: number[]) => () => [...held, 1])([${value}])`, "()", "number[]", "[0]"),
  closureThatTakesAListApart: maker("number[]", value => `{ const [first, ...others] = [1, ${value}, 3]; return others; }`, "[0]"),
  closureThatTakesAnObjectApart: maker("{ value: number }", value => `{ const { first, ...others } = { first: 1, value: ${value} }; return others; }`, ".value"),
  closureThatMakesAnObjectOfObjects: maker("{ inner: { value: number } }", value => `({ inner: { value: ${value} } })`, ".inner.value"),
  closureThatMakesAListOfLists: maker("number[][]", value => `[[${value}], [1]]`, "[0][0]"),
  closureThatMakesAnObjectWithAKeyOfTheTurn: { ...maker("Record<string, number>", value => `({ ["k" + (${value} % 2)]: ${value} })`, ""), use: made => `Object.entries(${made}).join("+")` },
  closureThatMakesAnObjectWithAGetter: maker("{ readonly value: number }", value => `({ get value() { return ${value}; } })`, ".value"),
  closureThatMakesAnObjectWithoutAPrototype: maker("{ value: number }", value => `Object.assign(Object.create(null) as { value?: number }, { value: ${value} })`, ".value"),
  closureThatMakesAnObjectBelowAnother: maker("{ value: number }", value => `Object.create({ more: 1 }, { value: { value: ${value}, enumerable: true } }) as { value: number }`, ".value"),
  closureThatFreezesAnObject: maker("{ readonly value: number }", value => `Object.freeze({ value: ${value} })`, ".value"),
  closureThatMakesAnObjectAndDeletesAField: {
    ...maker("{ gone?: number; value: number }", value => `{ const left: { gone?: number; value: number } = { gone: 1, value: ${value} }; delete left.gone; return left; }`, ""),
    use: made => `((left: Fresh) => Object.keys(left).join("+") + left.value)(${made})`,
  },
  closureThatMakesAnObjectAndStoresWhereItDeleted: {
    ...maker("{ value?: number; more: number }", value => `{ const left: { value?: number; more: number } = { value: 0, more: 1 }; delete left.value; left.value = ${value}; return left; }`, ""),
    use: made => `((left: Fresh) => Object.keys(left).join("+") + left.value)(${made})`,
  },
  closureThatMakesAnInstanceWhoseConstructorDeletes: {
    ...maker("Emptied", value => `new Emptied(${value})`, ""),
    use: made => `((left: Fresh) => Object.keys(left).join("+") + left.value)(${made})`,
    beside: "class Emptied { value?: number = 0; more = 1; constructor(value: number) { delete this.value; this.value = value; } }",
  },
  closureThatMakesAnInstanceThatStoresBelowASetter: {
    ...maker("Lower", value => `new Lower(${value})`, ""),
    use: made => `((left: Fresh) => Object.keys(left).join("+") + left.seen + "/" + left.value)(${made})`,
    beside:
      "class Lower { value?: number = 0; seen = 0; constructor(value: number) { delete this.value; this.value = value; } }\n" +
      'Object.defineProperty(Lower.prototype, "value", { set(this: Lower, given: number) { this.seen = given * 2; }, configurable: true });',
  },
  closureThatStoresWhereItDeletedAndOneFieldIsRead: maker("{ value?: number; more: number }", value => `{ const left: { value?: number; more: number } = { value: 0, more: 1 }; delete left.value; left.value = ${value}; return left; }`, ".value"),
  closureThatMakesAnInstanceWhoseConstructorDeletesAndOneFieldIsRead: maker("Emptied", value => `new Emptied(${value})`, ".value", "class Emptied { value?: number = 0; more = 1; constructor(value: number) { delete this.value; this.value = value; } }"),
  closureThatMakesAnInstanceThatStoresBelowASetterAndOneFieldIsRead: maker(
    "Lower",
    value => `new Lower(${value})`,
    ".seen",
    "class Lower { value?: number = 0; seen = 0; constructor(value: number) { delete this.value; this.value = value; } }\n" +
      'Object.defineProperty(Lower.prototype, "value", { set(this: Lower, given: number) { this.seen = given * 2; }, configurable: true });',
  ),
  closureThatStoresInAnInstanceBelowAFrozenPrototype: maker(
    "number",
    value => `{ const deep = new Deep(); try { deep.depth = ${value}; } catch { return -1; } return deep.depth ?? -2; }`,
    " * 2",
    "class Deep { depth?: number = 0; constructor() { delete this.depth; } }\nDeep.prototype.depth = 1;\nObject.freeze(Deep.prototype);",
  ),
  closureThatMakesAProxy: maker("{ value: number }", value => `new Proxy({ value: ${value} }, {})`, ".value"),
  closureThatMakesTwoClosuresOverOneVariable: {
    ...maker("{ up: () => number; read: () => number }", value => `{ let count = ${value}; return { up: () => ++count, read: () => count }; }`, ""),
    use: made => `((pair: Fresh) => (pair.up(), pair.read()))(${made})`,
  },
  closureThatMakesClosuresInALoop: maker("(() => number)[]", value => `{ const all: (() => number)[] = []; for (let at = 0; at < 2; at++) all.push(() => ${value} + at); return all; }`, "[1]()"),
  closureThatMakesASet: { ...maker("Set<number>", value => `new Set([${value}, 1])`, ""), use: made => `[...${made}].join("+")` },
  closureThatMakesBytes: maker("Uint8Array", value => `new Uint8Array([${value}, 1])`, "[0]"),
  closureThatMakesAnIterator: maker("IterableIterator<number>", value => `[${value}, 1].values()`, ".next().value"),
  closureThatMakesAStep: maker("IteratorResult<number>", value => `[${value}][Symbol.iterator]().next()`, ".value"),
  closureThatMakesAPattern: maker("RegExp", value => `new RegExp("a{" + Math.abs(${value}) + "}", "g")`, ".source"),
  closureThatMakesAPatternAsWritten: maker("RegExp", value => `{ const pattern = /a/g; pattern.lastIndex = ${value}; return pattern; }`, ".lastIndex"),
  closureThatMakesAnError: maker("Error", value => `new Error("e" + ${value})`, ".message"),
  closureThatMakesADate: maker("Date", value => `new Date(${value})`, ".getTime()"),
  closureThatMakesASymbol: maker("symbol", value => `Symbol("s" + ${value})`, ".description"),
  closureThatMakesAText: maker("string", value => `"t" + ${value} + "u"`, ".slice(1)"),
  closureThatMakesAFraction: maker("number", value => `${value} + 0.5`, " * 2"),
  closureThatMakesABigInteger: maker("bigint", value => `BigInt(${value}) * 10000000000000000000000n`, ".toString()"),
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

/** More readers, behind `loopsForEveryWay` alone. `fresh` answers the expression that makes what is new out of a thing, `use` the one that reads what was made. */
const moreReaders: Record<string, (read: (thing: string) => string, fresh: (thing: string) => string, use: (made: string) => string) => string> = {
  byTheApplyOfTheFunction: () => `for (const thing of made) seen.push(readOne.apply(undefined, [thing]));`,
  byABoundFunction: () => `const bound = readOne.bind(undefined); for (const thing of made) seen.push(bound(thing));`,
  byAnOptionalCall: () => `for (const thing of made) seen.push(readOne?.(thing));`,
  byASpreadCall: () => `for (const thing of made) seen.push(readOne(...([thing] as [Made])));`,
  byAFunctionThatHandsOn: () => `for (const thing of made) seen.push(handsOn(thing));`,
  byATaggedTemplate: () => "for (const thing of made) seen.push(readTagged`${thing}`);",
  byAMethodOfAnInstance: () => `const reading = new Reads(); for (const thing of made) seen.push(reading.one(thing));`,
  byAStaticMethod: () => `for (const thing of made) seen.push(Reads.alone(thing));`,
  byAFunctionHandedToArrayFrom: () => `seen.push(...Array.from(made, readOne));`,
  byAFunctionHandedToFlatMap: () => `seen.push(...made.flatMap(readOne));`,
  byAMethodOfAnObject: read => `const reading = { one(thing: Made) { return ${read("thing")}; } }; for (const thing of made) seen.push(reading.one(thing));`,
  byAGetter: read => `class Reading { thing: Made; constructor(thing: Made) { this.thing = thing; } get one() { return ${read("this.thing")}; } } for (const thing of made) seen.push(new Reading(thing).one);`,
  byAConstructor: read => `class Seen { value: unknown; constructor(thing: Made) { this.value = ${read("thing")}; } } for (const thing of made) seen.push(new Seen(thing).value);`,
  byADefaultOfAParameter: read => `const one = (thing: Made, value = ${read("thing")}) => value; for (const thing of made) seen.push(one(thing));`,
  byAConversionToText: read => `for (const thing of made) seen.push(String({ toString: () => ${read("thing")} + ";" }));`,
  byAnIteratorOfTheProgram: read => `const walk = { [Symbol.iterator]() { let k = 0; return { next: (): IteratorResult<unknown> => (k < made.length ? { done: false, value: ${read("made[k++]")} } : { done: true, value: undefined }) }; } }; seen.push(...walk);`,
  byTheForEachOfAMap: read => `new Map(made.entries()).forEach(thing => { seen.push(${read("thing")}); });`,
  byTheForEachOfASet: read => `new Set(made).forEach(thing => { seen.push(${read("thing")}); });`,
  byWhatReplacesInAText: read => `seen.push("x".repeat(made.length).replace(/x/g, (_, at: number) => ${read("made[at]")} + ";"));`,
  byWhatReplacesInAStringify: read => `seen.push(JSON.stringify(made.map((_, at) => at), (_, value) => (typeof value === "number" ? ${read("made[value]")} + ";" : value)));`,
  untilTwoAreSeen: read => `for (const thing of made) { if (seen.length > 1) break; seen.push(${read("thing")}); }`,
  keptPastTheTurn: (_, fresh, use) => `const all: Fresh[] = []; for (const thing of made) all.push(${fresh("thing")}); for (const each of all) seen.push(${use("each")});`,
  heldFromTheTurnBefore: (_, fresh, use) => `let before = undefined as Fresh | undefined; for (const thing of made) { const now = ${fresh("thing")}; if (before !== undefined) seen.push(${use("before")}); before = now; } if (before !== undefined) seen.push(${use("before")});`,
  comparedWithTheTurnBefore: (_, fresh, use) => `let before = undefined as Fresh | undefined; for (const thing of made) { const now = ${fresh("thing")}; seen.push(before === now, ${use("now")}); before = now; }`,
  twoOfOneTurn: (_, fresh, use) => `for (const thing of made) { const first = ${fresh("thing")}; const second = ${fresh("thing")}; seen.push(first === second, ${use("first")}, ${use("second")}); }`,
  throughAVariableOfTheTurn: (_, fresh, use) => `for (const thing of made) { let held = ${fresh("thing")}; const again = () => held; const first = ${use("again()")}; held = ${fresh("thing")}; seen.push(first, ${use("again()")}); }`,
  throughAVariableChangedByAClosure: (_, fresh, use) => `for (const thing of made) { let held = undefined as Fresh | undefined; const keep = (given: Fresh) => { held = given; }; keep(${fresh("thing")}); seen.push(${use("held!")}); }`,
  lentToAClosure: (_, fresh, use) => `const lent = (given: Fresh) => ${use("given")}; for (const thing of made) seen.push(lent(${fresh("thing")}));`,
  lentToAClosureThatKeepsTheFirst: (_, fresh, use) => `const held: Fresh[] = []; const keepsOne = (given: Fresh) => { if (held.length === 0) held.push(given); return given; }; for (const thing of made) seen.push(${use(`keepsOne(${fresh("thing")})`)}); seen.push(${use("held[0]")});`,
  keptOnTheLastTurn: (_, fresh, use) => `let last = undefined as Fresh | undefined; let turn = 0; for (const thing of made) { const now = ${fresh("thing")}; if (++turn === made.length) last = now; else seen.push(${use("now")}); } seen.push(${use("last!")});`,
  keptInAFieldOfAnOlderObject: (_, fresh, use) => `const holder: { held?: Fresh } = {}; for (const thing of made) { holder.held = ${fresh("thing")}; seen.push(${use("holder.held")}); } holder.held = ${fresh("made[0]")}; seen.push(${use("holder.held")});`,
  keptByAClosureForLater: (_, fresh, use) => `const later: (() => unknown)[] = []; for (const thing of made) { const now = ${fresh("thing")}; later.push(() => ${use("now")}); } for (const each of later) seen.push(each());`,
  thrownAndCaught: (_, fresh, use) => `for (const thing of made) try { throw ${fresh("thing")}; } catch (caught) { seen.push(${use("(caught as Fresh)")}); }`,
  answeredOutOfTheLoop: (_, fresh, use) => `const find = (from: number) => { for (let k = from; k < made.length; k++) { const now = ${fresh("made[k]")}; if (k >= from) return now; } return ${fresh("made[0]")}; }; for (let k = 0; k < made.length; k++) seen.push(${use("find(k)")});`,
  yieldedOutOfTheLoop: (_, fresh, use) => `for (const each of (function* () { for (const thing of made) yield ${fresh("thing")}; })()) seen.push(${use("each")});`,
};

/** What some readers call stands beside `readOne`. `body` is its body. */
const besideReaders: Record<string, (body: string) => string> = {
  byAFunctionThatHandsOn: () => `function handsOn(thing: Made) { return readOne(thing); }`,
  byATaggedTemplate: body => `function readTagged(_: TemplateStringsArray, thing: Made) { ${body} }`,
  byAMethodOfAnInstance: body => `class Reads { one(thing: Made) { ${body} } }`,
  byAStaticMethod: body => `class Reads { static alone(thing: Made) { ${body} } }`,
};

export const oneIn = 250;

export function programs(typed = false) {
  const made: { name: string; file: string; text: string }[] = [];
  for (const [thingName, thing] of Object.entries({ ...things, ...moreThings }))
    for (const [loopName, loop] of Object.entries(loops))
      for (const [readerName, reader] of Object.entries({ ...readers, ...moreReaders }))
        for (const [wayName, way] of Object.entries(ways)) {
          if ((wayName !== "atOnce" || thingName in moreThings || readerName in moreReaders) && !loopsForEveryWay.includes(loopName)) continue;
          const other = way("", "").includes("other") ? `const other: Fresh = (${thing.make("99")})${thing.fresh}; kept.push(other); ` : "";
          const born = `const made: Made[] = []; ${loop(value => `made.push(${thing.make(value)});`, thing.make)}`;
          const fresh = (held: string) => way(held + thing.fresh, "seen.length");
          const read = `const seen: unknown[] = []; ${other}${reader(held => thing.use(fresh(held)), fresh, thing.use)}`;
          const body = `${other}return ${thing.use(way("thing" + thing.fresh, "kept.length"))};`;
          const beside = [thing.beside, besideReaders[readerName]?.(body)].filter(Boolean).map(text => "\n" + text).join("");
          const text = () => `type Made = ${thing.type};
type Fresh = ${thing.freshType};
class Box { value: number; constructor(value: number) { this.value = value; } }
class Reader { read: () => number; constructor(read: () => number) { this.read = read; } }
const kept: unknown[] = [];
function same<T>(value: T): T { return value; }
function list(n: number): number[] { const all: number[] = []; for (let at = 0; at < n; at++) all.push(at + 4); return all; }
function* counting(n: number): Generator<number> { for (let at = 0; at < n; at++) yield at + 7; }
function show(seen: unknown[]): string { let text = ""; for (let at = 0; at < seen.length; at++) text += (at ? "," : "") + String(seen[at]); return text; }
function readOne(thing: Made) { ${body} }${beside}
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
