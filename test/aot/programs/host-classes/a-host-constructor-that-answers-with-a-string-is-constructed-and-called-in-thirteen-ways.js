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
