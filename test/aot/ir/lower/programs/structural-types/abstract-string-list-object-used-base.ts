// RUN: lower
// OPTIONS: builtin-modules

// An abstract string a list and an object are used by the base constructor.
function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? text(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

class Person {
  first: string = "ann";
}

abstract class Page {
  abstract title: string;
  abstract lines: string[];
  abstract author: Person;
  seen: string[] = [];
  heading: string;
  constructor() {
    this.heading = this.titleNow() + "!";
    this.note("title", () => this.title);
    this.note("the length of the title", () => this.title.length);
    this.note("the title in capitals", () => this.title.toUpperCase());
    this.note("lines", () => this.lines);
    this.note("the number of lines", () => this.lines.length);
    this.note("lines iterated", () => [...this.lines].length);
    this.note("author", () => this.author);
    this.note("the name of the author", () => this.author.first);
  }
  titleNow(): string {
    return this.title;
  }
  note(label: string, run: () => unknown): void {
    try {
      const value = run();
      this.seen.push(label + " " + typeof value + " " + String(value));
    } catch (error) {
      this.seen.push(label + " threw " + (error instanceof TypeError ? "TypeError" : "another error"));
    }
  }
}

class ByFields extends Page {
  title: string = "fields";
  lines: string[] = ["one", "two"];
  author: Person = new Person();
}

class ByGetters extends Page {
  get title(): string {
    return "getters";
  }
  get lines(): string[] {
    return ["only"];
  }
  get author(): Person {
    return new Person();
  }
}

abstract class Strict {
  abstract title: string;
  width: number;
  constructor() {
    this.width = this.measure();
  }
  measure(): number {
    return this.title.length;
  }
}

class StrictByField extends Strict {
  title: string = "late";
}

class StrictByGetter extends Strict {
  get title(): string {
    return "early";
  }
}

const byGetters = new ByGetters();
show("getters: heading", () => byGetters.heading);
for (const line of byGetters.seen) console.log("getters: " + line);

const byFields = new ByFields();
show("fields: heading", () => byFields.heading);
for (const line of byFields.seen) console.log("fields: " + line);
show("fields: now", () => [byFields.title, byFields.lines, byFields.author.first]);
show("fields: keys", () => Object.keys(byFields));

show("a constructor that needs it: by a getter", () => new StrictByGetter().width);
show("a constructor that needs it: by a field", () => new StrictByField().width);
show("2000 of each", () => {
  let made = 0;
  let failed = 0;
  for (let i = 0; i < 2000; i++) {
    made += new StrictByGetter().width;
    try {
      made += new StrictByField().width;
    } catch {
      failed++;
    }
  }
  return [made, failed];
});

// GENERATED: Person note ByFields lines author
// CHECK-LABEL: function {{*}}name="Person"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_1]]}
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_2]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="note"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] length=2 thisType={type=[[L_3]]} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_4]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_3]], v1: undefined|null|string, v2: undefined|null|[[f_4]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v3 = Call v2 calleeName="run"
// CHECK-NEXT: v4 = PropGet v0 key="seen"
// CHECK-NEXT: v5 = PropGet v4 key="push"
// CHECK-NEXT: v6 = String string=" "
// CHECK-NEXT: v7 = Add v1, v6
// CHECK-NEXT: v8 = TypeOf v3
// CHECK-NEXT: v9 = Add v7, v8
// CHECK-NEXT: v10 = String string=" "
// CHECK-NEXT: v11 = Add v9, v10
// CHECK-NEXT: v12 = Builtin builtin=String
// CHECK-NEXT: v13 = Call v12, -, v3 calleeName="String"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v15 = Add v11, v14
// CHECK-NEXT: v16 = Call v5, v4, v15 calleeKey="push" calleeName="this.seen.push"
// CHECK-NEXT: v17 = Convert v16 declared={type=number} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v18 = CatchValue
// CHECK-NEXT: v19 = PropGet v0 key="seen"
// CHECK-NEXT: v20 = PropGet v19 key="push"
// CHECK-NEXT: v21 = String string=" threw "
// CHECK-NEXT: v22 = Add v1, v21
// CHECK-NEXT: v23 = Builtin builtin=GlobalThis
// CHECK-NEXT: v24 = PropGet v23 key="TypeError" [isFreeName]
// CHECK-NEXT: v25 = Convert v24 declared={type=builtin(TypeError) flags=[IsExpected]}
// CHECK-NEXT: v26 = InstanceOf v18, v25
// CHECK-NEXT: v27 = ToBoolean v26
// CHECK-NEXT: Branch v27 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v28):
// CHECK-NEXT: v29 = String string="TypeError"
// CHECK-NEXT: Jump -> next b5(v29)
// CHECK-NEXT: b4(v30):
// CHECK-NEXT: v31 = String string="another error"
// CHECK-NEXT: Jump -> next b5(v31)
// CHECK-NEXT: b5(v32):
// CHECK-NEXT: v33 = Add v22, v32
// CHECK-NEXT: v34 = Call v20, v19, v33 calleeKey="push" calleeName="this.seen.push"
// CHECK-NEXT: v35 = Convert v34 declared={type=number} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v36 = Undefined
// CHECK-NEXT: Return v36
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="ByFields"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_6]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_6]]}
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_7]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="lines"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Data data=[[d_8]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="author"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="Person"
// CHECK-NEXT: v2 = Construct v1 calleeName="Person"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=UnprovenCallee
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
