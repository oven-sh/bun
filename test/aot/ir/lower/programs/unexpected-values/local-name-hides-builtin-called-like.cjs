// RUN: lower
// OPTIONS: builtin-modules

// A local name hides a built in that is called like a function.
function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "a function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) return "[" + Array.from(value, (item, i) => (i in value ? show(item) : "hole")).join(", ") + "]";
  return Object.prototype.toString.call(value).slice(8, -1) + " " + JSON.stringify(value);
}

const log = [];

function attempt(label, run) {
  log.length = 0;
  let line;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + ":", line + (log.length ? ", log " + log.join(" ") : ""));
}

function largest(Math) {
  return Math.max(1, 2);
}

function rounded(Math, n) {
  return Math.floor(n);
}

function isList(Array, value) {
  return Array.isArray(value);
}

function madeList(Array) {
  return new Array(3).length;
}

function parsed(parseInt) {
  return parseInt("12px");
}

function keys(Object, value) {
  return Object.keys(value);
}

function text(String, value) {
  return String(value);
}

function number(Number, value) {
  return Number(value);
}

function encoded(JSON, value) {
  return JSON.stringify(value);
}

function applied(Reflect, f) {
  return Reflect.apply(f, null, [1, 2]);
}

function resolved(Promise) {
  return typeof Promise.resolve(1);
}

function evaluated(eval) {
  const hidden = "local";
  return eval("typeof hidden");
}

function printed(console) {
  return console.log("printed through the parameter");
}

function honest(round) {
  console.log(round, largest(Math), rounded(Math, 1.5), isList(Array, []), madeList(Array), parsed(parseInt), show(keys(Object, { a: 1 })), text(String, 1), number(Number, "1"), encoded(JSON, [1]), applied(Reflect, (a, b) => a + b), resolved(Promise), evaluated(eval));
}

honest("before");
attempt("another Math", () => largest({ max: (...list) => "mine " + list.join() }));
attempt("a Math without max", () => largest({}));
attempt("a heir of Math that overrides max", () => largest(Object.create(Math, { max: { value: () => "the heir's" } })));
attempt("a proxy of Math", () => largest(new Proxy(Math, { get: (target, key) => (log.push(String(key)), target[key]) })));
attempt("another floor", () => rounded({ floor: n => "mine " + n }, 1.5));
attempt("undefined for Math", () => largest(undefined));
attempt("another Array", () => [isList({ isArray: () => "mine" }, []), madeList(function (n) { this.length = "mine " + n; })]);
attempt("a subclass for Array", () => [isList(class extends Array { static isArray() { return "the subclass's"; } }, []), madeList(class extends Array {})]);
attempt("another parseInt", () => parsed(value => "mine " + value));
attempt("parseFloat for parseInt", () => parsed(parseFloat));
attempt("another Object", () => keys({ keys: () => "mine" }, { a: 1 }));
attempt("Reflect for Object", () => keys({ keys: Reflect.ownKeys }, [1]));
attempt("another String", () => text(value => "mine " + value, 1));
attempt("Symbol for String", () => typeof text(Symbol, 1));
attempt("another Number", () => number(value => "mine " + value, "1"));
attempt("BigInt for Number", () => number(BigInt, "1"));
attempt("another JSON", () => encoded({ stringify: () => "mine" }, [1]));
attempt("another Reflect", () => applied({ apply: () => "mine" }, () => 0));
attempt("another Promise", () => resolved({ resolve: () => "mine" }));
attempt("another eval", () => evaluated(source => "mine " + source));
attempt("eval under another name is indirect", () => { const other = eval; const hidden = "local"; return other("typeof hidden"); });
attempt("another console", () => printed({ log: value => "mine " + value }));

{
  const Math = { max: () => "a const in a block", PI: "pie" };
  const parseInt = () => "a const in a block";
  const isNaN = () => "a const in a block";
  attempt("names declared in a block", () => [Math.max(1, 2), Math.PI, parseInt("1"), isNaN(1)]);
}
attempt("outside the block", () => [Math.max(1, 2), Math.PI > 3, parseInt("1"), isNaN(1)]);

function hoisted() {
  const before = typeof Math;
  var Math = { max: () => "a var in the function" };
  return [before, Math.max(1, 2)];
}

function declared() {
  return [Array.isArray([]), Array.name];
  function Array() {}
}

function caught() {
  try {
    throw { max: () => "the caught value" };
  } catch (Math) {
    return Math.max(1, 2);
  }
}

function classNamed() {
  class Map {
    get(key) {
      return "a class named Map " + key;
    }
  }
  return new Map().get(1);
}

function destructured({ Math, JSON: { stringify } }) {
  return [Math.max(1, 2), stringify([1])];
}

function looped() {
  const out = [];
  for (const Math of [{ max: () => "first" }, { max: () => "second" }]) out.push(Math.max(1, 2));
  return out;
}

