// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1

// FILE: main.ts
// The compiler options say that fields are assigned and that decorators are the experimental ones. Classes with parameter properties and a field under a symbol have a decorator on a field, a method, a parameter or the class; their prototypes get setters, then read-only properties, under every name.
const mark = Symbol("mark");
const names: (string | symbol)[] = ["x", "w", "y", "z", mark];
let log: string[] = [];

function note(...given: unknown[]): void {
  log.push("decorator with " + given.length);
}

function describe(make: () => object): string {
  log = [];
  let made: string;
  try {
    const object = make();
    made = Reflect.ownKeys(object)
      .map(name => String(name) + "=" + String(Reflect.get(object, name)))
      .join(", ");
  } catch (error) {
    made = (error as Error).name + ": " + (error as Error).message;
  }
  return "[" + log.join("; ") + "] {" + made + "}";
}

function tell(label: string, prototype: object, make: () => object): void {
  console.log(label, "as written", describe(make));
  for (const name of names) {
    Object.defineProperty(prototype, name, {
      set(value: unknown) {
        log.push("set " + String(name) + " to " + String(value));
      },
      configurable: true,
    });
  }
  console.log(label, "setters", describe(make));
  for (const name of names) {
    Object.defineProperty(prototype, name, { value: "fixed", writable: false, configurable: true });
  }
  console.log(label, "read-only", describe(make));
}

class Parent {
  constructor() {
    log.push("parent");
  }
}

{
  class Made {
    @note y = 1;
    [mark] = 2;
    constructor(public x: number) {}
  }
  tell("field", Made.prototype, () => new Made(1));
}
{
  class Made {
    @note [mark] = 2;
    constructor(public x: number) {}
  }
  tell("field under the symbol", Made.prototype, () => new Made(1));
}
{
  class Made {
    @note method() {}
    [mark] = 2;
    constructor(public x: number) {}
  }
  tell("method", Made.prototype, () => new Made(1));
}
{
  class Made {
    @note static y = 1;
    [mark] = 2;
    constructor(public x: number) {}
  }
  tell("static field", Made.prototype, () => new Made(1));
}
{
  class Made {
    [mark] = 2;
    constructor(@note public x: number) {}
  }
  tell("parameter property", Made.prototype, () => new Made(1));
}
{
  @note
  class Made {
    [mark] = 2;
    constructor(public x: number) {}
  }
  tell("class", Made.prototype, () => new Made(1));
}
{
  class Made extends Parent {
    @note y = 1;
    [mark] = 2;
    z = 3;
    constructor(
      public x: number,
      public w: number = 2,
    ) {
      log.push("before super");
      super();
      log.push("behind super");
    }
  }
  tell("field of a derived class", Made.prototype, () => new Made(1));
}

// FILE: tsconfig.json
{ "compilerOptions": { "useDefineForClassFields": false, "experimentalDecorators": true } }

// GENERATED: note Parent set
// CHECK-LABEL: function {{*}}name="note"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasRestParameter, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array site=[[w_1]] flags=[IsFromCompiler, OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="log"
// CHECK-NEXT: v3 = PropGet v2 key="push"
// CHECK-NEXT: v4 = String string="decorator with "
// CHECK-NEXT: v5 = PropGet v0 key="length"
// CHECK-NEXT: v6 = Convert v5 declared={type=number site=[[w_3]]} illTypedCause=Assertion
// CHECK-NEXT: v7 = Add v4, v6
// CHECK-NEXT: v8 = Call v3, v2, v7 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v9 = Convert v8 declared={type=number site=[[w_4]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Parent"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_6]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_6]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_6]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="log"
// CHECK-NEXT: v6 = PropGet v5 key="push"
// CHECK-NEXT: v7 = String string="parent"
// CHECK-NEXT: v8 = Call v6, v5, v7 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v9 = Convert v8 declared={type=number site=[[w_7]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: v11 = TypeTest v10 testedType=object
// CHECK-NEXT: Branch v11 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v12):
// CHECK-NEXT: Jump -> next b4(v12)
// CHECK-NEXT: b3(v13):
// CHECK-NEXT: Jump -> next b4(v3)
// CHECK-NEXT: b4(v14):
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="set"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=1 captures=[{type=undefined|null|string|symbol site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}] thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: undefined|null|string|symbol, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="log"
// CHECK-NEXT: v4 = PropGet v3 key="push"
// CHECK-NEXT: v5 = String string="set "
// CHECK-NEXT: v6 = Builtin builtin=String
// CHECK-NEXT: v7 = Call v6, -, v0 calleeName="String"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v9 = Add v5, v8
// CHECK-NEXT: v10 = String string=" to "
// CHECK-NEXT: v11 = Add v9, v10
// CHECK-NEXT: v12 = Builtin builtin=String
// CHECK-NEXT: v13 = Call v12, -, v1 calleeName="String"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v15 = Add v11, v14
// CHECK-NEXT: v16 = Call v4, v3, v15 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v17 = Convert v16 declared={type=number site=[[w_12]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
