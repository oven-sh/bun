// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 1

// FILE: main.js
function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

function attempt(label, run) {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

/** @returns {number} */
function text() {
  return "7";
}

/** @returns {number} */
function nothing() {}

/** @returns {number} */
function nil() {
  return null;
}

/** @returns {number} */
const list = () => [7];

/** @returns {string} */
function count() {
  return 7;
}

/** @returns {{ x: number, y: number }} */
function texts() {
  return { y: "2", x: "1" };
}

/** @returns {{ x: number, y: number }} */
function partial() {
  return { x: 1 };
}

/** @returns {{ x: number, y: number }} */
function pair() {
  return [1, 2];
}

/** @returns {number[]} */
function like() {
  return { length: 2, 0: 1, 1: 2 };
}

/** @returns {number[]} */
function letters() {
  return "12";
}

/** @returns {() => number} */
function maker() {
  return () => "made";
}

/** @returns {() => number} */
function noMaker() {
  return 5;
}

/** @returns {boolean} */
function one() {
  return 1;
}

/** @returns {void} */
function something() {
  return "something";
}

/**
 * @param {number} n
 * @returns {number}
 */
function sometimes(n) {
  return n % 1000 === 999 ? "late" : n;
}

/** @returns {Promise<number>} */
async function later() {
  return "later";
}

/** @returns {Promise<number>} */
function notAPromise() {
  return 7;
}

/** @returns {Generator<number>} */
function* yields() {
  yield "a";
  yield null;
  yield 3;
}

class Source {
  /** @returns {number} */
  get value() {
    return "got";
  }
  /** @returns {number} */
  method() {
    return "called";
  }
  /** @returns {Source} */
  static make() {
    return { value: 1, method: () => 2 };
  }
  /** @returns {this} */
  chain() {
    return "not this";
  }
}

/** @param {number} n */
function plusOne(n) {
  return n + 1;
}

attempt("a text for a number", () => [text(), typeof text(), text() + 1, text() * 2, plusOne(text()), [1, 2, 3, 4, 5, 6, 7, 8][text()]]);
attempt("nothing for a number", () => [nothing(), nothing() + 1, plusOne(nothing()), nothing() === undefined]);
attempt("null for a number", () => [nil(), nil() + 1, plusOne(nil())]);
attempt("a list for a number", () => [list() + 1, list() * 2, typeof list()]);
attempt("a number for a text", () => [count() + 1, count() + "!", count().length]);
attempt("a number for a text, a method", () => count().toUpperCase());
attempt("texts in a point", () => [texts().x + texts().y, Object.keys(texts()).join()]);
attempt("a point without y", () => [partial().x + partial().y, "y" in partial()]);
attempt("a list for a point", () => [pair().x, pair().length, pair()[0]]);
attempt("an array-like for a list", () => [like().length, like()[1], Array.isArray(like())]);
attempt("an array-like for a list, a method", () => like().map(plusOne));
attempt("a text for a list", () => [letters().length, letters()[0] + 1, [...letters()]]);
attempt("a text for a list, a method", () => letters().map(plusOne));
attempt("a maker of texts", () => [maker()(), maker()() + 1]);
attempt("no maker", () => noMaker()());
attempt("one for true", () => [one() === true, one() ? "truthy" : "falsy", one() + 1]);
attempt("something for void", () => [something(), something() + "!", something() === undefined]);
attempt("a result that changes after 999 calls", () => {
  let total = 0;
  for (let i = 0; i < 1002; i++) total += sometimes(i);
  return [typeof total, total.length];
});
attempt("a getter, a method, a static method, this", () => [new Source().value + 1, new Source().method() + 1, Source.make().value + 1, Source.make().method(), Source.make() instanceof Source, new Source().chain()]);
attempt("this, chained", () => new Source().chain().method());
attempt("yielded", () => [...yields()].map(plusOne));

const awaited = await later();
attempt("awaited", () => [awaited, awaited + 1]);
const direct = await notAPromise();
attempt("awaited what is no promise", () => [direct + 1, typeof notAPromise()]);
attempt("then of what is no promise", () => notAPromise().then(plusOne));

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true, "checkJs": false }, "files": [] }

// GENERATED: sometimes yields later Source make
// CHECK-LABEL: function {{*}}name="sometimes"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number flags=[IsExpected]}] results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer integer=1000
// CHECK-NEXT: v2 = Mod v0, v1
// CHECK-NEXT: v3 = Integer integer=999
// CHECK-NEXT: v4 = StrictEq v2, v3
// CHECK-NEXT: Branch v4 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v5 = String string="late"
// CHECK-NEXT: Jump -> next b4(v5)
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b4(v0)
// CHECK-NEXT: b4(v6):
// CHECK-NEXT: v7 = Convert v6 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="yields"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, TakesCallee, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Generator<number> flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything, v1: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v3 = String string="a"
// CHECK-NEXT: v4 = Convert v3 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v5 = Yield v4
// CHECK-NEXT: v6 = ResultAt v5
// CHECK-NEXT: v7 = ResultAt v5 index=1
// CHECK-NEXT: Switch v7 cases=[1, 2] -> case b2(), case b3(), otherwise b4()
// CHECK-NEXT: b2():
// CHECK-NEXT: Throw v6
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v6
// CHECK-NEXT: b4():
// CHECK-NEXT: v8 = Null
// CHECK-NEXT: v9 = Convert v8 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v10 = Yield v9
// CHECK-NEXT: v11 = ResultAt v10
// CHECK-NEXT: v12 = ResultAt v10 index=1
// CHECK-NEXT: Switch v12 cases=[1, 2] -> case b5(), case b6(), otherwise b7()
// CHECK-NEXT: b5():
// CHECK-NEXT: Throw v11
// CHECK-NEXT: b6():
// CHECK-NEXT: Return v11
// CHECK-NEXT: b7():
// CHECK-NEXT: v13 = Integer integer=3
// CHECK-NEXT: v14 = Convert v13 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v15 = Yield v14
// CHECK-NEXT: v16 = ResultAt v15
// CHECK-NEXT: v17 = ResultAt v15 index=1
// CHECK-NEXT: Switch v17 cases=[1, 2] -> case b8(), case b9(), otherwise b10()
// CHECK-NEXT: b8():
// CHECK-NEXT: Throw v16
// CHECK-NEXT: b9():
// CHECK-NEXT: Return v16
// CHECK-NEXT: b10():
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="later"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Promise<number> flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string="later"
// CHECK-NEXT: v2 = Convert v1 declared={type=number|object flags=[IsExpected]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Source"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="make"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v2 = NewObject layout=[[L_3]]
// CHECK-NEXT: PropDefine v2, v1 key="value"
// CHECK-NEXT: v4 = NewClosure function=[[f_4]]
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: PropDefine v2, v5 key="method"
// CHECK-NEXT: v7 = FinishObject v2
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
