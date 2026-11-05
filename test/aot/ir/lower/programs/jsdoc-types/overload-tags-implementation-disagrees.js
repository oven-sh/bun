// RUN: lower
// OPTIONS: builtin-modules

/**
 * @param {unknown} value
 * @returns {string}
 */
function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

/**
 * @param {string} label
 * @param {() => unknown} run
 */
function attempt(label, run) {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

class Animal {
  legs = 4;
}

class Dog extends Animal {
  name = "rex";
  /** @returns {string} */
  bark() {
    return this.name + "!";
  }
}

/**
 * @overload
 * @param {number} value
 * @returns {number}
 */
/**
 * @overload
 * @param {string} value
 * @returns {string}
 */
/**
 * @param {number | string} value
 * @returns {number | string}
 */
function crossed(value) {
  return typeof value === "number" ? String(value) : value.length;
}

/**
 * @overload
 * @param {"dog"} kind
 * @returns {Dog}
 */
/**
 * @overload
 * @param {"animal"} kind
 * @returns {Animal}
 */
/**
 * @param {string} kind
 * @returns {Animal}
 */
function make(kind) {
  return new Animal();
}

/**
 * @overload
 * @param {number} a
 * @returns {number}
 */
/**
 * @overload
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
/**
 * @param {number} a
 * @param {number} [b]
 * @returns {number | undefined}
 */
function maybe(a, b) {
  return b === undefined ? undefined : a + b;
}

/**
 * @overload
 * @param {number[]} list
 * @returns {number}
 */
/**
 * @overload
 * @param {string[]} list
 * @returns {string}
 */
/**
 * @param {(number | string)[]} list
 * @returns {number | string}
 */
function first(list) {
  return list[0];
}

class Reader {
  /**
   * @overload
   * @param {number} key
   * @returns {number}
   */
  /**
   * @overload
   * @param {string} key
   * @returns {string}
   */
  /**
   * @param {number | string} key
   * @returns {number | string}
   */
  read(key) {
    return typeof key === "number" ? "n" + key : key.length;
  }
}

/**
 * @param {number} n
 * @returns {number}
 */
function plusOne(n) {
  return n + 1;
}

/**
 * @param {string} s
 * @returns {number}
 */
function size(s) {
  return s.length;
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += plusOne(i) + size("ab") + maybe(i, 1) + first([i]);
console.log("2000 honest rounds: " + warm);

attempt("a number is promised and a text comes", () => [crossed(5), typeof crossed(5), crossed(5) + 1, plusOne(crossed(5)), crossed(5) * 2]);
attempt("a text is promised and a number comes", () => [crossed("ab"), typeof crossed("ab"), crossed("ab") + "!"]);
attempt("a text is promised and a number comes, its size", () => size(crossed("ab")));
attempt("a text is promised and a number comes, a method", () => crossed("ab").toUpperCase());
attempt("a dog is promised and an animal comes, a field", () => [make("dog").legs, make("dog").name, make("dog").name + "?", make("dog") instanceof Dog]);
attempt("a dog is promised and an animal comes, a method", () => make("dog").bark());
attempt("a number is promised and nothing comes", () => [maybe(1), maybe(1) + 1, plusOne(maybe(1)), maybe(1, 2)]);
attempt("the first of an empty list", () => [first([]), plusOne(first(/** @type {number[]} */ ([])))]);
attempt("a method", () => [new Reader().read(1), new Reader().read(1) + 1, new Reader().read("ab"), new Reader().read("ab") + "!"]);
attempt("in fields and lists", () => {
  const holder = { n: crossed(5), s: crossed("ab") };
  /** @type {number[]} */
  const numbers = [1, crossed(5)];
  let total = 0;
  for (const n of numbers) total += n;
  return [holder.n + 1, holder.s + "!", total];
});

export {};

// GENERATED: first attempt Reader Dog
// CHECK-LABEL: function {{*}}name="first"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<undefined|null|number|string> flags=[IsExpected]}] results=[{type=undefined|null|number|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<undefined|null|number|string>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = ElemGet v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|number|string flags=[IsExpected]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|[[f_1]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=" -> "
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v10 = Call v1 calleeName="run"
// CHECK-NEXT: v11 = Call v9, -, v10 calleeName="show"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v13 = Add v8, v12
// CHECK-NEXT: v14 = Call v6, v4, v13 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v15 = CatchValue
// CHECK-NEXT: v16 = Builtin builtin=GlobalThis
// CHECK-NEXT: v17 = PropGet v16 key="console" [isFreeName]
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v19 = PropGet v18 key="log"
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v21 = String string=" threw "
// CHECK-NEXT: v22 = Add v0, v21
// CHECK-NEXT: v23 = Builtin builtin=GlobalThis
// CHECK-NEXT: v24 = PropGet v23 key="Error" [isFreeName]
// CHECK-NEXT: v25 = Convert v24 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v26 = InstanceOf v15, v25 writtenExpression="error instanceof Error"
// CHECK-NEXT: v27 = ToBoolean v26
// CHECK-NEXT: Branch v27 -> taken b5(| 0), notTaken b7(| 0)
// CHECK-NEXT: b5(v28):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v29 = Convert v15 declared={type=undefined|null|Error flags=[IsExpected]}
// CHECK-NEXT: v30 = PropGet v29 key="constructor"
// CHECK-NEXT: v31 = Convert v30 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v32 = PropGet v31 key="name"
// CHECK-NEXT: v33 = Convert v32 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b9(v33)
// CHECK-NEXT: b7(v34):
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: v35 = TypeOf v15
// CHECK-NEXT: Jump -> next b9(v35)
// CHECK-NEXT: b9(v36):
// CHECK-NEXT: v37 = Add v22, v36
// CHECK-NEXT: v38 = Call v20, v18, v37 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v39 = Undefined
// CHECK-NEXT: Return v39
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Reader"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_3]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_3]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_3]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Dog"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_5]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_5]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_6]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
