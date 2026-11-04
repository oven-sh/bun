// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 1
// STATISTIC: SourceFilesDemoted = 1

// FILE: main.ts
// @ts-nocheck
// The compiler options say that fields are assigned. Each class has private members and no field with a value, and calls super() in evaluated text or as written.
class Parent {
  made = "parent";
}
function tell(name: string, make: () => unknown) {
  try {
    console.log(name, JSON.stringify(make()));
  } catch (error) {
    console.log(name, error.constructor.name + ": " + error.message);
  }
}
tell("private method", () => {
  class Child extends Parent {
    #m() {
      return 1;
    }
    constructor() {
      eval("super()");
      this.seen = this.#m();
    }
  }
  return new Child();
});
tell("private accessor", () => {
  class Child extends Parent {
    get #g() {
      return 5;
    }
    constructor() {
      eval("super()");
      this.seen = this.#g;
    }
  }
  return new Child();
});
tell("private field without a value", () => {
  class Child extends Parent {
    #f;
    constructor() {
      eval("super()");
      this.#f = 4;
      this.seen = this.#f;
    }
  }
  return new Child();
});
tell("no members", () => {
  class Child extends Parent {
    constructor() {
      eval("super()");
    }
  }
  return new Child();
});
tell("private method, super() as written", () => {
  class Child extends Parent {
    #m() {
      return 6;
    }
    constructor() {
      super();
      this.seen = this.#m();
    }
  }
  return new Child();
});
tell("private method without a parent", () => {
  class Child {
    #m() {
      return 8;
    }
    constructor() {
      this.seen = this.#m();
    }
  }
  return new Child();
});
tell("private method, no constructor", () => {
  class Child extends Parent {
    #m() {
      return 9;
    }
    read() {
      return this.#m();
    }
  }
  return new Child().read();
});

// FILE: tsconfig.json
{ "compilerOptions": { "useDefineForClassFields": false } }

// GENERATED: tell Parent #g read
// CHECK-LABEL: function {{*}}name="tell"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|[[f_1]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = Builtin builtin=JSON
// CHECK-NEXT: v8 = PropGet v7 key="stringify"
// CHECK-NEXT: v9 = Convert v8 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v10 = Call v1 calleeName="make"
// CHECK-NEXT: v11 = Call v9, v7, v10 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v12 = Call v6, v4, v0, v11 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v13 = CatchValue
// CHECK-NEXT: v14 = Builtin builtin=GlobalThis
// CHECK-NEXT: v15 = PropGet v14 key="console" [isFreeName]
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v17 = PropGet v16 key="log"
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v19 = PropGet v13 key="constructor"
// CHECK-NEXT: v20 = PropGet v19 key="name"
// CHECK-NEXT: v21 = String string=": "
// CHECK-NEXT: v22 = Add v20, v21
// CHECK-NEXT: v23 = PropGet v13 key="message"
// CHECK-NEXT: v24 = Add v22, v23
// CHECK-NEXT: v25 = Call v18, v16, v0, v24 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v26 = Undefined
// CHECK-NEXT: Return v26
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Parent"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_3]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_3]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_3]]}
// CHECK-NEXT: v4 = String string="parent"
// CHECK-NEXT: PropSet v3, v4 key="made"
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="#g"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Integer integer=5
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="read"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] captures=[{type=classtoken flags=[IsFromCompiler]}, {type=anything}] thisType={type=[[L_4]] flags=[IsExpected]} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: classtoken, v1: anything, v2: [[L_4]]):
// CHECK-NEXT: v3 = PrivateGet v2, v0 layout=[[L_4]]
// CHECK-NEXT: v4 = Call v1, v2 calleeName="this.#m"
// CHECK-NEXT: ReturnCall v4
// CHECK-NEXT: }
