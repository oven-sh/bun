// One place in a program that sees two kinds of object. Every other generator of objects in this folder gives a use one birth, so that the compiler knows all about the object at that use. Here a use has two:
// a literal and an instance, an instance and null, a frozen object and a proxy. A value of two kinds is kept as a tag and what belongs to that tag, and whatever is read of one kind may be read only behind a
// test of the tag. Each pair of births meets each group of uses on each road by which a value reaches a use:
//   handed        the use is a function; it is called in a long loop with the first kind, then three times with the second, then with the first again
//   member        the same, and the value is a member of an instance that is handed to a helper
//   property      the same, and the value is a property of a literal that is handed to a helper
//   hidden        the same, and the value is a private member of the instance whose method is the use
//   either        one local of a function called in a long loop is born as one kind or the other, by a condition
//   oneTurn       a local starts as the first kind; the second is made in every turn of a loop and kept in one turn only, and not in every call
//   maker         as oneTurn, and the second kind comes from a function that answers a number in the other turns; its variable may also hold a Proxy of it
//   returned      a function answers one kind or the other; its caller uses the answer, and hands it on, to a function too large to be inlined, in few calls only
//   thrown        one kind or the other is thrown, and the use stands in the catch
//   captured      a closure is the use; the variable that it reads is born as the first kind and may get the second before the call
//   element       a list of both kinds is walked
//   variable      a variable of the module gets one kind or the other in one function and is read in another
//   acrossCatch   a local gets the second kind in a try whose last call throws now and then; the use stands behind the catch
//   acrossYield   a local of a generator is born as one kind or the other in front of a yield; the use stands behind it
//   acrossAwait   the same in an async function, around an await
//   defaulted     the first kind is the default of a parameter, the second is handed in
//   rest          the value is the first of the rest of the arguments
//   receiver      the value is `this`
//   large         as returned, and the function that answers is too large to be inlined as well
//   largeAndJoined  the same, with one return behind the place where the two kinds meet
//   onlyTheSecond   a variable of the module starts as null and gets nothing but the second kind; it is copied into a local and tested for null in front of the use. Declared as the first kind, it holds only misfits
//   onlyTheSecondCaptured  the same with a captured variable and undefined
//   aroundTheLoop   a local gets the first kind, the second kind or null at the end of a turn of a loop and is used at the start of the next
// A place is a function of its own. A program holds many places: one pair of kinds and one group of uses on every road, so that nothing but those two births decides what the compiler believes of a class or a
// shape. `programs(false, "many")` packs them the other way: one first kind, one road, one group of uses, and many second kinds. `programs(false, "use")` makes a program of every single place, to cut a find down.
// As TypeScript the value is declared as the union of what the two kinds are. Not every use is allowed on every union: each line stands behind a comment that silences the checker for it.
// `programs("as the first kind")` declares it as what the first kind is, as a program does that takes what JSON.parse answers for an instance: what the compiler believes of the declared type may not decide what happens.
// "which never comes": and the first kind is never born: wherever it would be, the second is. The place holds nothing but misfits of what it is declared as.
// "through any": the members of the value are reached through a cast, `(v as any).a`, as a program must write that reads what the declared type lacks.
// What is hot is a share of the program's own code, so a place among hundreds is not as hot as it is alone. `ballast` adds so many functions that run once for every place: with eight of them a place is as hot as
// it is alone. `places` is the most that a program holds.
/** There are 35,000 programs: one in so many is run every time. */
export const oneIn = 800;