attempt("a var hoisted over Math", hoisted);
attempt("a function declaration named Array", declared);
attempt("a catch parameter named Math", caught);
attempt("a class named Map", classNamed);
attempt("destructured parameters", () => destructured({ Math: { max: () => "destructured" }, JSON: { stringify: () => "destructured" } }));
attempt("a loop variable named Math", looped);
attempt("a default that reads the outer name", () => ((max = Math.max, Math = { max: () => "inner" }) => [max(1, 2), Math.max(1, 2)])());
attempt("methods taken off and called", () => { const { max } = Math; const { isArray } = Array; const { keys } = Object; return [max(1, 2), isArray([]), keys({ a: 1 })]; });
attempt("methods taken off that need their receiver", () => { const { resolve } = Promise; return resolve(1); });
attempt("methods of an array taken off", () => { const { push } = []; return push(1); });
honest("after");

// GENERATED: evaluated looped Map floor
// CHECK-LABEL: function {{*}}name="evaluated"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasThis, HasNewTarget, TakesCallee, HasArgumentCount, HasHiddenRest, HasExplicitName] length=1 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: anything, v2: function, v3: anything, v4: int[0, 4294967295], v5: undefined|null|function, v6: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v7 = CreateMappedArguments v2, v4, v6, v5
// CHECK-NEXT: v8 = ToThis v1
// CHECK-NEXT: v9 = NewObject layout=[[L_3]]
// CHECK-NEXT: v10 = Null
// CHECK-NEXT: SetLiteralPrototype v9, v10
// CHECK-NEXT: v12 = FinishObject v9
// CHECK-NEXT: v13 = NewObject -, v7 layout=[[L_4]] fields=[0]
// CHECK-NEXT: v14 = String string="local"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|"local" flags=[IsExpected]}
// CHECK-NEXT: v16 = GetMappedArgument v7
// CHECK-NEXT: v17 = String string="typeof hidden"
// CHECK-NEXT: v18 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v19 = StrictEq v16, v18
// CHECK-NEXT: Branch v19 -> taken b2(), notTaken b3(| 0)
// CHECK-NEXT: b2():
// CHECK-NEXT: v20 = DirectEval v17, v8, v3, v7, v15, v0, v12, v13 evalScope=e0
// CHECK-NEXT: Jump -> next b4(v20)
// CHECK-NEXT: b3(v21):
// CHECK-NEXT: v22 = Call v21, -, v17 calleeName="eval"
// CHECK-NEXT: Jump -> next b4(v22)
// CHECK-NEXT: b4(v23):
// CHECK-NEXT: Return v23
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="looped"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Data data=[[d_6]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|Array<never> flags=[IsExpected]}
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v3 = NewClosure function=[[f_7]]
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[f_8]]|[[f_9]]|[[f_10]] flags=[IsExpected]}
// CHECK-NEXT: v5 = NewObject layout=[[L_11]]
// CHECK-NEXT: PropDefine v5, v4 key="max"
// CHECK-NEXT: v7 = FinishObject v5
// CHECK-NEXT: v8 = NewClosure function=[[f_12]]
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|[[f_8]]|[[f_9]]|[[f_10]] flags=[IsExpected]}
// CHECK-NEXT: v10 = NewObject layout=[[L_11]]
// CHECK-NEXT: PropDefine v10, v9 key="max"
// CHECK-NEXT: v12 = FinishObject v10
// CHECK-NEXT: v13 = NewArray v7, v12 contents=undefined|null|[[L_11]]
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|Array<undefined|null|[[L_11]]> flags=[IsExpected]}
// CHECK-NEXT: v15 = IteratorOpen v14
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v17 = IteratorResume v15
// CHECK-NEXT: v18 = ResultAt v17
// CHECK-NEXT: v19 = ResultAt v17 index=1
// CHECK-NEXT: Branch v18 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v20 = Convert v2 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: Return v20
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b6():
// CHECK-NEXT: v21 = Convert v19 declared={type=undefined|null|[[L_11]] flags=[IsExpected]}
// CHECK-NEXT: v22 = PropGet v2 key="push"
// CHECK-NEXT: v23 = Convert v22 declared={type=undefined|null|[[f_13]] flags=[IsExpected]}
// CHECK-NEXT: v24 = PropGet v21 key="max"
// CHECK-NEXT: v25 = Convert v24 declared={type=undefined|null|[[f_10]] flags=[IsExpected]}
// CHECK-NEXT: v26 = Integer integer=1
// CHECK-NEXT: v27 = Integer integer=2
// CHECK-NEXT: v28 = Call v25, v21, v26, v27 calleeKey="max" calleeName="Math.max"
// CHECK-NEXT: v29 = Convert v28 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v30 = Call v23, v2, v29 calleeKey="push" calleeName="out.push"
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b6() role=IterationCleanup subject=v15:
// CHECK-NEXT: v31 = CatchException
// CHECK-NEXT: IteratorClose v15 completion=Throw
// CHECK-NEXT: Rethrow v31
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Map"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_14]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_14]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_14]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="floor"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_15]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string="mine "
// CHECK-NEXT: v2 = Add v1, v0
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
