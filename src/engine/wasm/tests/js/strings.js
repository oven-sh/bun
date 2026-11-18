var { Module, CompileError, RuntimeError } = WebAssembly;
var builtins = ["js-string"];

// Each is called by WebAssembly and, as an import that is exported, by the script.
function builtin(name, parameters, result) {
  var builder = new Builder();
  var type = builder.addType(parameters, [result]);
  builder.importFunction("wasm:js-string", name, type);
  var body = parameters.flatMap((_, index) => [0x20, index]).concat([0x10, 0]);
  builder.addExport("direct", kExternFunc, 0).addExport("called", kExternFunc, builder.addFunction(type, [], body));
  assertDeepEq(Module.imports(builder.toModule({ builtins })), []);
  return Object.values(builder.instantiate({}, { builtins }));
}

var trap = Symbol();
var rope = "a".repeat(20) + String(Date.now()).slice(0, 0) + "😀";
for (var [name, parameters, result, ...cases] of [
  ["cast", [kExternRef], kRefExtern, ["a", "a"], [null, trap], [new String("a"), trap]],
  ["test", [kExternRef], kI32, ["", 1], [null, 0], [1, 0]],
  ["fromCharCode", [kI32], kRefExtern, [65, "A"], [-1, "￿"], [0x1d800, "\ud800"]],
  ["fromCodePoint", [kI32], kRefExtern, [0x1f600, "😀"], [0xdc00, "\udc00"], [0x110000, trap], [-1, trap]],
  ["charCodeAt", [kExternRef, kI32], kI32, [rope, 20, 0xd83d], [rope, 22, trap], [rope, -1, trap], [1, 0, trap]],
  ["codePointAt", [kExternRef, kI32], kI32, [rope, 20, 0x1f600], [rope, 21, 0xde00], ["", 0, trap]],
  ["length", [kExternRef], kI32, [rope, 22], [undefined, trap]],
  ["concat", [kExternRef, kExternRef], kRefExtern, ["a", "Ā", "aĀ"], ["a", null, trap], [1, "a", trap]],
  ["substring", [kExternRef, kI32, kI32], kRefExtern, ["abc", 1, 2, "b"], ["abc", 1, -1, "bc"], ["abc", -1, 2, ""], ["abc", 2, 1, ""], ["abc", 4, 5, ""], [null, 0, 0, trap]],
  ["equals", [kExternRef, kExternRef], kI32, ["ab", "ab", 1], ["a", "b", 0], [null, null, 1], [null, "a", 0], ["a", null, 0], ["a", 1, trap], [undefined, null, trap]],
  ["compare", [kExternRef, kExternRef], kI32, ["a", "b", -1], ["a", "a", 0], ["￿", "𐀀", 1], ["a", null, trap]],
]) {
  for (var f of builtin(name, parameters, result)) {
    for (var values of cases) {
      var call = () => f(...values.slice(0, -1));
      if (values.at(-1) === trap) throws(RuntimeError, "Illegal argument", call);
      else assertEq(call(), values.at(-1), name);
    }
  }
}

var wrong = new Builder();
wrong.importFunction("wasm:js-string", "length", wrong.addType([], []));
throws(CompileError, "builtin import wasm:js-string:length has an unexpected signature", () => wrong.toModule({ builtins }));
assertEq(WebAssembly.validate(wrong.toBytes(), { builtins }), false);
assertEq(WebAssembly.validate(wrong.toBytes(), { builtins: ["other"] }), true);
assertEq(WebAssembly.validate(wrong.toBytes(), { builtins: "js-string" }), true);
throws(CompileError, "the list of builtin set names contains duplicates", () => wrong.toModule({ builtins: ["a", "b", "a"] }));
throws(TypeError, "importedStringConstants option value must be a string", () => wrong.toModule({ importedStringConstants: null }));
throws(CompileError, "imported string constant wasm:js-string:length is not a global", () => wrong.toModule({ importedStringConstants: "wasm:js-string" }));

// What the set does not have is an import like any other.
var other = new Builder();
other.importFunction("wasm:js-string", "other", other.addType([], [kI32])).addExport("f", kExternFunc, 0);
assertEq(Module.imports(other.toModule({ builtins })).length, 1);
assertEq(other.instantiate({ "wasm:js-string": { other: () => 5 } }, { builtins }).f(), 5);

var constants = new Builder().importGlobal("'", "héllo", kRefExtern, false).addExport("g", kExternGlobal, 0);
assertEq(constants.instantiate({}, { importedStringConstants: "'" }).g.value, "héllo");
throws(CompileError, "imported string constant ':a is not an immutable external reference", () =>
  new Builder().importGlobal("'", "a", kExternRef, true).toModule({ importedStringConstants: "'" }),
);
var replaced = new Builder().importGlobal("�", "a", kExternRef, false);
assertEq(Module.imports(replaced.toModule({ importedStringConstants: "\ud800" })).length, 1);

var log = [];
new Module(emptyModuleBytes(), logging(log, {}));
WebAssembly.validate(new Uint8Array(0), logging(log, {}));
assertDeepEq(log, ["importedStringConstants", "builtins"]);

// (type (array (mut i16))), both builtins for it, and a function that makes such an array.
var arrays = new Builder();
arrays.types.push([0x5e, 0x77, 1]);
var array = [0x63, 0];
arrays.importFunction("wasm:js-string", "fromCharCodeArray", arrays.addType([array, kI32, kI32], [kRefExtern]));
arrays.importFunction("wasm:js-string", "intoCharCodeArray", arrays.addType([kExternRef, array, kI32], [kI32]));
arrays.addFunction(arrays.addType([kI32], [array]), [], [0x20, 0, 0xfb, 7, 0]);
["from", "into", "make"].forEach((it, index) => arrays.addExport(it, kExternFunc, index));
var { from, into, make } = arrays.instantiate({}, { builtins });
var units = make(24);
assertEq(into(rope, units, 2), 22);
assertEq(into("\xe9", units, 0) + into("", units, 24) + into("", make(0), 0), 1);
assertDeepEq([from(units, 0, 24), from(units, 0, 1), from(units, 24, 24)], ["\xe9\0" + rope, "\xe9", ""]);
for (var call of [() => into(rope, units, 3), () => into("", units, 25), () => into("a", units, -1), () => into(null, units, 0), () => into("", null, 0)]) {
  throws(RuntimeError, "Illegal argument", call);
}
for (var call of [() => from(units, 0, 25), () => from(units, 2, 1), () => from(units, -1, -1), () => from(null, 0, 0)]) {
  throws(RuntimeError, "Illegal argument", call);
}
throws(TypeError, "Argument value did not match the reference type", () => from([], 0, 0));
