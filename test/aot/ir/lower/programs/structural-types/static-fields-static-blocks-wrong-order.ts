// RUN: lower
// OPTIONS: builtin-modules

// Static fields and static blocks in the wrong order.
function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

const log: string[] = [];

class Config {
  static first: number = Config.readSecond();
  static firstPlusOne: number = Config.readSecond() + 1;
  static firstText: string = Config.readLabel();
  static keysSoFar: string = Object.keys(Config).join("+");
  static {
    log.push("block one: second " + typeof Config.readSecond() + " " + Config.readSecond());
    log.push("block one: label " + typeof Config.readLabel());
    log.push("block one: own second " + Object.hasOwn(Config, "second"));
  }
  static second: number = 2;
  static label: string = "label";
  static {
    log.push("block two: second " + typeof Config.readSecond() + " " + Config.readSecond());
    log.push("block two: label " + Config.readLabel());
  }
  static third: number = Config.readSecond();
  static never: number;
  static neverText: string;
  static neverList: number[];
  static readSecond(): number {
    return Config.second;
  }
  static readLabel(): string {
    return Config.label;
  }
}

for (const entry of log) console.log(entry);
show("first", () => Config.first);
show("firstPlusOne", () => Config.firstPlusOne);
show("firstText", () => Config.firstText);
show("keysSoFar", () => Config.keysSoFar);
show("second", () => Config.second);
show("third", () => Config.third);
show("never", () => Config.never);
show("never + 1", () => Config.never + 1);
show("never | 0", () => Config.never | 0);
show("neverText", () => Config.neverText);
show("neverText.length", () => Config.neverText.length);
show("neverList", () => Config.neverList);
show("neverList.length", () => Config.neverList.length);
show("own never", () => Object.hasOwn(Config, "never"));
show("keys", () => Object.keys(Config).join());

function makeEarly(): string {
  try {
    return String(new Registry().id);
  } catch (error) {
    return error instanceof Error ? error.constructor.name : typeof error;
  }
}
class Registry {
  static early: string = makeEarly();
  static instance: Registry = new Registry();
  static next: number = 100;
  id: number = Registry.next++;
}
show("an instance made by a function in a static initializer", () => Registry.early);
show("an instance made before the counter is set: id", () => Registry.instance.id);
show("typeof", () => typeof Registry.instance.id);
show("next", () => Registry.next);
show("an instance made afterwards", () => new Registry().id);
show("next", () => Registry.next);

class Parent {
  static kind: string = "parent";
  static describe(): string {
    return this.kind + " " + this.size();
  }
  static size(): number {
    return 0;
  }
  static described: string = Parent.describe();
}
class Child extends Parent {
  static described: string = Child.describe();
  static kind: string = "child";
  static width: number = 4;
  static size(): number {
    return this.width;
  }
  static describedAgain: string = Child.describe();
}
show("parent", () => Parent.described);
show("child, too early", () => Child.described);
show("child, in time", () => Child.describedAgain);

// GENERATED: makeEarly Registry describe size Child
// CHECK-LABEL: function {{*}}name="makeEarly"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v0 = Builtin builtin=String
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="Registry"
// CHECK-NEXT: v3 = Construct v2 calleeName="Registry"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_2]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=UnprovenCallee
// CHECK-NEXT: v5 = PropGet v4 key="id"
// CHECK-NEXT: v6 = Call v0, -, v5 calleeName="String"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Return v7
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v8 = CatchValue
// CHECK-NEXT: v9 = Builtin builtin=GlobalThis
// CHECK-NEXT: v10 = PropGet v9 key="Error" [isFreeName]
// CHECK-NEXT: v11 = Convert v10 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v12 = InstanceOf v8, v11
// CHECK-NEXT: v13 = ToBoolean v12
// CHECK-NEXT: Branch v13 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v14):
// CHECK-NEXT: v15 = PropGet v8 key="constructor"
// CHECK-NEXT: v16 = PropGet v15 key="name"
// CHECK-NEXT: Jump -> next b5(v16)
// CHECK-NEXT: b4(v17):
// CHECK-NEXT: v18 = TypeOf v8
// CHECK-NEXT: Jump -> next b5(v18)
// CHECK-NEXT: b5(v19):
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v20
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Registry"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_2]]}
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_3]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="describe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=function flags=[IsExpected]} results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: function):
// CHECK-NEXT: v1 = PropGet v0 key="kind"
// CHECK-NEXT: v2 = String string=" "
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = PropGet v0 key="size"
// CHECK-NEXT: v5 = Call v4, v0 calleeKey="size" calleeName="this.size"
// CHECK-NEXT: v6 = Add v3, v5
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="size"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Integer
// CHECK-NEXT: v1 = Convert v0 declared={type=number}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Child"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_5]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_5]]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="size"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=function flags=[IsExpected]} results=[{type=number}] {
// CHECK-NEXT: b0(v0: function):
// CHECK-NEXT: v1 = PropGet v0 key="width"
// CHECK-NEXT: v2 = Convert v1 declared={type=number}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
