// RUN: lower
// OPTIONS: builtin-modules

// A host constructor that answers with a string is constructed and called in thirteen ways.
const ffi = require("bun:ffi");
const bytes = Buffer.from("Hi\0");
const at = ffi.ptr(bytes);
function told(name, work) {
  try {
    const text = work();
    console.log(name, typeof text, text === "Hi", typeof text === "string" ? "a string" : "no string", [text].includes("Hi"), text == "Hi", text.length);
  } catch (error) {
    console.log(name, "throws", error.name, error.message);
  }
}
function make(Class, argument) {
  return new Class(argument);
}
function makeByReflect(Class, argument) {
  return Reflect.construct(Class, [argument]);
}
function call(work, argument) {
  return work(argument);
}
class Kept {
  constructor(value) {
    this.length = value;
  }
}
told("the object's own member", () => new Bun.FFI.CString(at));
told("the object's own member through a parameter", () => make(Bun.FFI.CString, at));
told("the module's member through a parameter", () => make(ffi.CString, at));
told("a class through the same parameter", () => make(Kept, 2));
told("Reflect.construct through a parameter", () => makeByReflect(Bun.FFI.CString, at));
told("destructured", () => {
  const { CString } = Bun.FFI;
  return new CString(at);
});
told("by a computed name", () => new Bun.FFI[["C", "String"].join("")](at));
told("called through a parameter", () => call(Bun.FFI.CString, at));
told("one of two", () => make(bytes.length > 2 ? Bun.FFI.CString : Kept, at));
told("out of an object", () => make({ Class: Bun.FFI.CString }.Class, at));
told("a subclass", () => new (class extends Bun.FFI.CString {})(at));
told("new.target is another", () => Reflect.construct(Bun.FFI.CString, [at], Kept));
told("bound", () => make(Bun.FFI.CString.bind(null), at));
// The address is good for as long as the bytes are held.
console.log("the bytes", bytes.join());

// GENERATED: told make makeByReflect Kept
// CHECK-LABEL: function {{*}}name="told"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b9():
// CHECK-NEXT: v2 = Call v1 calleeName="work"
// CHECK-NEXT: v3 = Builtin builtin=GlobalThis
// CHECK-NEXT: v4 = PropGet v3 key="console" [isFreeName]
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v5 key="log"
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v8 = TypeOf v2
// CHECK-NEXT: v9 = String string="Hi"
// CHECK-NEXT: v10 = StrictEq v2, v9
// CHECK-NEXT: v11 = TypeTest v2 testedType=string
// CHECK-NEXT: Branch v11 -> taken b3(| 0), notTaken b5(| 0)
// CHECK-NEXT: b3(v12) handler=b9():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b9():
// CHECK-NEXT: v13 = String string="a string"
// CHECK-NEXT: Jump -> next b7(v13, v12)
// CHECK-NEXT: b5(v14) handler=b9():
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6() handler=b9():
// CHECK-NEXT: v15 = String string="no string"
// CHECK-NEXT: Jump -> next b7(v15, v14)
// CHECK-NEXT: b7(v16, v17) handler=b9():
// CHECK-NEXT: v18 = NewArray v17 contents=anything
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v20 = PropGet v19 key="includes"
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|[[f_1]] flags=[IsExpected]}
// CHECK-NEXT: v22 = String string="Hi"
// CHECK-NEXT: v23 = Call v21, v19, v22 calleeKey="includes" calleeName="includes"
// CHECK-NEXT: v24 = Convert v23 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: v25 = String string="Hi"
// CHECK-NEXT: v26 = Eq v17, v25
// CHECK-NEXT: v27 = PropGet v17 key="length"
// CHECK-NEXT: v28 = Call v7, v5, v0, v8, v10, v16, v24, v26, v27 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b9() role=CatchHandler:
// CHECK-NEXT: v29 = CatchValue
// CHECK-NEXT: v30 = Builtin builtin=GlobalThis
// CHECK-NEXT: v31 = PropGet v30 key="console" [isFreeName]
// CHECK-NEXT: v32 = Convert v31 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v33 = PropGet v32 key="log"
// CHECK-NEXT: v34 = Convert v33 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v35 = String string="throws"
// CHECK-NEXT: v36 = PropGet v29 key="name"
// CHECK-NEXT: v37 = PropGet v29 key="message"
// CHECK-NEXT: v38 = Call v34, v32, v0, v35, v36, v37 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v39 = Undefined
// CHECK-NEXT: Return v39
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="make"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}, {type=number flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|function, v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Construct v0, -, v1 calleeName="Class"
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="makeByReflect"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[f_2]] flags=[IsExpected]}, {type=number flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_2]], v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=Reflect
// CHECK-NEXT: v3 = Builtin builtin=ReflectConstruct
// CHECK-NEXT: v4 = NewArray v1 contents=anything
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v6 = Call v3, v2, v0, v5 calleeName="Reflect.construct" [isDoneInPlace]
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Kept"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_4]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_4]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string|[[L_4]] flags=[IsExpected]}
// CHECK-NEXT: PropSet v5, v1 key="length"
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: v8 = TypeTest v7 testedType=object
// CHECK-NEXT: Branch v8 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: Jump -> next b4(v9)
// CHECK-NEXT: b3(v10):
// CHECK-NEXT: Jump -> next b4(v4)
// CHECK-NEXT: b4(v11):
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
