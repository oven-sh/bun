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
// CHECK-LABEL: function {{*}}name="make"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}, {type=number flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|function, v1: number):
// CHECK-NEXT: v2 = Construct v0, -, v1 calleeName="Class"
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="makeByReflect"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[f_1]] flags=[IsExpected]}, {type=number flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_1]], v1: number):
// CHECK-NEXT: v2 = Builtin builtin=Reflect
// CHECK-NEXT: v3 = Builtin builtin=ReflectConstruct
// CHECK-NEXT: v4 = NewArray v1 contents=anything
// CHECK-NEXT: v5 = Call v3, v2, v0, v4 calleeName="Reflect.construct"
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="told"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b5():
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
// CHECK-NEXT: Branch v11 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v12) handler=b5():
// CHECK-NEXT: v13 = String string="a string"
// CHECK-NEXT: Jump -> next b4(v13)
// CHECK-NEXT: b3(v14) handler=b5():
// CHECK-NEXT: v15 = String string="no string"
// CHECK-NEXT: Jump -> next b4(v15)
// CHECK-NEXT: b4(v16) handler=b5():
// CHECK-NEXT: v17 = NewArray v2 contents=anything
// CHECK-NEXT: v18 = PropGet v17 key="includes"
// CHECK-NEXT: v19 = String string="Hi"
// CHECK-NEXT: v20 = Call v18, v17, v19 calleeKey="includes" calleeName="includes"
// CHECK-NEXT: v21 = String string="Hi"
// CHECK-NEXT: v22 = Eq v2, v21
// CHECK-NEXT: v23 = PropGet v2 key="length"
// CHECK-NEXT: v24 = Call v7, v5, v0, v8, v10, v16, v20, v22, v23 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b5() role=CatchHandler:
// CHECK-NEXT: v25 = CatchValue
// CHECK-NEXT: v26 = Builtin builtin=GlobalThis
// CHECK-NEXT: v27 = PropGet v26 key="console" [isFreeName]
// CHECK-NEXT: v28 = Convert v27 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v29 = PropGet v28 key="log"
// CHECK-NEXT: v30 = Convert v29 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v31 = String string="throws"
// CHECK-NEXT: v32 = PropGet v25 key="name"
// CHECK-NEXT: v33 = PropGet v25 key="message"
// CHECK-NEXT: v34 = Call v30, v28, v0, v31, v32, v33 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v35 = Undefined
// CHECK-NEXT: Return v35
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Kept"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_2]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_2]]}
// CHECK-NEXT: PropSet v4, v1 key="length"
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: v7 = TypeTest v6 testedType=object
// CHECK-NEXT: Branch v7 -> taken b1(| 0), notTaken b2(v4)
// CHECK-NEXT: b1(v8):
// CHECK-NEXT: Jump -> next b2(v8)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
