function describe(object) {
  return Reflect.ownKeys(object).map(key => {
    var it = Object.getOwnPropertyDescriptor(object, key);
    var flags = (it.writable ? "w" : "") + (it.enumerable ? "e" : "") + (it.configurable ? "c" : "");
    var name = f => (typeof f === "function" ? f.name + "/" + f.length : String(f));
    return String(key) + ":" + flags + ":" + ("value" in it ? name(it.value) : name(it.get) + "," + name(it.set));
  });
}

var tag = name => "Symbol(Symbol.toStringTag):c:" + name;
var ours = /^(?!Exception|Tag|JSTag|promising|Suspending)/;
assertDeepEq(
  describe(WebAssembly).filter(it => ours.test(it)),
  [
    "CompileError:wc:CompileError/1",
    "Global:wc:Global/1",
    "Instance:wc:Instance/1",
    "LinkError:wc:LinkError/1",
    "Memory:wc:Memory/1",
    "Module:wc:Module/1",
    "RuntimeError:wc:RuntimeError/1",
    "Table:wc:Table/1",
    "compile:wec:compile/1",
    "instantiate:wec:instantiate/1",
    "validate:wec:validate/1",
    "compileStreaming:wec:compileStreaming/1",
    "instantiateStreaming:wec:instantiateStreaming/1",
    "SuspendError:wc:SuspendError/1",
    tag("WebAssembly"),
  ],
);
assertEq(describe(globalThis).find(it => it.startsWith("WebAssembly:")), "WebAssembly:wc:[object WebAssembly]");

var members = {
  Module: [],
  Instance: ["exports:ec:get exports/0,undefined"],
  Memory: [
    "grow:wec:grow/1",
    "buffer:ec:get buffer/0,undefined",
    "type:wec:type/0",
    "toFixedLengthBuffer:wec:toFixedLengthBuffer/0",
    "toResizableBuffer:wec:toResizableBuffer/0",
  ],
  Table: ["length:ec:get length/0,undefined", "grow:wec:grow/1", "get:wec:get/1", "set:wec:set/1", "type:wec:type/0"],
  Global: ["valueOf:wec:valueOf/0", "value:ec:get value/0,set value/1", "type:wec:type/0"],
};
var statics = ["customSections:wec:customSections/2", "imports:wec:imports/1", "exports:wec:exports/1"];
for (var name in members) {
  var constructor = WebAssembly[name];
  var own = ["length:c:1", "name:c:" + name, "prototype::[object WebAssembly." + name + "]"];
  assertDeepEq(describe(constructor), (name === "Module" ? statics : []).concat(own));
  var last = ["constructor:wc:" + name + "/1", tag("WebAssembly." + name)];
  assertDeepEq(describe(constructor.prototype), members[name].concat(last));
  assertEq(Object.getPrototypeOf(constructor), Function.prototype);
  throws(TypeError, "calling WebAssembly." + name + " constructor without new is invalid", constructor);
}

for (var name of ["CompileError", "LinkError", "RuntimeError", "SuspendError"]) {
  var kind = WebAssembly[name];
  assertEq(Object.getPrototypeOf(kind), Error);
  assertEq(Object.getPrototypeOf(kind.prototype), Error.prototype);
  assertDeepEq(describe(kind), ["length:c:1", "name:c:" + name, "prototype::" + name]);
  assertDeepEq(describe(kind.prototype), ["name:wc:" + name, "message:wc:", "constructor:wc:" + name + "/1"]);
  for (var error of [new kind("why", { cause: 7 }), kind("why", { cause: 7 })]) {
    assertEq(Object.getPrototypeOf(error), kind.prototype);
    assertEq(String(error), name + ": why");
    assertEq(error.cause, 7);
    assertEq(Object.prototype.toString.call(error), "[object Error]");
  }
  assertEq(Object.hasOwn(new kind(), "message"), false);
}

// The prototype comes from `new.target`.
for (var [name, argument] of [
  ["Module", emptyModuleBytes()],
  ["Instance", new Builder().toModule()],
  ["Memory", { initial: 0 }],
  ["Table", { element: "anyfunc", initial: 0 }],
  ["Global", { value: "i32" }],
  ["LinkError", "why"],
]) {
  class Derived extends WebAssembly[name] {}
  assertEq(Object.getPrototypeOf(new Derived(argument)), Derived.prototype);
  var bound = function () {}.bind();
  assertEq(Object.getPrototypeOf(Reflect.construct(WebAssembly[name], [argument], bound)), WebAssembly[name].prototype);
}
