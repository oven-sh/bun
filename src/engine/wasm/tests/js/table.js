var { Table } = WebAssembly;

var notFunction =
  "WebAssembly.Table.prototype.constructor expects the second argument to be null or an instance of WebAssembly.Function";
for (var [kind, message, ...parameters] of [
  [TypeError, "WebAssembly.Table expects its first argument to be an object", null],
  [TypeError, "WebAssembly.Table expects its 'element' field to be the string 'funcref' or 'externref'", { initial: 1 }],
  [TypeError, "WebAssembly.Table 'address' must be a string of value 'i32' or 'i64'", { address: null }],
  [TypeError, "Expect an integer argument in the range: [0, 2^32 - 1]", { element: "funcref" }],
  [TypeError, "WebAssembly.Table 'initial' and 'minimum' options are specified at the same time", { element: "funcref", initial: 0, minimum: 0 }],
  [RangeError, "WebAssembly.Table 'initial' value is above the upper bound 10000000", { element: "funcref", initial: 10000001 }],
  [RangeError, "'maximum' property must be greater than or equal to the 'initial' property", { element: "funcref", initial: 2, maximum: 1 }],
  [TypeError, notFunction, { element: "funcref", initial: 0 }, () => {}],
  [TypeError, notFunction, { element: "anyfunc", initial: 0 }, undefined],
]) {
  throws(kind, message, () => new Table(...parameters));
}

var log = [];
new Table(logging(log, { element: "externref", minimum: 1, maximum: 2 ** 32 - 1 }));
assertDeepEq(log, ["address", "element", "initial", "minimum", "maximum"]);

for (var method of ["get", "set", "grow", "type"]) {
  throws(TypeError, "expected |this| value to be an instance of WebAssembly.Table", () => Table.prototype[method].call({}));
}

var builder = new Builder();
builder.addExport("f", kExternFunc, builder.addFunction(builder.addType([], []), [], []));
var { f } = builder.instantiate();
var contents = table => Array.from({ length: Number(table.length) }, (_, index) => table.get(index));

// What is left out is null for functions, and undefined otherwise.
for (var [element, missing, value] of [
  ["funcref", null, f],
  ["externref", undefined, {}],
]) {
  var table = new Table({ element, initial: 1, maximum: 5 });
  assertEq(table.get(0), missing);
  assertEq(table.grow(1), 1);
  assertEq(table.grow(2, value), 2);
  assertEq(table.set(0, value), undefined);
  table.set(3);
  contents(table).forEach((it, index) => assertEq(it, index % 2 ? missing : value));
  table.set(0, null);
  assertEq(table.get(0), null);
  assertEq(new Table({ element, initial: 2 }, value).get(1), value);
  assertDeepEq(table.type(), { maximum: 5, minimum: 4, element, address: "i32" });
  throws(RangeError, "WebAssembly.Table.prototype.grow could not grow the table", () => table.grow(2));
  for (var method of ["get", "set"]) {
    var message = "WebAssembly.Table.prototype." + method + " expects an integer less than the length of the table";
    throws(RangeError, message, () => table[method](4));
  }
}

var functions = new Table({ element: "funcref", initial: 1 });
for (var value of [undefined, 1, () => {}]) {
  throws(TypeError, "Argument value did not match the reference type", () => functions.set(0, value));
  throws(TypeError, "Argument value did not match the reference type", () => functions.grow(0, value));
}
throws(RangeError, "WebAssembly.Table.prototype.grow could not grow the table", () => functions.grow(10000000));

// The length is read after the argument is converted.
assertEq(functions.grow({ valueOf: () => functions.grow(2) }), 3);
assertEq(functions.get({ valueOf: () => functions.grow(1, f) }), f);

var wide = new Table({ address: "i64", element: "externref", initial: 1n, maximum: 2n ** 64n - 1n }, 1);
assertEq(wide.grow(1n, 2), 1n);
assertEq(wide.length, 2n);
assertEq(wide.get(1n), 2);
assertThrows(TypeError, () => wide.get(1));
assertThrows(RangeError, () => wide.get(2n ** 32n));
assertThrows(RangeError, () => wide.grow(2n ** 64n - 1n));
