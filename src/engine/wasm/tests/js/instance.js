var { Instance, Memory, Table, Global, LinkError, RuntimeError } = WebAssembly;

throws(TypeError, "first argument to WebAssembly.Instance must be a WebAssembly.Module", () => new Instance(emptyModuleBytes()));
throws(TypeError, "second argument to WebAssembly.Instance must be undefined or an Object", () => new Builder().instantiate(null));
throws(TypeError, "expected |this| value to be an instance of WebAssembly.Instance", () => Instance.prototype.exports);

var builder = new Builder();
var f = builder.addFunction(builder.addType([kI32], [kI32]), [], [0x20, 0]);
builder.addMemory(1).addTable(kFuncRef, 1).addElements(0, [f]).addGlobal(kI32, false, 3);
builder.addExport("f", kExternFunc, f).addExport("0", kExternFunc, f).addExport("__proto__", kExternMemory, 0);
builder.addExport("table", kExternTable, 0).addExport("global", kExternGlobal, 0).addExport("again", kExternGlobal, 0);
var module = builder.toModule();
var instance = new Instance(module);
var exports = instance.exports;
assertEq(instance.exports, exports);
assert(Object.getPrototypeOf(exports) === null && Object.isFrozen(exports));
assertDeepEq(Object.keys(exports), ["0", "f", "__proto__", "table", "global", "again"]);
assert(exports.f === exports[0] && exports.f === exports.table.get(0) && exports.global === exports.again);
assert(exports.__proto__ instanceof Memory && exports.global.value === 3);
assert(new Instance(module).exports.f !== exports.f);

var none = it => it.addType([], []);
var memory = (initial, maximum, shared, address) => new Memory({ initial, maximum, shared, address });
var table = (element, initial, maximum, address) => new Table({ element, initial, maximum, address });
var mismatch = "Argument value did not match the reference type";
for (var [declare, before, ...cases] of [
  [it => it.importFunction("m", "n", none(it)), "import function", [{}, "must be callable"]],
  [it => it.importFunction("m", "n", none(it)), "imported function", [exports.f, "signature doesn't match the provided WebAssembly function's signature"]],
  [it => it.addImport("m", "n", [kExternTag, 0, none(it)]), "Tag import", [{}, "is not an instance of WebAssembly.Tag"]],
  [it => it.addImport("m", "n", [kExternTag, 0, none(it)]), "imported Tag", [WebAssembly.JSTag, "signature doesn't match the imported WebAssembly Tag's signature"]],
  [
    it => it.importMemory("m", "n", 1, 2),
    "Memory import",
    [exports.table, "is not an instance of WebAssembly.Memory"],
    [memory(0, 2), "provided a 'size' that is smaller than the module's declared 'initial' import memory size"],
    [memory(1), "did not have a 'maximum' but the module requires that it does"],
    [memory(1, 3), "provided a 'maximum' that is larger than the module's declared 'maximum' import memory size"],
    [memory(1, 2, true), "provided a 'shared' that is different from the module's declared 'shared' import memory attribute"],
    [memory(1n, 2n, false, "i64"), "provided an 'address' that is different from the module's declared 'address' import memory attribute"],
  ],
  [
    it => it.importTable("m", "n", kFuncRef, 1, 2),
    "Table import",
    [undefined, "is not an instance of WebAssembly.Table"],
    [table("funcref", 0, 2), "provided an 'initial' that is too small"],
    [table("funcref", 1), "does not have a 'maximum' but the module requires that it does"],
    [table("externref", 1, 2), "provided a 'type' that is wrong"],
    [table("funcref", 1n, 2n, "i64"), "provided an 'address' that is different from the module's declared 'address' import table attribute"],
  ],
  [it => it.importTable("m", "n", kFuncRef, 1, 2), "Imported Table", [table("funcref", 1, 3), "'maximum' is larger than the module's expected 'maximum'"]],
  [
    it => it.importGlobal("m", "n", kI32, false),
    "imported global",
    ["1", "must be a number"],
    [1n, "must be a number"],
    [new Global({ value: "f32" }), "must be a same type"],
    [new Global({ value: "i32", mutable: true }), "must be a same mutability"],
  ],
  [
    it => it.importGlobal("m", "n", kI32, true),
    "imported global",
    [1, "must be a WebAssembly.Global object since it is mutable"],
    [new Global({ value: "i64", mutable: true }), "must be a same type"],
    [new Global({ value: "i32" }), "must be a same mutability"],
  ],
  [it => it.importGlobal("m", "n", kI64, false), "imported global", [1, "must be a BigInt"]],
  [it => it.importGlobal("m", "n", kV128, false), "imported global", [1, "cannot be v128"], [1n, "must be a number"]],
  [it => it.importGlobal("m", "n", kExnRef, false), "imported global", [null, "cannot be exnref"]],
  [it => it.importGlobal("m", "n", kRefExtern, false), "imported global", [null, "must be a non-null value"]],
  [it => it.importGlobal("m", "n", kFuncRef, false), "imported global", [none, "must be a wasm exported function or null"]],
  [it => it.importGlobal("m", "n", kRefFunc, false), "imported global", [null, "must be a wasm exported function"]],
  [it => it.importGlobal("m", "n", [0x6c], false), "imported global", [2 ** 30, mismatch], ["", mismatch]],
]) {
  var importing = declare(new Builder());
  for (var [n, after] of cases) throws(LinkError, before + " m:n " + after, () => importing.instantiate({ m: { n } }));
  throws(TypeError, "import m:n must be an object", () => importing.instantiate({ m: 1 }));
  throws(
    TypeError,
    "can't make WebAssembly.Instance because there is no imports Object and the WebAssembly.Module requires imports",
    () => importing.instantiate(),
  );
}

