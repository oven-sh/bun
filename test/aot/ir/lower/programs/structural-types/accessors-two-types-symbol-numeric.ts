// RUN: lower
// OPTIONS: builtin-modules

// Accessors of two types under symbol numeric computed and private names.
function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "bigint") return "bigint " + String(value);
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(text).join(", ") + "]";
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

const key = Symbol("size");
const spelled = "computed";

class Box {
  kept = 1;
  get [key](): number {
    return this.kept;
  }
  set [key](value: number | string) {
    this.kept = typeof value === "string" ? value.length : value;
  }
  get [spelled](): number {
    return this.kept * 10;
  }
  set [spelled](value: number | string) {
    this.kept = typeof value === "string" ? value.length * 10 : value;
  }
  get 0(): number {
    return this.kept * 100;
  }
  set 0(value: number | string) {
    this.kept = typeof value === "string" ? value.length * 100 : value;
  }
  get "two words"(): number {
    return this.kept * 1000;
  }
  set "two words"(value: number | string) {
    this.kept = typeof value === "string" ? value.length * 1000 : value;
  }
  get #hidden(): number {
    return this.kept + 0.5;
  }
  set #hidden(value: number | string) {
    this.kept = typeof value === "string" ? -value.length : value;
  }
  hidden(value: number | string): unknown {
    this.#hidden = value;
    const first = this.#hidden;
    this.#hidden += 1;
    this.#hidden++;
    return [first, this.#hidden, this.kept];
  }
  static #shared = 1;
  static get #count(): number {
    return Box.#shared;
  }
  static set #count(value: number | string) {
    Box.#shared = typeof value === "string" ? value.length : value;
  }
  static count(value: number | string): unknown {
    Box.#count = value;
    return [Box.#count, (Box.#count += 1)];
  }
}

attempt("a symbol key", () => {
  const b = new Box();
  const store = (value: number | string): void => {
    b[key] = value;
  };
  store("four");
  const first = b[key];
  b[key] = b[key] + 1;
  b[key] = b[key] + 1;
  return [first, b[key], b.kept];
});
attempt("a computed name", () => {
  const b = new Box();
  const store = (value: number | string): void => {
    b[spelled] = value;
  };
  store("four");
  const first = b.computed;
  b.computed += 1;
  return [first, b[spelled], b.kept];
});
attempt("a numeric name", () => {
  const b = new Box();
  b[0] = "four";
  const first = b[0];
  b["0"] = 2;
  return [first, b[0], b.kept];
});
attempt("a quoted name", () => {
  const b = new Box();
  const store = (value: number | string): void => {
    b["two words"] = value;
  };
  store("four");
  const first = b["two words"];
  b["two words"] = b["two words"] - 1;
  return [first, b["two words"], b.kept];
});
attempt("a private name, a string", () => new Box().hidden("four"));
attempt("a private name, a number", () => new Box().hidden(4));
attempt("a static private name", () => [Box.count("four"), Box.count(1)]);
attempt("own keys", () => Reflect.ownKeys(new Box()).map(String));
attempt("keys of the prototype", () => Reflect.ownKeys(Box.prototype).map(String));
let sum = 0;
const shared = new Box();
for (let i = 0; i < 2000; i++) {
  shared[key] = i % 2 === 0 ? i : "ab";
  sum += shared[key] + shared[0];
}
console.log("2000 rounds: " + sum);

// GENERATED: Box #count
// CHECK-LABEL: function {{*}}name="Box"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_2]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="#count"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number site=[[w_3]]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="Box"
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v3 = StrictEq v1, v2
// CHECK-NEXT: Branch v3 -> taken b2(), notTaken b5()
// CHECK-NEXT: b2():
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v5 = TypeTest v4 testedType=absent
// CHECK-NEXT: Branch v5 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v6) frequency=Unlikely:
// CHECK-NEXT: v7 = NewRuntimeError runtimeError=InvalidPrivateRead
// CHECK-NEXT: Throw v7
// CHECK-NEXT: b4(v8):
// CHECK-NEXT: v9 = Convert v8 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: Return v9
// CHECK-NEXT: b5() frequency=Unlikely:
// CHECK-NEXT: v10 = NewRuntimeError runtimeError=InvalidPrivateRead
// CHECK-NEXT: Throw v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="#count"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Setter flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="Box"
// CHECK-NEXT: v3 = TypeTest v0 testedType=string
// CHECK-NEXT: Branch v3 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string} illTypedCause=Assertion
// CHECK-NEXT: v6 = PropGet v5 key="length"
// CHECK-NEXT: v7 = Convert v6 declared={type=number site=[[w_8]]} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b6(v7)
// CHECK-NEXT: b4(v8):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v9 = Convert v8 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b6(v9)
// CHECK-NEXT: b6(v10):
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v12 = StrictEq v2, v11
// CHECK-NEXT: Branch v12 -> taken b7(), notTaken b10()
// CHECK-NEXT: b7():
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v14 = TypeTest v13 testedType=absent
// CHECK-NEXT: Branch v14 -> taken b8(| 0), notTaken b9(| 0)
// CHECK-NEXT: b8(v15) frequency=Unlikely:
// CHECK-NEXT: v16 = NewRuntimeError runtimeError=InvalidPrivateWrite
// CHECK-NEXT: Throw v16
// CHECK-NEXT: b9(v17):
// CHECK-NEXT: v18 = Convert v10 declared={type=number site=[[w_9]]}
// CHECK-NEXT: PutModuleVariable v18 variable=[[g_6]]
// CHECK-NEXT: v20 = Undefined
// CHECK-NEXT: Return v20
// CHECK-NEXT: b10() frequency=Unlikely:
// CHECK-NEXT: v21 = NewRuntimeError runtimeError=InvalidPrivateWrite
// CHECK-NEXT: Throw v21
// CHECK-NEXT: }
