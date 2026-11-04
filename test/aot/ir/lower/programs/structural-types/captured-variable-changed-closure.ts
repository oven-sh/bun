// RUN: lower
// OPTIONS: builtin-modules

// A captured variable is changed by a closure after narrowing.
function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

class Dog {
  legs = 4;
  bark(): number {
    return this.legs * 2;
  }
}

function numberOrText(change: boolean): number {
  let v: number | string = 1;
  const spoil = () => {
    v = "text";
  };
  if (typeof v === "number") {
    if (change) spoil();
    return v + 1;
  }
  return -1;
}

function dogOrNull(change: boolean): number {
  let d: Dog | null = new Dog();
  const clear = () => {
    d = null;
  };
  if (d !== null) {
    if (change) clear();
    return d.legs;
  }
  return -1;
}

function dogOrNullCalled(change: boolean): number {
  let d: Dog | null = new Dog();
  const clear = () => {
    d = null;
  };
  if (d) {
    if (change) clear();
    return d.bark();
  }
  return -1;
}

function listOrNothing(change: boolean): number {
  let list: number[] | undefined = [1, 2, 3];
  const drop = () => {
    list = undefined;
  };
  if (list !== undefined) {
    let sum = 0;
    for (let i = 0; i < 3; i++) {
      if (change && i === 1) drop();
      sum += list[i];
    }
    return sum;
  }
  return -1;
}

function functionOrNothing(change: boolean): number {
  let f: (() => number) | undefined = () => 5;
  const drop = () => {
    f = undefined;
  };
  if (f) {
    if (change) drop();
    return f() + 1;
  }
  return -1;
}

function assignedLater(read: boolean): number {
  let n: number;
  const peek = () => n + 1;
  const early = read ? peek() : 0;
  n = 1;
  return early + peek();
}

let moduleValue: number | string = 1;
function spoilModule(): void {
  moduleValue = "module text";
}
function readModule(change: boolean): number {
  moduleValue = 1;
  if (typeof moduleValue === "number") {
    if (change) spoilModule();
    return moduleValue + 1;
  }
  return -1;
}

function everything(label: string, change: boolean): void {
  attempt(label + " number or text", () => numberOrText(change));
  attempt(label + " dog or null: field", () => dogOrNull(change));
  attempt(label + " dog or null: method", () => dogOrNullCalled(change));
  attempt(label + " list or nothing", () => listOrNothing(change));
  attempt(label + " function or nothing", () => functionOrNothing(change));
  attempt(label + " assigned later", () => assignedLater(change));
  attempt(label + " module variable", () => readModule(change));
}

everything("honest", false);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += numberOrText(false) + dogOrNull(false) + dogOrNullCalled(false) + listOrNothing(false) + functionOrNothing(false) + assignedLater(false) + readModule(false);
console.log("2000 honest rounds", warm);
everything("changed", true);
everything("honest again", false);

// GENERATED: dogOrNullCalled Dog bark spoil peek
// CHECK-LABEL: function {{*}}name="dogOrNullCalled"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=boolean}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: boolean):
// CHECK-NEXT: v1 = NewObject layout=[[L_1]]
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="Dog"
// CHECK-NEXT: v4 = Construct v3 calleeName="Dog"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_3]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=UnprovenCallee
// CHECK-NEXT: PutEnvironmentField v1, v5 layout=[[L_1]]
// CHECK-NEXT: v7 = GetEnvironmentField v1 layout=[[L_1]]
// CHECK-NEXT: v8 = CheckInitialized v7 name="d"
// CHECK-NEXT: v9 = ToBoolean v8
// CHECK-NEXT: Branch v9 -> taken b1(| 0), notTaken b4(| 0)
// CHECK-NEXT: b1(v10):
// CHECK-NEXT: v11 = ToBoolean v0
// CHECK-NEXT: Branch v11 -> taken b2(| 0), notTaken b3()
// CHECK-NEXT: b2(v12):
// CHECK-NEXT: v13 = CallDirect v1 function=[[f_4]]
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v14 = GetEnvironmentField v1 layout=[[L_1]]
// CHECK-NEXT: v15 = CheckInitialized v14 name="d"
// CHECK-NEXT: v16 = PropGet v15 key="bark"
// CHECK-NEXT: v17 = Call v16, v15 calleeKey="bark" calleeName="d.bark"
// CHECK-NEXT: ReturnCall v17 casts=[{declared={type=number}}]
// CHECK-NEXT: b4(v18):
// CHECK-NEXT: v19 = Integer integer=-1
// CHECK-NEXT: v20 = Convert v19 declared={type=number}
// CHECK-NEXT: Return v20
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Dog"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_3]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_3]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_3]]}
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_5]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="bark"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_3]]} results=[{type=number}] {
// CHECK-NEXT: b0(v0: [[L_3]]):
// CHECK-NEXT: v1 = PropGet v0 key="legs"
// CHECK-NEXT: v2 = Integer integer=2
// CHECK-NEXT: v3 = Mul v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="spoil"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] captures=[{type=env [[L_6]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_6]]):
// CHECK-NEXT: v1 = GetEnvironmentField v0 layout=[[L_6]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="v"
// CHECK-NEXT: v3 = String string="text"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|number|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PutEnvironmentField v0, v4 layout=[[L_6]]
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="peek"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] captures=[{type=env [[L_7]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_7]]):
// CHECK-NEXT: v1 = GetEnvironmentField v0 layout=[[L_7]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="n"
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: v4 = Add v2, v3
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