export function programs(isTyped: boolean | "through any" | "as the first kind" | "as the first kind, through any" | "as the first kind, which never comes" | "as the first kind, which never comes, through any" = false, grain: "pair" | "many" | "use" = "pair", places = 256, ballast = grain === "use" ? 0 : 8) {
  const made: { name: string; file: string; readonly text: string }[] = [];
  // `n` is a number that the place of birth knows only when it runs.
  const births: Record<string, string> = {
    literal: "{ a: n, b: 2 }",
    otherOrder: "{ b: 2, a: n }",
    otherTypes: '{ a: "s" + n, b: 2.5 }',
    more: "{ z: 0, a: n, b: 2, c: 3 }",
    onlyB: "{ b: n }",
    sliced: '{ a: "abcdef".slice(n % 4), b: n }',
    empty: "{}",
    withMethod: "{ a: n, b: 2, sum() { return this.a + this.b; } }",
    nested: "{ a: { a: n, b: 2 }, b: [n, 2] }",
    getter: "{ get a() { return n + 7; }, b: 2 }",
    setter: "{ set a(to) { this.b = to; }, b: n }",
    symbolKey: "{ [key]: n, a: n, b: 2 }",
    indexed: '{ 0: "z", 1: n, a: n, length: 2 }',
    computed: '{ ["a"]: n, ["b" + ""]: 2 }',
    belowLiteral: "{ __proto__: { a: n, sum() { return 5; } }, b: 2 }",
    belowNull: "{ __proto__: null, a: n, b: 2 }",
    instance: "new Point(n, 2)",
    child: "new Point3(n, 2, 3)",
    fields: "new Fields(n)",
    old: "new Old(n, 2)",
    oldChild: "new OldChild(n, 2)",
    created: "Object.create({ a: n, sum() { return 5; } })",
    createdWith: "Object.create(Point.prototype, { a: { value: n, enumerable: true, writable: true, configurable: true }, b: { value: 2 } })",
    bare: "Object.create(null)",
    bareFilled: "Object.assign(Object.create(null), { a: n, b: 2 })",
    frozen: "Object.freeze({ a: n, b: 2 })",
    sealed: "Object.seal({ a: n, b: 2 })",
    closed: "Object.preventExtensions({ a: n, b: 2 })",
    frozenInstance: "Object.freeze(new Point(n, 2))",
    defined: 'Object.defineProperty({ b: 2 }, "a", { value: n })',
    definedGetter: 'Object.defineProperty({ b: 2 }, "a", { get() { return n + 3; }, enumerable: true })',
    proxy: "new Proxy({ a: n, b: 2 }, {})",
    proxyTraps: 'new Proxy({ a: n, b: 2 }, { get: (target, name) => (name === "a" ? 7 : target[name]), has: () => true, set: () => true, deleteProperty: () => true })',
    proxyOfInstance: "new Proxy(new Point(n, 2), {})",
    parsed: "JSON.parse('{\"a\":' + n + ',\"b\":2}')",
    parsedOther: "JSON.parse('{\"b\":\"x\",\"a\":null,\"n\":' + n + '}')",
    cloned: "structuredClone({ a: n, b: 2 })",
    spread: "{ ...{ a: n, b: 2 } }",
    spreadInstance: "{ ...new Point(n, 2) }",
    spreadAndMore: "{ ...source, a: source.a + n }",
    assigned: "Object.assign({}, { a: n, b: 2 })",
    assignedOnto: "Object.assign(new Point(0, 0), { a: n, b: 2 })",
    fromEntries: 'Object.fromEntries([["a", n], ["b", 2]])',
    shrunk: "shrink({ a: n, z: 0, b: 2 })",
    grown: "grow({}, n)",
    reparented: "Object.setPrototypeOf({ a: n, b: 2 }, Point.prototype)",
    constructedBelow: "Reflect.construct(Point, [n, 2], Old)",
    classValue: 'class { static a = n; static b = 2; static sum() { return this.a + this.b; } static toString() { return "a class"; } }',
    bag: "new Bag([n, 2])",
    dictionary: 'new Dictionary([["a", n], ["b", 2]])',
    walkedByGenerator: "{ a: n, b: 2, *[Symbol.iterator]() { yield this.a; yield this.b; }, *entries() { yield [0, this.a]; } }",
    ring: "ringOf(n)",
    sometimesMore: "new Sometimes(n)",
    locked: "new Locked(n)",
    shared: "source",
    sharedInstance: "origin",
    spreadOfNothing: "{ ...null, a: n, b: 2 }",
    parsedWithProtoKey: "JSON.parse('{\"__proto__\":{\"a\":1},\"b\":' + n + '}')",
    clonedInstance: "structuredClone(new Point(n, 2))",
    toPrimitive: "{ [Symbol.toPrimitive]() { return n; }, a: n, b: 2 }",
    withValueOf: "{ valueOf() { return n; }, a: n, b: 2 }",
    withToJSON: "{ toJSON() { return { j: n }; }, a: n, b: 2 }",
    tagged: '{ [Symbol.toStringTag]: "Tagged", a: n, b: 2 }',
    // What a built-in answers, and what it answers only now and then.
    iteratorResult: "[n, 2][Symbol.iterator]().next()",
    generatorResult: "(function* () { yield n; })().next()",
    groups: '/(?<a>\\d)(?<b>x)?/.exec("" + n).groups',
    descriptorOrNot: 'Object.getOwnPropertyDescriptor({ a: n }, n % 2 ? "a" : "z")',
    matchOrNot: '/(?<a>\\d)/.exec(n % 2 ? "x" + n : "x")',
    foundOrNot: "[{ a: n, b: 2 }].find(each => each.a % 2 === 1)",
    gotOrNot: "new Map([[1, { a: n, b: 2 }]]).get(n % 2)",
    grouped: 'Object.groupBy([n, 2], each => (each % 2 ? "a" : "b"))',
    restOfPattern: "(({ z, ...rest }) => rest)({ z: 0, a: n, b: 2 })",
    pathParsed: 'path.parse("/a/b" + n + ".c")',
    queryParsed: 'querystring.parse("a=" + n + "&b=2")',
    // What is no object of this family, and meets them in every program.
    ownError: 'new OwnError("m" + n)',
    aggregate: 'new AggregateError([n, 2], "m")',
    namespace: "path",
    url: 'new URL("http://a.example/b?a=" + n)',
    promise: "Promise.resolve(n)",
    generatorObject: "(function* () { yield n; })()",
    mathObject: "Math",
    error: 'new RangeError("r" + n)',
    date: "new Date(n)",
    pattern: "/a/g",
    boxedNumber: "Object(n)",
    boxedText: 'new String("ab" + n)',
    argumentsObject: "(function () { return arguments; })(n, 2)",
    nothing: "null",
    missing: "undefined",
    integer: "n",
    text: '"ab" + n',
    list: "[n, 2]",
    map: 'new Map([["a", n], ["b", 2]])',
    arrow: 'Object.assign(() => n, { toString() { return "an arrow"; } })',
    // Kinds that say what they are in a member.
    fine: "{ ok: true, value: n }",
    failed: '{ ok: false, error: "e" + n }',
    circle: '{ kind: "circle", r: n }',
    square: '{ kind: "square", side: n, a: n }',
    leaf: "{ a: n, next: null }",
    twoLinks: "{ a: n, next: { a: n + 1, next: null } }",
    // A class that declares nothing, and what lies below a class's prototype without having been constructed.
    emptyInstance: "new Empty()",
    createdEmpty: "Object.create(Empty.prototype)",
    filledEmpty: "Object.assign(Object.create(Empty.prototype), { a: n, b: 2 })",
    reparentedEmpty: "Object.setPrototypeOf({ a: n }, Empty.prototype)",
    belowEmpty: "{ __proto__: Empty.prototype, a: n }",
    createdPoint: "Object.create(Point.prototype)",
    createdFields: "Object.create(Fields.prototype)",
    // A member is added on one path only.
    sometimesGrown: "growSometimes({ a: n, b: 2 }, n)",
  };
  const record = "{ a: number; b: number }";
  const types: Record<string, string> = {
    literal: record, otherOrder: record, otherTypes: "{ a: string; b: number }", more: "{ z: number; a: number; b: number; c: number }", onlyB: "{ b: number }", sliced: "{ a: string; b: number }", empty: "{}",
    withMethod: "{ a: number; b: number; sum(): number }", nested: "{ a: { a: number; b: number }; b: number[] }", getter: "{ readonly a: number; b: number }", setter: record, symbolKey: "{ [key]: number; a: number; b: number }",
    indexed: "{ 0: string; 1: number; a: number; length: number }", computed: record, belowLiteral: "{ a: number; b: number; sum(): number }", belowNull: record, instance: "Point", child: "Point3", fields: "Fields",
    old: "{ a: number; b: number; sum(): number }", oldChild: "{ a: number; b: number; c: number; sum(): number }", created: "{ a: number; sum(): number }", createdWith: "Point", bare: "{}", bareFilled: record,
    frozen: "Readonly<{ a: number; b: number }>", sealed: record, closed: record, frozenInstance: "Readonly<Point>", defined: "{ readonly a: number; b: number }", definedGetter: "{ readonly a: number; b: number }", proxy: record,
    proxyTraps: record, proxyOfInstance: "Point", parsed: record, parsedOther: "{ b: string; a: null; n: number }", cloned: record, spread: record, spreadInstance: record, spreadAndMore: record, assigned: record,
    assignedOnto: "Point", fromEntries: "Record<string, number>", shrunk: record, grown: record, reparented: "Point", constructedBelow: "Point", classValue: "{ a: number; b: number; sum(): number }", bag: "Bag",
    dictionary: "Dictionary", walkedByGenerator: "{ a: number; b: number; [Symbol.iterator](): Generator<number>; entries(): Generator<[number, number]> }", nothing: "null", missing: "undefined", integer: "number",
    ring: "{ a: number; next: any }", sometimesMore: "Sometimes", locked: "Locked", shared: record, sharedInstance: "Point", spreadOfNothing: record, parsedWithProtoKey: "{ b: number }", clonedInstance: record,
    toPrimitive: "{ [Symbol.toPrimitive](): number; a: number; b: number }", withValueOf: "{ valueOf(): number; a: number; b: number }", withToJSON: "{ toJSON(): { j: number }; a: number; b: number }",
    tagged: "{ [Symbol.toStringTag]: string; a: number; b: number }", error: "RangeError", date: "Date", pattern: "RegExp", boxedNumber: "Number", boxedText: "String", argumentsObject: "IArguments",
    iteratorResult: "IteratorResult<number>", generatorResult: "IteratorResult<number>", groups: "Record<string, string> | undefined", descriptorOrNot: "PropertyDescriptor | undefined", matchOrNot: "RegExpExecArray | null",
    foundOrNot: "{ a: number; b: number } | undefined", gotOrNot: "{ a: number; b: number } | undefined",
    grouped: "Partial<Record<string, number[]>>", restOfPattern: record, pathParsed: "path.ParsedPath", queryParsed: "querystring.ParsedUrlQuery", ownError: "OwnError", aggregate: "AggregateError", namespace: "typeof path",
    url: "URL", promise: "Promise<number>", generatorObject: "Generator<number>", mathObject: "Math",
    fine: "{ ok: true; value: number }", failed: "{ ok: false; error: string }", circle: '{ kind: "circle"; r: number }', square: '{ kind: "square"; side: number; a: number }', leaf: "Link", twoLinks: "Link",
    emptyInstance: "Empty", createdEmpty: "Empty", filledEmpty: "Empty", reparentedEmpty: "Empty", belowEmpty: "Empty", createdPoint: "Point", createdFields: "Fields", sometimesGrown: "{ a: number; b: number; c?: () => number }",
    text: "string", list: "number[]", map: "Map<string, number>", arrow: "() => number",
  };
  const first = ["literal", "instance", "child", "fields", "old", "bare", "frozen", "proxy", "parsed", "spread", "getter", "nothing", "bag", "fine", "circle", "leaf", "emptyInstance", "sometimesGrown"];
  const groups: Record<string, Record<string, string>> = {
    reads: {
      a: "return v.a;",
      b: "return v.b;",
      both: "return v.a + v.b;",
      c: "return v.c;",
      nowhere: "return v.nowhere;",
      byKey: 'return v[n < 0 ? "b" : "a"];',
      optional: "return v?.a;",
      deep: "return v?.a?.a;",
      bySymbol: "return v[key];",
      byIndex: "return v[1];",
      twice: "return v.a === v.a ? v.b : v.a;",
      around: "return v.next.next === v;",
      valueAndDone: "return [v.value, v.done];",
      length: "return v.length;",
      size: "return v.size;",
      message: "return [v.message, v.name];",
      base: "return v.base;",
      reflected: 'return Reflect.get(v, "a");',
      descriptor: 'return Object.getOwnPropertyDescriptor(v, "a");',
    },
    calls: {
      sum: "return v.sum();",
      sumIfAny: "return v.sum?.();",
      accessor: "return v.twice;",
      toText: "return v.toString();",
      hasOwn: 'return v.hasOwnProperty("a");',
      maker: "return v.constructor.name;",
      itself: "return v.valueOf() === v;",
      borrowed: "return Point.prototype.sum.call(v);",
      hidden: "return Fields.prototype.sum.call(v);",
      ifCallable: 'return typeof v.sum === "function" ? v.sum() : -1;',
      ifPoint: "return v instanceof Point ? v.sum() : v.a;",
      again: 'if (v.constructor === Function) return "made by Function"; const w = new v.constructor(n, 3); return [w.a, w.b];',
      ofMember: "return v.a.toFixed(1);",
    },
    walks: {
      keys: "return Object.keys(v);",
      values: "return Object.values(v);",
      entries: "return Object.entries(v);",
      forIn: 'let t = ""; for (const name in v) t += name + "|"; return t;',
      json: "return JSON.stringify(v);",
      spread: "return { ...v };",
      spreadAndMore: "return { ...v, c: n };",
      assign: "return Object.assign({}, v);",
      names: "return Object.getOwnPropertyNames(v);",
      ownKeys: "return Reflect.ownKeys(v).map(String);",
      fill: "const r = []; for (const each of Object.entries(v)) r.push(each); return r;",
      count: "return Object.keys(v).length;",
      clone: "return structuredClone(v);",
      throughText: "return JSON.parse(JSON.stringify(v));",
      throughEntries: "return Object.fromEntries(Object.entries(v));",
      intoMap: 'return new Map(Object.entries(v)).get("a");',
      sumOfValues: 'let s = 0; for (const name of Object.keys(v)) s += typeof v[name] === "function" ? 1 : v[name]; return s;',
    },
    walksByItsOwnMethods: {
      fillFromEntries: "const r = []; for (const each of v.entries()) r.push(each); return r;",
      spreadOfEntries: "return [...v.entries()];",
      fillByForOf: "const r = []; for (const each of v) r.push(each); return r;",
      spreadOfIt: "return [...v];",
      firstTwo: "const [p, q] = v; return [p, q];",
      from: "return Array.from(v);",
    },
    tests: {
      typeOf: "return typeof v;",
      isPoint: "return v instanceof Point;",
      isPoint3: "return v instanceof Point3;",
      isOld: "return v instanceof Old;",
      isObject: "return v instanceof Object;",
      hasA: 'return "a" in v;',
      ownA: 'return Object.hasOwn(v, "a");',
      hasHidden: "return Fields.is(v);",
      isFrozen: "return Object.isFrozen(v);",
      isSealed: "return Object.isSealed(v);",
      isExtensible: "return Object.isExtensible(v);",
      below: "return Object.getPrototypeOf(v) === Point.prototype;",
      belowNothing: "return Object.getPrototypeOf(v) === null;",
      truth: "return v ? 1 : 0;",
      inThenRead: 'return "c" in v ? v.c : v.a;',
      byMember: "return v.b === 2 ? v.a : v.c;",
      madeByPoint: "return v.constructor === Point;",
      isNull: "return v === null;",
      isMissing: "return v === undefined;",
      thereThenRead: "return v !== null && v !== undefined ? v.a : -1;",
      sameAsAnother: "const w = { a: n, b: 2 }; return [v === w, v !== w, w === w];",
      isNothing: "return v == null;",
      tag: "return Object.prototype.toString.call(v);",
      byKind: 'if (v === null) return "null"; if (v instanceof Point3) return v.c; if (v instanceof Point) return v.b; if (typeof v === "object") return v.a; return typeof v;',
    },
    storesOfTheSameKind: {
      a: "v.a = 9; return [v.a, v.b];",
      add: "v.a += 1; return v.a;",
      increment: "v.a++; return v.a;",
      byKey: 'v[n < 0 ? "b" : "a"] = 9; return v.a;',
      both: "v.b = v.a; v.a = 3; return [v.a, v.b];",
      reflected: 'return [Reflect.set(v, "a", 9), v.a];',
      ifThere: "v.a &&= 3; return v.a;",
    },
    storesOfAnotherKind: {
      text: 'v.a = "s"; return [v.a, v.b];',
      fraction: "v.a = 0.5; return v.a + v.b;",
      object: "v.a = { a: n }; return v.a.a;",
      nothing: "v.b = null; return [v.a, v.b];",
    },
    storesOfNewMembers: {
      c: "v.c = n; return [v.c, Object.keys(v)];",
      bySymbol: "v[key] = n; return v[key];",
      byIndex: "v[1] = n; return [v[1], Object.keys(v)];",
      method: "v.sum = function () { return 11; }; return v.sum();",
      ifMissing: "v.c ??= n; return v.c;",
    },
    changes: {
      remove: "const r = delete v.a; return [r, v.a, Object.keys(v)];",
      removeWhatIsNotThere: "return [delete v.nowhere, v.a];",
      define: 'Object.defineProperty(v, "a", { value: 4, configurable: true }); return [v.a, Object.keys(v)];',
      defineGetter: 'Object.defineProperty(v, "a", { get() { return 6; }, configurable: true }); return v.a;',
      freeze: "Object.freeze(v); v.a = 5; return [v.a, Object.isFrozen(v)];",
      seal: "Object.seal(v); v.c = 5; delete v.a; return [v.a, v.c];",
      reparent: "Object.setPrototypeOf(v, { up: n, sum() { return 12; } }); return [v.up, v.a, v.sum()];",
      reparentToNothing: "Object.setPrototypeOf(v, null); return [v.a, v.sum];",
      assign: 'Object.assign(v, { a: "t", e: 1 }); return [v.a, v.e];',
    },
    patterns: {
      two: "const { a, b } = v; return [a, b];",
      withDefault: "const { a = 5, c = 6 } = v; return [a, c];",
      rest: "const { a, ...rest } = v; return [a, rest];",
      deep: "const { a: { a: deep } = { a: -1 } } = v; return deep;",
      byKey: 'const { [n < 0 ? "b" : "a"]: got } = v; return got;',
    },
    conversions: {
      text: "return String(v);",
      template: "return `${v}`;",
      plusText: 'return v + "";',
      plus: "return v + 1;",
      minus: "return v - 1;",
      less: "return v < 1;",
      looselySame: "return v == v.a;",
      same: "return v === v && Object.is(v, v);",
    },
    keeps: {
      inLiteral: "const box = { held: v }; return box.held.a;",
      inList: "const box = [v]; return box[0].a;",
      inClosure: "const read = () => v.a; return read();",
      copy: "const copy = { ...v, c: 3 }; return [copy.a, copy.c];",
      orElse: "const w = v ?? { a: -1, b: -2 }; return w.a;",
      orItsMember: 'const w = typeof v.a === "object" && v.a !== null ? v.a : v; return w.b;',
      inOneTurn: "let kept = null; for (let i = 0; i < 4; i++) if (i === n % 5) kept = { held: v, i }; return kept === null ? -1 : kept.held.a;",
      swapped: "let p = v, q = { a: -1, b: -2 }; for (let i = 0; i < n % 3; i++) [p, q] = [q, p]; return [p.a, q.b];",
    },
    // A second value, born at the use as one kind or the other ($A, $B), meets the first: four pairs of kinds at one place.
    withAnother: {
      both: "const w = n % 3 === 0 ? $B : $A; return [v.a, w.a, v === w];",
      inOneBox: "const w = n % 3 === 0 ? $B : $A; const box = { held: v, other: w }; return [box.held.a, box.other.a];",
      inEitherBox: "const w = n % 3 === 0 ? $B : $A; const box = n % 2 ? { held: v, other: w } : { held: w }; return [box.held.a, box.other?.a];",
      heldByTheOther: "const w = n % 3 === 0 ? $B : $A; w.c = v; return [w.c.a, w.a];",
      ring: "const w = n % 3 === 0 ? $B : $A; w.next = v; v.next = w; return [v.next.next === v, w.next.a];",
      merged: "const w = n % 3 === 0 ? $B : $A; return { ...v, ...w };",
      assigned: "const w = n % 3 === 0 ? $B : $A; return Object.assign({}, v, w);",
      swapped: "let p = v, q = n % 3 === 0 ? $B : $A; for (let i = 0; i < n % 4; i++) [p, q] = [q, p]; return [p.a, q.b];",
      chosen: "const w = n % 3 === 0 ? $B : $A; const x = n % 2 ? v : w; return [x.a, x.b];",
      copied: "const w = n % 3 === 0 ? $B : $A; w.a = v.a; v.b = w.b; return [v.a, v.b, w.a, w.b];",
    },
    // A member says which kind it is, and the other members are read behind a test of it.
    discriminants: {
      byOk: "return v.ok ? v.value : v.error;",
      byNotOk: "if (!v.ok) return v.error; return v.value + 1;",
      byOkIsTrue: "return v.ok === true ? v.value : v.ok === false ? v.error : v.a;",
      byKind: 'switch (v.kind) { case "circle": return v.r; case "square": return v.side; default: return v.a; }',
      byKindIs: 'if (v.kind === "circle") return v.r * 2; return v.side;',
      byKindIsNot: 'return v.kind !== "square" ? v.r : v.side + v.a;',
      byMemberThere: "return v.error !== undefined ? v.error : v.value;",
      byIn: 'return "r" in v ? v.r : "side" in v ? v.side : "value" in v ? v.value : v.a;',
      byTypeOfMember: 'return typeof v.a === "number" ? v.a + 1 : typeof v.a === "string" ? v.a.length : typeof v.a;',
      byNext: "return v.next === null ? v.a : v.next.a;",
      pattern: "const { ok, value, error } = v; return ok ? value : error;",
      remade: 'return v.ok ? { ok: true, value: v.value + 1 } : { ok: false, error: v.error + "!" };',
    },
    // A chain of objects whose end, or whose every link, is the value.
    chains: {
      walk: "let s = 0; for (let x = v, i = 0; x !== null && x !== undefined && i < 9; x = x.next, i++) s += x.a; return s;",
      walkByTruth: "let count = 0; for (let x = v; x && count < 9; x = x.next) count++; return count;",
      grownInFront: "let head = v; for (let i = 0; i < 3; i++) head = { a: i, next: head }; let s = 0; for (let x = head, i = 0; x && i < 9; x = x.next, i++) s += x.a; return s;",
      lastLink: "let x = v, i = 0; while (x.next && i++ < 9) x = x.next; return x.a;",
      keptLink: "let kept = null; for (let x = v, i = 0; x && i < 9; x = x.next, i++) if (x.a % 2 === 1) kept = x; return kept === null ? -1 : kept.a;",
      turnedRound: "let back = null; for (let x = v, i = 0; x && i < 9; x = x.next, i++) back = { a: x.a, next: back }; return back === null ? -1 : [back.a, back.next === null];",
      eitherEnd: "let head = n % 2 ? v : null; head = { a: -1, next: head }; return head.next === null ? head.a : head.next.a;",
    },
    // Only as TypeScript: what a program writes to tell the checker more than it knows. None of it does anything when the program runs.
    casts: {
      notNull: "return v!.a;",
      notNullCall: "return v!.sum();",
      asPoint: "return (v as Point).a + (v as Point).b;",
      asPointCall: "return (v as Point).sum();",
      asFields: "return (v as Fields).sum();",
      asRecord: "return (v as unknown as Record<string, unknown>).a;",
      asAny: "return (v as any).nowhere;",
      asAnyDeclared: "return (v as any).a;",
      asAnyStore: "(v as any).nowhere = n; return (v as any).nowhere;",
      asAnyCall: "return (v as any).sum?.();",
      thereThenAny: "if (v === null || v === undefined) return -1; return (v as any).nowhere;",
      predicate: "if (looksLikePoint(v)) return v.a + v.b; return -1;",
      predicateCall: "if (looksLikePoint(v)) return v.sum(); return -1;",
      assertion: "takeForPoint(v); return v.a + v.b;",
      heldAsPoint: "const point: Point = v as any; return [point.a, point.b];",
      handedAsPoint: "return sumOfPoint(v as any);",
    },
  };
  if (!isTyped) delete groups.casts;
  const head = `import * as path from "node:path";
import * as querystring from "node:querystring";
const only = process.argv[2];
function wanted(place) { return only === undefined || only === place; }
const key = Symbol("key");
const source = { a: 1, b: 2 };
class Point { constructor(a, b) { this.a = a; this.b = b; } sum() { return this.a + this.b; } get twice() { return this.a * 2; } }
class Point3 extends Point { constructor(a, b, c) { super(a, b); this.c = c; } sum() { return super.sum() + this.c; } }
class Fields { a = 1; b = "x"; #hidden = 5; constructor(a) { this.a = a; } sum() { return this.#hidden + this.a; } static is(o) { return #hidden in o; } }
function Old(a, b) { this.a = a; this.b = b; }
Old.prototype.sum = function () { return this.a + this.b; };
function OldChild(a, b) { Old.call(this, a, b); this.c = 3; }
OldChild.prototype = Object.create(Old.prototype, { constructor: { value: OldChild, writable: true, configurable: true } });
class Bag { constructor(list) { this.list = list; this.a = list[0]; } entries() { return this.list.entries(); } [Symbol.iterator]() { return this.list[Symbol.iterator](); } sum() { return this.list.length; } }
class Dictionary { constructor(pairs) { this.map = new Map(pairs); this.a = pairs[0][1]; } entries() { return this.map.entries(); } [Symbol.iterator]() { return this.map[Symbol.iterator](); } sum() { return this.map.size; } }
class Sometimes { constructor(a) { this.a = a; if (a % 2) this.c = 3; this.b = 2; } sum() { return this.a + this.b; } }
class Locked { constructor(a) { this.a = a; this.b = 2; Object.freeze(this); } sum() { return this.a + this.b; } }
class OwnError extends Error { a = 1; b = 2; }
class Empty {}
const origin = new Point(1, 2);
function ringOf(n) { const one = { a: n, next: null }, other = { a: n + 1, next: one }; one.next = other; return one; }
function shrink(o) { delete o.z; return o; }
function grow(o, n) { o.a = n; o.b = 2; return o; }
function growSometimes(o, n) { if (n % 2) o.c = function () { return n; }; return o; }
function show(v, depth = 0) { if (v === null) return "null"; if (Array.isArray(v)) { if (depth > 3) return "[..]"; let t = "["; for (let i = 0; i < v.length; i++) t += (i ? "," : "") + (i in v ? show(v[i], depth + 1) : "hole"); return t + "]#" + v.length; } if (typeof v === "object") { if (depth > 3) return "{..}"; let t = "{"; for (const k of Object.keys(v)) t += k + ":" + show(v[k], depth + 1) + ","; return t + "}"; } if (typeof v === "function") return "function"; if (typeof v === "symbol") return "symbol"; return typeof v + ":" + (Object.is(v, -0) ? "-0" : String(v)); }
`;
  const headTyped = `import * as path from "node:path";
import * as querystring from "node:querystring";
const only: string | undefined = process.argv[2];
function wanted(place: string): boolean { return only === undefined || only === place; }
const key = Symbol("key");
const source = { a: 1, b: 2 };
class Point { a: number; b: number; constructor(a: number, b: number) { this.a = a; this.b = b; } sum(): number { return this.a + this.b; } get twice(): number { return this.a * 2; } }
class Point3 extends Point { c: number; constructor(a: number, b: number, c: number) { super(a, b); this.c = c; } sum(): number { return super.sum() + this.c; } }
class Fields { a = 1; b = "x"; #hidden = 5; constructor(a: number) { this.a = a; } sum(): number { return this.#hidden + this.a; } static is(o: any): boolean { return #hidden in o; } }
function Old(this: any, a: number, b: number) { this.a = a; this.b = b; }
Old.prototype.sum = function () { return this.a + this.b; };
function OldChild(this: any, a: number, b: number) { Old.call(this, a, b); this.c = 3; }
OldChild.prototype = Object.create(Old.prototype, { constructor: { value: OldChild, writable: true, configurable: true } });
class Bag { list: number[]; a: number; constructor(list: number[]) { this.list = list; this.a = list[0]; } entries() { return this.list.entries(); } [Symbol.iterator]() { return this.list[Symbol.iterator](); } sum(): number { return this.list.length; } }
class Dictionary { map: Map<string, number>; a: number; constructor(pairs: [string, number][]) { this.map = new Map(pairs); this.a = pairs[0][1]; } entries() { return this.map.entries(); } [Symbol.iterator]() { return this.map[Symbol.iterator](); } sum(): number { return this.map.size; } }
class Sometimes { a: number; b: number; c?: number; constructor(a: number) { this.a = a; if (a % 2) this.c = 3; this.b = 2; } sum(): number { return this.a + this.b; } }
class Locked { a: number; b: number; constructor(a: number) { this.a = a; this.b = 2; Object.freeze(this); } sum(): number { return this.a + this.b; } }
class OwnError extends Error { a = 1; b = 2; }
class Empty {}
type Link = { a: number; next: Link | null };
function looksLikePoint(o: unknown): o is Point { return typeof o === "object" && o !== null && "a" in o; }
function takeForPoint(o: unknown): asserts o is Point {}
function sumOfPoint(point: Point): number { return point.a + point.b; }
const origin = new Point(1, 2);
function ringOf(n: number) { const one: { a: number; next: any } = { a: n, next: null }, other = { a: n + 1, next: one }; one.next = other; return one; }
function shrink(o: { a: number; z?: number; b: number }) { delete o.z; return o; }
function grow(o: any, n: number): { a: number; b: number } { o.a = n; o.b = 2; return o; }
function growSometimes(o: { a: number; b: number; c?: () => number }, n: number) { if (n % 2) o.c = function () { return n; }; return o; }
` + head.slice(head.indexOf("function show(")).replace("function show(v, depth = 0)", "function show(v: any, depth: number = 0): string");
  const show = (isTyped ? headTyped : head).slice((isTyped ? headTyped : head).indexOf("function show("));
  const ballasts: Record<number, string> = {};
  const runOnce = (count: number) => (ballasts[count] ??= Array.from({ length: count }, (_, k) => show.replace("function show(", `function runsOnce${k + 1}(`) + `runsOnce${k + 1}(${k + 1});\n`).join(""));
  const N = isTyped ? "n: number" : "n";
  const as = (name: string, type: string) => (isTyped ? `${name}: ${type}` : name);
  const attempt = (u: string, call: string, parameters: string) => `function attempt_${u}(${parameters}) { try { return show(${call}); } catch (e) { return "threw " + (e && e.name); } }\n`;
  // What runs a place stands behind a test of the program's first argument: a program that dies can be asked for each of its places alone.
  const given = (u: string, a: string, b: string) => `if (wanted("${u}")) {
last = "";
for (let n = 0; n < 1000; n++) last = attempt_${u}(${a}, n);
console.log("${u}", last);
for (let n = 0; n < 3; n++) console.log(attempt_${u}(${b}, n));
for (let n = 5; n < 6; n++) console.log(attempt_${u}(${a}, n));
}
`;
  const called = (u: string, calls: number, behind = "") => `if (wanted("${u}")) {
last = "";
for (let n = 0; n < ${calls}; n++) { last = attempt_${u}(n); if (n < 12 || n === 27) console.log("${u}", n, last); }
console.log(last);
${behind}}
`;
  // u: the name of the place; a, b: the two births; t: what the value is declared as
  const roads: Record<string, (u: string, use: string, a: string, b: string, t: string) => string> = {
    handed: (u, use, a, b, t) => `function use_${u}(${as("v", t)}, ${N}) { ${use} }\n` + attempt(u, `use_${u}(v, n)`, `${as("v", t)}, ${N}`) + given(u, a, b),
    member: (u, use, a, b, t) => `class Holder_${u} { ${isTyped ? `held: ${t}; ` : ""}constructor(${as("held", t)}) { this.held = held; } }\nfunction use_${u}(${as("v", t)}, ${N}) { ${use} }\nfunction ask_${u}(${as("holder", "Holder_" + u)}, ${N}) { return use_${u}(holder.held, n); }\n` + attempt(u, `ask_${u}(new Holder_${u}(v), n)`, `${as("v", t)}, ${N}`) + given(u, a, b),
    property: (u, use, a, b, t) => `function use_${u}(${as("v", t)}, ${N}) { ${use} }\nfunction ask_${u}(${as("holder", `{ held_${u}: ${t}; n: number }`)}, ${N}) { return use_${u}(holder.held_${u}, n); }\n` + attempt(u, `ask_${u}({ held_${u}: v, n }, n)`, `${as("v", t)}, ${N}`) + given(u, a, b),
    hidden: (u, use, a, b, t) => `class Keeper_${u} { ${as("#held", t)}; constructor(${as("held", t)}) { this.#held = held; } ask(${N}) { const v = this.#held; ${use} } }\n` + attempt(u, `new Keeper_${u}(v).ask(n)`, `${as("v", t)}, ${N}`) + given(u, a, b),
    either: (u, use, a, b) => `function main_${u}(${N}) { const v = n % 10 === 7 ? ${b} : ${a}; ${use} }\n` + attempt(u, `main_${u}(n)`, N) + called(u, 1000),
    oneTurn: (u, use, a, b, t) => `function main_${u}(${N}) { let ${as("v", t)} = ${a}; for (let i = 0; i < 100; i++) { const made = ${b}; if (i === 77 && n % 4 !== 3) v = made; } ${use} }\n` + attempt(u, `main_${u}(n)`, N) + called(u, 30),
    maker: (u, use, a, b, t) => `function make_${u}(${N}, ${as("keep", "boolean")}) { const made = ${b}; if (keep) return made; return n + 1; }
function main_${u}(${N}) { let total = 0, ${as("v", t)} = ${a}; for (let i = 0; i < 200; i++) { const result = make_${u}(i, i === 177 && n % 4 !== 3); if (typeof result === "number") total += result; else v = result; } ${use} }
` + attempt(u, `main_${u}(n)`, N) + `function replace_${u}() { make_${u} = new Proxy(make_${u}, {}); }\n` + called(u, 30, `if (last === "") replace_${u}();\n`),
    returned: (u, use, a, b, t) => `const ${as("kept_" + u, `(${t})[]`)} = [];
function keep_${u}(${as("v", t)}) { try { for (let i = 0; i < 2; i++) if (kept_${u}.length < 6 + i) kept_${u}.push(v); } catch { kept_${u}.length = 0; } }
function make_${u}(${N}) { if (n % 3 === 0) return ${b}; return ${a}; }
function main_${u}(${N}) { const v = make_${u}(n); if (n % 7 === 0) keep_${u}(v); ${use} }
` + attempt(u, `main_${u}(n)`, N) + called(u, 1000, `try { console.log(show(kept_${u})); } catch (e) { console.log("cannot be shown", e && e.name); }\n`),
    thrown: (u, use, a, b) => `function main_${u}(${N}) { try { throw n % 10 === 7 ? ${b} : ${a}; } catch (v) { ${use} } }\n` + attempt(u, `main_${u}(n)`, N) + called(u, 1000),
    captured: (u, use, a, b, t) => `function main_${u}(${N}) { let ${as("v", t)} = ${a}; const look = () => { ${use} }; if (n % 10 === 7) v = ${b}; return look(); }\n` + attempt(u, `main_${u}(n)`, N) + called(u, 1000),
    element: (u, use, a, b, t) => `function use_${u}(${as("v", t)}, ${N}) { ${use} }\nfunction main_${u}(${N}) { const all = [${a}, ${b}], ${as("answers", "unknown[]")} = []; for (const v of all) { try { answers.push(use_${u}(v, n)); } catch (e) { answers.push("threw " + (e && e.name)); } } return answers; }\n` + attempt(u, `main_${u}(n)`, N) + called(u, 1000),
    acrossCatch: (u, use, a, b, t) => `function fails_${u}(${N}) { if (n % 3 === 1) throw new Error("fails"); return n; }\nfunction main_${u}(${N}) { let ${as("v", t)} = ${a}; try { if (n % 10 === 7 || n % 10 === 2) v = ${b}; fails_${u}(n); } catch { n++; } ${use} }\n` + attempt(u, `main_${u}(n)`, N) + called(u, 1000),
    acrossYield: (u, use, a, b) => `function* steps_${u}(${N}) { const v = n % 10 === 7 ? ${b} : ${a}; yield n; ${use} }\nfunction main_${u}(${N}) { const steps = steps_${u}(n); steps.next(); return steps.next().value; }\n` + attempt(u, `main_${u}(n)`, N) + called(u, 1000),
    acrossAwait: (u, use, a, b) => `async function main_${u}(${N}) { const v = n % 10 === 7 ? ${b} : ${a}; await null; ${use} }\n` + attempt(u, `await main_${u}(n)`, N).replace("function", "async function") + called(u, 1000).replace("last = attempt_", "last = await attempt_"),
    defaulted: (u, use, a, b, t) => `function use_${u}(${N}, ${as("v", t)} = ${a}) { ${use} }\nfunction main_${u}(${N}) { return use_${u}(n, n % 10 === 7 ? ${b} : undefined); }\n` + attempt(u, `main_${u}(n)`, N) + called(u, 1000),
    rest: (u, use, a, b, t) => `function use_${u}(${N}, ...${as("all", `(${t})[]`)}) { const v = all[0]; ${use} }\nfunction main_${u}(${N}) { return n % 10 === 7 ? use_${u}(n, ${b}) : use_${u}(n, ${a}, n); }\n` + attempt(u, `main_${u}(n)`, N) + called(u, 1000),
    receiver: (u, use, a, b, t) => `function use_${u}(${isTyped ? `this: ${t}, ` : ""}${N}) { const v = this; ${use} }\nfunction main_${u}(${N}) { return use_${u}.call(n % 10 === 7 ? ${b} : ${a}, n); }\n` + attempt(u, `main_${u}(n)`, N) + called(u, 1000),
    variable: (u, use, a, b, t) => `let ${as("current_" + u, `${t} | null`)} = null;\nfunction set_${u}(${N}) { current_${u} = n % 10 === 7 ? ${b} : ${a}; }\nfunction main_${u}(${N}) { set_${u}(n); const v = current_${u}; ${use} }\n` + attempt(u, `main_${u}(n)`, N) + called(u, 1000),
    large: (u, use, a, b, t) => `const kept_${u}${isTyped ? `: (${t})[]` : ""} = [], seen_${u}${isTyped ? ": number[]" : ""} = [];
function keep_${u}(${as("v", t)}) { try { for (let i = 0; i < 2; i++) if (kept_${u}.length < 6 + i) kept_${u}.push(v); } catch { kept_${u}.length = 0; } }
function make_${u}(${N}) { try { for (let i = 0; i < 2; i++) if (seen_${u}.length < 3 + i) seen_${u}.push(n); } catch { seen_${u}.length = 0; } if (n % 3 === 0) return ${b}; return ${a}; }
function main_${u}(${N}) { const v = make_${u}(n); if (n % 7 === 0) keep_${u}(v); ${use} }
` + attempt(u, `main_${u}(n)`, N) + called(u, 1000, `try { console.log(show(kept_${u})); } catch (e) { console.log("cannot be shown", e && e.name); }\n`),
    largeAndJoined: (u, use, a, b, t) => `const seen_${u}${isTyped ? ": number[]" : ""} = [];
function make_${u}(${N}) { try { for (let i = 0; i < 2; i++) if (seen_${u}.length < 3 + i) seen_${u}.push(n); } catch { seen_${u}.length = 0; } let ${as("made", t)} = ${a}; if (n % 3 === 0) made = ${b}; return made; }
function main_${u}(${N}) { const v = make_${u}(n); ${use} }
` + attempt(u, `main_${u}(n)`, N) + called(u, 1000),
    onlyTheSecond: (u, use, a, b, t) => `let ${as("current_" + u, `${t} | null`)} = null;\nfunction main_${u}(${N}) { const v = current_${u}; if (v === null) return "nothing"; ${use} }\nfunction set_${u}(${N}) { current_${u} = n % 10 === 3 ? null : ${b}; }\n` + attempt(u, `(set_${u}(n), main_${u}(n))`, N) + called(u, 1000),
    onlyTheSecondCaptured: (u, use, a, b, t) => `function main_${u}(${N}) { let ${as("held", `${t} | undefined`)} = undefined; const look = () => { const v = held; if (v === undefined) return "nothing"; ${use} }; if (n % 10 !== 3) held = ${b}; return look(); }\n` + attempt(u, `main_${u}(n)`, N) + called(u, 1000),
    aroundTheLoop: (u, use, a, b, t) => `function use_${u}(${as("v", t)}, ${N}) { ${use} }\nfunction main_${u}(${N}) { const ${as("answers", "unknown[]")} = []; let ${as("v", `${t} | null`)} = null; for (let i = 0; i < 7; i++) { if (v !== null) { try { answers.push(use_${u}(v, n)); } catch (e) { answers.push("threw " + (e && e.name)); } } v = i % 3 === 0 ? ${a} : i % 3 === 1 ? ${b} : null; } return answers; }\n` + attempt(u, `main_${u}(n)`, N) + called(u, 300),
  };
  // Where many second kinds stand in one program: a program that freezes an instance, replaces a prototype or deletes a member tells the compiler so about every object of that class or shape in it: those births
  // stand apart from the ones that do nothing of the kind.
  const wild = ["getter", "setter", "symbolKey", "indexed", "belowLiteral", "belowNull", "created", "createdWith", "bare", "bareFilled", "frozen", "sealed", "closed", "frozenInstance", "defined", "definedGetter", "proxy", "proxyTraps", "proxyOfInstance", "assignedOnto", "shrunk", "reparented", "constructedBelow", "classValue", "walkedByGenerator", "locked", "parsedWithProtoKey", "toPrimitive", "withValueOf", "withToJSON", "tagged", "error", "date", "pattern", "boxedNumber", "boxedText", "argumentsObject", "grouped", "pathParsed", "queryParsed", "ownError", "aggregate", "namespace", "url", "promise", "generatorObject", "mathObject", "createdEmpty", "filledEmpty", "reparentedEmpty", "belowEmpty", "createdPoint", "createdFields"];
  // The groups that stand in programs of their own: all that change something, and those that came later.
  const changing = ["storesOfTheSameKind", "storesOfAnotherKind", "storesOfNewMembers", "changes", "withAnother", "discriminants", "chains", "casts"];
  const grouped: Record<string, Record<string, string>> = {};
  for (const [g, uses] of Object.entries(groups))
    for (const [u, use] of Object.entries(uses)) (grouped[grain === "use" ? g + "_" + u : changing.includes(g) ? g : "looks"] ??= {})[g + "_" + u] = use;
  // And so do those whose members are of other types, or that are no objects: without them the members a and b of a literal are integers all over the program.
  const mixed = ["otherTypes", "sliced", "nested", "parsedOther", "integer", "text", "list", "map", "arrow", "iteratorResult", "generatorResult", "groups", "descriptorOrNot", "matchOrNot", "foundOrNot", "gotOrNot"];
  const cast = (use: string) => (typeof isTyped === "string" && isTyped.endsWith("through any") ? use.replace(/\b([vwxpq]|head|kept|back)(?=\.|\[|\?\.)/g, "($1 as any)") : use);
  const comes = (a: string, b: string) => (typeof isTyped === "string" && isTyped.includes("never comes") ? b : a);
  const inBrackets = (birth: string) => (birth.startsWith("{") ? `(${birth})` : birth);
  // A place: the road, the second kind, the use.
  const add = (name: string, a: string, uses: Record<string, string>, ofRoads: string[], seconds: string[]) => {
    const list = () => ofRoads.flatMap(r => seconds.filter(b => a !== b && !(r === "maker" && b === "integer")).flatMap(b => Object.keys(uses).map(u => [r, b, u])));
    const count = list().length;
    for (let from = 0, part = 1; from < count; from += places, part++)
      made.push({
        name: name + (count > places ? "-" + part : ""),
        file: isTyped ? "program.ts" : "program.mjs",
        // There are three million places: the text of a program is made when it is asked for.
        get text() {
          const some = list().slice(from, from + places);
          let text = (isTyped ? headTyped : head) + 'let last = "";\n' + runOnce(ballast * some.length);
          for (const [r, b, u] of some) text += roads[r](grain === "many" ? u + "_" + b : grain === "pair" ? u + "_" + r : u, cast(uses[u]).replaceAll("$A", () => inBrackets(births[comes(a, b)])).replaceAll("$B", () => inBrackets(births[b])), inBrackets(births[comes(a, b)]), inBrackets(births[b]), isTyped === true || isTyped === "through any" ? `${types[a]} | ${types[b].includes("=>") ? `(${types[b]})` : types[b]}` : types[a]);
          return isTyped ? text.replace(/^/gm, "// @ts-ignore\n").replace(/\/\/ @ts-ignore\n$/, "") + "export {};\n" : text;
        },
      });
  };
  const sets = { tame: Object.keys(births).filter(b => !wild.includes(b) && !mixed.includes(b)), mixed, wild };
  for (const [g, uses] of Object.entries(grouped))
    for (const a of first) {
      if (grain === "pair") for (const b of Object.keys(births)) add(`${g}-${a}-${b}`, a, uses, Object.keys(roads), [b]);
      else if (grain === "many") for (const r of Object.keys(roads)) for (const [name, set] of Object.entries(sets)) add(`${g}-${a}-${name}-${r}`, a, uses, [r], set);
      else for (const r of Object.keys(roads)) for (const b of Object.keys(births)) add(`${g}-${a}-${b}-${r}`, a, uses, [r], [b]);
    }
  return made;
}
