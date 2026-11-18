var { Module, CompileError } = WebAssembly;

var notBytes = "first argument must be an ArrayBufferView or an ArrayBuffer";
var detachedMessage = "Underlying ArrayBuffer has been detached from the view or out-of-bounds";
for (var compile of [it => new Module(it), WebAssembly.validate]) {
  for (var value of [undefined, null, 0, "", {}, []]) throws(TypeError, notBytes, () => compile(value));
  for (var wrap of [it => it, it => new Uint8Array(it), it => new DataView(it), it => new Uint16Array(it)]) {
    var buffer = emptyModuleBytes().buffer;
    var source = wrap(buffer);
    assert(compile(source));
    buffer.transfer();
    throws(TypeError, detachedMessage, () => compile(source));
  }
  var shared = new Uint8Array(new SharedArrayBuffer(8));
  shared.set(emptyModuleBytes());
  assert(compile(shared) && compile(shared.buffer));
}

var noMagic = "WebAssembly.Module doesn't parse at byte 0: module doesn't start with '\\0asm'";
throws(CompileError, noMagic, () => new Module(new Uint8Array(8)));
var wrong = new Builder();
wrong.addFunction(wrong.addType([], [kI32]), [], [0x42, 0x01]);
assertEq(WebAssembly.validate(wrong.toBytes()), false);
throws(
  CompileError,
  "WebAssembly.Module doesn't validate: control flow returns with unexpected type. I64 is not a I32, in function at index 0",
  () => wrong.toModule(),
);
assert(assertThrows(CompileError, () => new Module(new Uint8Array(8))).message.endsWith("(evaluating 'new Module(new Uint8Array(8))')"));

// The bytes are copied before the options are read.
var bytes = emptyModuleBytes();
new Module(bytes, {
  get builtins() {
    bytes.fill(0);
  },
});

var builder = new Builder();
var type = builder.addType([kI32, kExternRef], [kF64]);
builder.importFunction("env", "fé", type).importMemory("env", "memory", 1, 2, true);
builder.importGlobal("", "0", kI64, true).importTable("env", "table", kFuncRef, 1);
builder.addExport("f", kExternFunc, 0).addExport("tag", kExternTag, builder.addTag(builder.addType([], [])));
builder.addCustomSection("notes", [1, 2, 3]).addCustomSection("�", [5]).addCustomSection("notes", []);
var module = builder.toModule();
var functionType = { parameters: ["i32", "externref"], results: ["f64"] };
assertDeepEq(Module.imports(module), [
  { module: "env", name: "fé", kind: "function", type: functionType },
  { module: "env", name: "memory", kind: "memory", type: { maximum: 2, minimum: 1, shared: true, address: "i32" } },
  { module: "", name: "0", kind: "global", type: { mutable: true, value: "i64" } },
  { module: "env", name: "table", kind: "table", type: { minimum: 1, element: "funcref", address: "i32" } },
]);
assertDeepEq(Module.exports(module), [
  { name: "f", kind: "function", type: functionType },
  { name: "tag", kind: "tag" },
]);
assert(Module.exports(module) !== Module.exports(module));
throws(TypeError, "WebAssembly.Module.imports unable to produce import descriptors for the given module", () =>
  Module.imports(new Builder().importGlobal("a", "b", kAnyRef, false).toModule()),
);

var sections = name => Module.customSections(module, name).map(it => Array.from(new Uint8Array(it)));
assertDeepEq(sections("notes"), [[1, 2, 3], []]);
assertDeepEq(sections({ toString: () => "�" }), [[5]]);
assertDeepEq(sections("\ud800"), []);
throws(TypeError, "Not enough arguments", () => Module.customSections(module));
for (var method of ["imports", "exports", "customSections"]) {
  var message = "WebAssembly.Module." + method + " called with non WebAssembly.Module argument";
  for (var value of [undefined, {}, Module.prototype]) throws(TypeError, message, () => Module[method](value, ""));
}

// What the prototypes have does not matter.
for (var [object, key] of [[Array.prototype, 0], [Object.prototype, "kind"]]) Object.defineProperty(object, key, { set: fail, configurable: true });
assertDeepEq([Module.exports(module)[0], Module.imports(module)[0].type, sections("notes")[0]], [{ name: "f", kind: "function", type: functionType }, functionType, [1, 2, 3]]);
delete Array.prototype[0];