// What is imported as an object is exported as that object.
var passing = new Builder().importMemory("m", "memory", 0).importTable("m", "table", kFuncRef, 0);
passing.importGlobal("m", "constant", kI32, false).importGlobal("m", "variable", kExternRef, true);
passing.importGlobal("m", "value", kFuncRef, false);
passing.addExport("memory", kExternMemory, 0).addExport("table", kExternTable, 0);
["constant", "variable", "value"].forEach((name, index) => passing.addExport(name, kExternGlobal, index));
var variable = new Global({ value: "externref", mutable: true });
var given = { memory: memory(0), table: exports.table, constant: exports.global, variable, value: exports.f };
var log = [];
var passed = passing.instantiate(logging(log, { m: logging(log, given) }));
for (var name of ["memory", "table", "constant", "variable"]) assertEq(passed[name], given[name]);
assertEq(passed.value.value, exports.f);
assertEq(log.join(), "m,memory,m,table,m,constant,m,variable,m,value");

// An import is checked before the next one is read.
log = [];
assertThrows(LinkError, () => passing.instantiate({ m: logging(log, { memory: given.memory }) }));
assertEq(log.join(), "memory,table");

// Segments apply in order, and then the start function runs.
var target = { memory: memory(1), table: table("funcref", 1), start: () => log.push("start") };
function withSegments(add) {
  var it = new Builder().importMemory("m", "memory", 0).importTable("m", "table", kFuncRef, 0);
  it.importFunction("m", "start", none(it)).start = 0;
  log = [];
  return () => add(it).instantiate({ m: target });
}
var prefix = "Invalid data segment initialization: segment of ";
throws(RuntimeError, "Element is trying to set an out of bounds table index", withSegments(it => it.addElements(0, [0]).addElements(1, [0])));
assertEq(typeof target.table.get(0), "function");
throws(RuntimeError, prefix + "2 bytes memory of 65536 bytes, at offset 65535, segment writes outside of memory", withSegments(it => it.addData(0, [7]).addData(65535, [1, 2])));
assertDeepEq([new Uint8Array(target.memory.buffer)[0], log], [7, []]);
throws(RuntimeError, prefix + "0 bytes memory of 65536 bytes, at offset 4294967295, segment writes outside of memory", withSegments(it => it.addData(-1, [])));
withSegments(it => it.addData(65536, []).addElements(1, []))();
assertDeepEq(log, ["start"]);
target.memory = memory(0);
throws(RuntimeError, prefix + "1 bytes memory of 0 bytes, at offset 0, segment is too big", withSegments(it => it.addData(0, [7])));

throws(LinkError, "couldn't create Table", () => new Builder().addTable(kFuncRef, 10000001).instantiate());

var instances = [instance, new Instance(module)];
var exported = instances.map(it => it.exports);
var read = it => it.exports;
for (var index = 0; index < 3000; index++) assertEq(read(instances[index % 2]), exported[index % 2]);
assertThrows(TypeError, () => read(Object.create(instance)));
Object.defineProperty(Instance.prototype, "exports", { value: 1 });
assertEq(read(instance), 1);
