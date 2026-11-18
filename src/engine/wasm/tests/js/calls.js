// Calls between a script and WebAssembly, and the values they pass (js-api §3.2, §3.3).

function instanceOf(builder, imports) {
  return new WebAssembly.Instance(new WebAssembly.Module(builder.toBytes()), imports);
}

// An exported function is a function of the script.
var b = new Builder();
var add = b.addType([kI32, kI32], [kI32]);
b.addFunction(add, [], [0x20, 0x00, 0x20, 0x01, 0x6a]);
b.addExport("add", kExternFunc, 0);
var exported = instanceOf(b).exports.add;

assertEq(typeof exported, "function");
assertEq(Object.getPrototypeOf(exported), Function.prototype);
assertEq(exported.length, 2);
assertEq(exported.name, "0");
assertEq(exported.add, undefined);
assertThrows(TypeError, function () {
  new exported(1, 2);
});
assertEq(exported(2, 3), 5);
assertEq(exported.call(null, 2, 3), 5);
assertEq(exported.apply(null, [2, 3]), 5);
assertEq(Reflect.apply(exported, null, [2, 3]), 5);

// Arguments are converted, and the ones that are missing are `undefined`.
assertEq(exported("4", "5"), 9);
assertEq(exported(1.9, 0), 1);
assertEq(exported(-1, 0), -1);
assertEq(exported(2 ** 32 + 1, 0), 1);
assertEq(exported(1), 1);
assertEq(exported(), 0);
assertEq(exported(1, 2, 3), 3);
assertThrows(TypeError, function () {
  exported(Symbol("a"), 0);
});
assertThrows(TypeError, function () {
  exported(1n, 0);
});

// A value that is converted can run a script.
var steps = [];
assertEq(
  exported(
    {
      valueOf: function () {
        steps.push("first");
        return 1;
      },
    },
    {
      valueOf: function () {
        steps.push("second");
        return 2;
      },
    },
  ),
  3,
);
assertDeepEq(steps, ["first", "second"]);

// Each type of result.
var types = new Builder();
types.addFunction(types.addType([], []), [], []);
types.addFunction(types.addType([], [kI64]), [], [0x42, 0x7f]);
types.addFunction(types.addType([], [kF32]), [], [0x43, 0x00, 0x00, 0x20, 0x41]);
types.addFunction(types.addType([], [kF64]), [], [0x44, 0, 0, 0, 0, 0, 0, 0x22, 0x40]);
types.addFunction(types.addType([], [kExternRef]), [], [0xd0, kExternRef]);
types.addFunction(types.addType([kExternRef], [kExternRef]), [], [0x20, 0x00]);
types.addFunction(types.addType([], [kI32, kI64]), [], [0x41, 0x01, 0x42, 0x02]);
types.addExport("nothing", kExternFunc, 0);
types.addExport("wide", kExternFunc, 1);
types.addExport("single", kExternFunc, 2);
types.addExport("double", kExternFunc, 3);
types.addExport("nullRef", kExternFunc, 4);
types.addExport("same", kExternFunc, 5);
types.addExport("pair", kExternFunc, 6);
var all = instanceOf(types).exports;

assertEq(all.nothing(), undefined);
assertEq(all.wide(), -1n);
assertEq(typeof all.wide(), "bigint");
assertEq(all.single(), 10);
assertEq(all.double(), 9);
assertEq(all.nullRef(), null);
var object = { a: 1 };
assertEq(all.same(object), object);
assertEq(all.same(42), 42);
assertEq(all.same("text"), "text");
assertEq(all.same(), undefined);
assertEq(all.same(null), null);
var pair = all.pair();
assert(Array.isArray(pair));
assertEq(pair.length, 2);
assertEq(pair[0], 1);
assertEq(pair[1], 2n);

// Calls the other way: the import gets the arguments and gives the result.
var out = new Builder();
var twice = out.addType([kI32], [kI32]);
out.importFunction("env", "twice", twice);
out.addFunction(twice, [], [0x20, 0x00, 0x10, 0x00]);
out.addExport("run", kExternFunc, 1);
var seen = [];
var outward = instanceOf(out, {
  env: {
    twice: function (value) {
      "use strict";
      seen.push(arguments.length, this === undefined, value);
      return value * 2;
    },
  },
}).exports.run;
assertEq(outward(21), 42);
assertDeepEq(seen, [1, true, 21]);
assertEq(outward(1.5 ? 3 : 0), 6);

// What the import gives back is converted, and may run a script.
var converted = instanceOf(out, {
  env: {
    twice: function () {
      return {
        valueOf: function () {
          return 7;
        },
      };
    },
  },
}).exports.run;
assertEq(converted(0), 7);

// An exception of the script passes through WebAssembly.
var boom = new Error("boom");
var thrower = instanceOf(out, {
  env: {
    twice: function () {
      throw boom;
    },
  },
}).exports.run;
var caught = assertThrows(Error, function () {
  thrower(1);
});
assertEq(caught, boom);

// A function of WebAssembly is an import of another module, and keeps its identity.
var again = new Builder();
again.importFunction("env", "same", again.addType([kExternRef], [kExternRef]));
again.addExport("same", kExternFunc, 0);
var relayed = instanceOf(again, { env: { same: all.same } }).exports.same;
assertEq(relayed, all.same);
assertEq(relayed(object), object);

// One of the wrong type is a LinkError.
assertThrows(WebAssembly.LinkError, function () {
  instanceOf(again, { env: { same: all.wide } });
});

// Traps are RuntimeErrors.
var traps = new Builder();
traps.addFunction(traps.addType([], [kI32]), [], [0x00]);
traps.addFunction(traps.addType([kI32, kI32], [kI32]), [], [0x20, 0x00, 0x20, 0x01, 0x6d]);
traps.addExport("boom", kExternFunc, 0);
traps.addExport("divide", kExternFunc, 1);
var trapping = instanceOf(traps).exports;
var trap = assertThrows(WebAssembly.RuntimeError, function () {
  trapping.boom();
});
assert(trap instanceof WebAssembly.RuntimeError);
assert(trap instanceof Error);
assert(trap.stack.length > 0);
assertThrows(WebAssembly.RuntimeError, function () {
  trapping.divide(1, 0);
});
assertEq(trapping.divide(7, 2), 3);
