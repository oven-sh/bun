// RUN: lower
// OPTIONS: builtin-modules

// Text run by a direct eval in a class body reads, stores, tests and calls the private members of objects that compiled code created, and compiled code sees what the text stored.
function attempt(action: () => unknown): string {
  try {
    return JSON.stringify(action()) ?? "undefined";
  } catch (error) {
    return (error as Error).name;
  }
}

class Vault {
  #x = 1;
  #anything: unknown = "initial";
  label = "vault";
  static #count = 0;
  #m(): string {
    return "m sees " + this.#x;
  }
  get #a(): number {
    return this.#x * 10;
  }
  set #a(value: number) {
    this.#x = value / 10;
  }
  static #s(): string {
    return "s sees " + Vault.#count;
  }

  run(text: string, o?: unknown, v?: unknown): unknown {
    return eval(text);
  }
  static run(text: string, o?: unknown, v?: unknown): unknown {
    return eval(text);
  }
  runInArrow(text: string, o?: unknown, v?: unknown): unknown {
    return (() => eval(text))();
  }
  readConstantText(): unknown {
    return eval("this.#x");
  }
  storeConstantText(v: number): unknown {
    return eval("this.#x = v");
  }
  hasConstantText(o: unknown): unknown {
    return eval("#x in o");
  }
  callConstantText(): unknown {
    return eval("this.#m()");
  }

  compiled(): string {
    return [this.#x, JSON.stringify(this.#anything), this.#m(), this.#a, this.label].join(" ");
  }
  storeCompiled(value: number): void {
    this.#x = value;
  }
  static hasCompiled(o: object): string {
    return [#x in o, #anything in o, #m in o, #a in o].join();
  }
  static countCompiled(): string {
    return Vault.#count + " " + Vault.#s();
  }
}
class SafeBox extends Vault {
  extra = "subclass";
}
class Other {
  #x = "x of another class";
  read(): string {
    return this.#x;
  }
}

function exercise(kind: string, create: () => Vault): void {
  const vault = create();
  console.log(kind);
  console.log("  read:", attempt(() => vault.run("this.#x")), attempt(() => vault.run("this.#anything")), attempt(() => vault.run("o.#x", vault)), attempt(() => vault.runInArrow("this.#x")));
  console.log("  compiled after the read:", attempt(() => vault.compiled()), Vault.hasCompiled(vault));
  console.log("  store:", attempt(() => vault.run("this.#x = v", null, 2)), attempt(() => vault.compiled()));
  console.log("  store:", attempt(() => vault.run("o.#x = v", vault, 3)), attempt(() => vault.runInArrow("this.#x = v + 1", null, 3)), attempt(() => vault.compiled()));
  console.log("  update:", attempt(() => vault.run("this.#x += v", null, 5)), attempt(() => vault.run("this.#x++")), attempt(() => vault.run("--this.#x")), attempt(() => vault.compiled()));
  console.log("  other types:", ["text", 1.5, null, [1, 2], { k: 1 }, true].map(value => attempt(() => vault.run("this.#anything = v", null, value)) + " " + attempt(() => vault.compiled())).join(" | "));
  vault.storeCompiled(6);
  console.log("  read after a compiled store:", attempt(() => vault.run("this.#x")), attempt(() => vault.run("this.#m()")), attempt(() => vault.run("this.#a")));
  console.log("  in:", attempt(() => vault.run("[#x in o, #anything in o, #m in o, #a in o]", vault)), attempt(() => vault.run("#x in this")));
  console.log("  call:", attempt(() => vault.run("this.#m()")), attempt(() => vault.run("o.#m()", vault)), attempt(() => vault.run("this.#m.call(o)", create())), attempt(() => vault.run("this.#m === o.#m", create())));
  console.log("  accessor:", attempt(() => vault.run("this.#a")), attempt(() => vault.run("this.#a = v", null, 70)), attempt(() => vault.compiled()));
  console.log("  not allowed:", attempt(() => vault.run("this.#m = v", null, 1)), attempt(() => vault.run("delete this.label")), attempt(() => vault.compiled()), Vault.hasCompiled(vault));
  console.log("  constant text:", attempt(() => vault.readConstantText()), attempt(() => vault.storeConstantText(8)), attempt(() => vault.hasConstantText(vault)), attempt(() => vault.callConstantText()), attempt(() => vault.compiled()));
}

exercise("instance", () => new Vault());
exercise("instance of a subclass", () => new SafeBox());
exercise("instance with an added property", () => Object.assign(new Vault(), { added: 1 }));
exercise("frozen instance", () => {
  const vault = new Vault();
  Object.freeze(vault);
  return vault;
});
exercise("sealed instance", () => Object.seal(new Vault()));
exercise("instance used by compiled code first", () => {
  const vault = new Vault();
  vault.storeCompiled(1);
  vault.compiled();
  return vault;
});

const probe = new Vault();
const otherValues: [string, unknown][] = [
  ["plain object", {}],
  ["instance of another class", new Other()],
  ["object that inherits from an instance", Object.create(new Vault())],
  ["proxy of an instance", new Proxy(new Vault(), {})],
  ["the class", Vault],
  ["array", [1]],
  ["function", () => 1],
];
for (const [kind, otherValue] of otherValues) {
  console.log(`${kind}:`, attempt(() => probe.run("#x in o", otherValue)), attempt(() => probe.run("#m in o", otherValue)), attempt(() => probe.run("o.#x", otherValue)), attempt(() => probe.run("o.#x = v", otherValue, 1)), attempt(() => probe.run("o.#m()", otherValue)), attempt(() => probe.run("o.#a", otherValue)));
}
for (const primitive of [1, "text", null, undefined, true, 1n]) {
  console.log(`${typeof primitive}:`, attempt(() => probe.run("#x in o", primitive)), attempt(() => probe.run("o.#x", primitive)), attempt(() => probe.run("o.#m()", primitive)));
}

console.log("static:", attempt(() => Vault.run("Vault.#count")), attempt(() => Vault.run("this.#count = v", null, 4)), Vault.countCompiled());
console.log("static:", attempt(() => Vault.run("Vault.#count++")), attempt(() => Vault.run("this.#s()")), attempt(() => Vault.run("[#count in Vault, #s in Vault, #count in o, #x in Vault]", new Vault())), Vault.countCompiled());
console.log("static through a subclass:", attempt(() => SafeBox.run("this.#count")), attempt(() => SafeBox.run("Vault.#count")), attempt(() => SafeBox.run("this.#s()")), attempt(() => SafeBox.run("#count in this")));
console.log("from an instance method:", attempt(() => probe.run("Vault.#count = v", null, 9)), attempt(() => probe.run("Vault.#s()")), Vault.countCompiled());

const many: Vault[] = [];
for (let i = 0; i < 200; i++) many.push(i % 2 ? new SafeBox() : new Vault());
let sum = 0;
for (let i = 0; i < many.length; i++) {
  if (i % 3 === 0) many[i].run("this.#x = v", null, i);
  sum += many[i].run("this.#x") as number;
  many[i].storeCompiled(i % 7);
  sum += many[i].run("#m in this ? this.#x : -1000") as number;
}
console.log("200 objects:", sum, new Other().read());

export {};

// GENERATED: #a #s runInArrow hasCompiled SafeBox
// CHECK-LABEL: function {{*}}name="#a"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_1]] site=[[w_2]]} results=[{type=number site=[[w_3]]}] {
// CHECK-NEXT: b0(v0: [[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v2 = PrivateGet v0, v1 layout=[[L_1]] field=1
// CHECK-NEXT: v3 = Integer integer=10
// CHECK-NEXT: v4 = Mul v2, v3
// CHECK-NEXT: v5 = Convert v4 declared={type=number site=[[w_3]]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="#a"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Setter flags=[HasThis, IsChecked, HasExplicitName] length=1 thisType={type=[[L_1]] site=[[w_5]]} parameters=[{type=number site=[[w_6]]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_1]], v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Integer integer=10
// CHECK-NEXT: v3 = Div v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_7]]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: PrivateSet v0, v5, v4 layout=[[L_1]] field=1
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="#s"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="s sees "
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="Vault"
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v4 = StrictEq v2, v3
// CHECK-NEXT: Branch v4 -> taken b2(), notTaken b5()
// CHECK-NEXT: b2():
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v6 = TypeTest v5 testedType=absent
// CHECK-NEXT: Branch v6 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v7) frequency=Unlikely:
// CHECK-NEXT: v8 = NewRuntimeError runtimeError=InvalidPrivateRead
// CHECK-NEXT: Throw v8
// CHECK-NEXT: b4(v9):
// CHECK-NEXT: v10 = Convert v9 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: v11 = Add v0, v10
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v12
// CHECK-NEXT: b5() frequency=Unlikely:
// CHECK-NEXT: v13 = NewRuntimeError runtimeError=InvalidPrivateRead
// CHECK-NEXT: Throw v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="runInArrow"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasArgumentCount, HasHiddenRest, IsChecked, HasExplicitName] length=3 thisType={type=[[L_1]] site=[[w_12]]} parameters=[{type=undefined|null|string site=[[w_13]] flags=[OmitsNull, OmitsUndefined]}, {type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_1]], v1: int[0, 4294967295], v2: undefined|null|string, v3: anything, v4: anything, v5: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v6 = CreateUnmappedArguments v1, v5, v2, v3, v4
// CHECK-NEXT: v7 = NewObject -, v2, v3, v4 layout=[[L_14]] fields=[0, 1, 2]
// CHECK-NEXT: v8 = NewClosure v7, v0, v6, v6 function=[[f_15]]
// CHECK-NEXT: v9 = Call v8
// CHECK-NEXT: ReturnCall v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="hasCompiled"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|object site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_17]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v2 = PrivateHas v0, v1 layout=[[L_1]] field=1
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v4 = PrivateHas v0, v3 layout=[[L_1]] field=2
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v6 = PrivateHas v0, v5 layout=[[L_1]]
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v8 = PrivateHas v0, v7 layout=[[L_1]]
// CHECK-NEXT: v9 = NewArray v2, v4, v6, v8 contents=boolean
// CHECK-NEXT: v10 = PropGet v9 key="join"
// CHECK-NEXT: v11 = Call v10, v9 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v11 casts=[{declared={type=undefined|null|string site=[[w_18]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_17]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="SafeBox"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_19]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_20]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_20]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_21]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
