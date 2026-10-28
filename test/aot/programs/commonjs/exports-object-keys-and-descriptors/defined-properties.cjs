"use strict";
const { show } = require("../describe-object.cjs");
let counter = 0;
const readCounter = function () {
  return counter;
};

Object.defineProperty(exports, "__esModule", { value: true });
Object.defineProperty(exports, "fixed", { value: "fixed" });
Object.defineProperty(exports, "writable", { value: "writable", writable: true });
Object.defineProperty(exports, "enumerable", { value: "enumerable", enumerable: true });
Object.defineProperty(exports, "configurable", { value: "configurable", configurable: true });
exports.plain = "plain";
Object.defineProperty(exports, "writableEnumerable", { value: "writableEnumerable", writable: true, enumerable: true });
Object.defineProperty(exports, "writableConfigurable", { value: "writableConfigurable", writable: true, configurable: true });
Object.defineProperty(exports, "enumerableConfigurable", { value: "enumerableConfigurable", enumerable: true, configurable: true });
Object.defineProperty(exports, "ordinary", { value: "ordinary", writable: true, enumerable: true, configurable: true });
Object.defineProperty(exports, "withoutValue", { enumerable: true });
Object.defineProperty(exports, "emptyDescriptor", {});
Reflect.defineProperty(exports, "reflected", { value: "reflected", configurable: true });
Object.defineProperty(module.exports, "throughModule", { value: "throughModule", enumerable: true });
Object.defineProperty(this, "throughThis", { value: "throughThis", writable: true });
Object.defineProperty(exports, "minified", { value: !0, writable: !1, enumerable: !0, configurable: void 0 });
Object.defineProperty(exports, "functionValue", { value: function () {}, enumerable: true });
Object.defineProperty(exports, "getter", { enumerable: true, get: function () { return ++counter; } });
Object.defineProperty(exports, "hiddenGetter", { get() { return this === exports; } });
Object.defineProperty(exports, "setter", { configurable: true, set(value) { counter = value; } });
Object.defineProperty(exports, "pair", { enumerable: true, configurable: true, get: readCounter, set: value => { counter += value; } });
Object.defineProperty(exports, "fixedPair", { get: readCounter, set: undefined });
Object.defineProperty(exports, "accessorWithoutFunctions", { enumerable: true, get: undefined });
Object.defineProperty(exports, "minifiedGetter", { enumerable: !0, get: function () { return "minified"; } });

exports.change = function change() {
  const lines = [];
  function attempt(label, action) {
    try {
      lines.push(`${label}: ${show(action())}`);
    } catch (error) {
      lines.push(`${label}: threw ${error.constructor.name}`);
    }
  }

  attempt("store to fixed", () => (exports.fixed = "stored"));
  attempt("Reflect.set on fixed", () => Reflect.set(exports, "fixed", "stored"));
  attempt("store to writable", () => (exports.writable = "stored"));
  attempt("store to enumerable", () => (exports.enumerable = "stored"));
  attempt("store to configurable", () => (exports.configurable = "stored"));
  attempt("store to plain", () => (exports.plain = "stored"));
  attempt("store to withoutValue", () => (exports.withoutValue = "stored"));
  attempt("store to throughThis", () => (exports.throughThis = "stored"));
  attempt("append to writableConfigurable", () => (exports.writableConfigurable += "!"));
  attempt("store to getter", () => (exports.getter = "stored"));
  attempt("store to setter", () => (exports.setter = 40));
  attempt("store to pair", () => (exports.pair = 2));
  attempt("increment pair", () => exports.pair++);
  attempt("store to fixedPair", () => (exports.fixedPair = "stored"));
  attempt("store to accessorWithoutFunctions", () => (exports.accessorWithoutFunctions = "stored"));
  attempt("reads", () => [exports.fixed, exports.writable, exports.plain, exports.getter, exports.hiddenGetter, exports.setter, exports.pair, exports.fixedPair, exports.accessorWithoutFunctions, exports.minifiedGetter]);

  attempt("define fixed with its value", () => Object.defineProperty(exports, "fixed", { value: "fixed" }) === exports);
  attempt("define fixed with another value", () => Object.defineProperty(exports, "fixed", { value: "other" }) === exports);
  attempt("Reflect.defineProperty of fixed with another value", () => Reflect.defineProperty(exports, "fixed", { value: "other" }));
  attempt("define fixed with nothing", () => Object.defineProperty(exports, "fixed", {}) === exports);
  attempt("define fixed as enumerable", () => Object.defineProperty(exports, "fixed", { enumerable: true }) === exports);
  attempt("define writable with another value", () => Object.defineProperty(exports, "writable", { value: "defined" }) === exports);
  attempt("define configurable with another value", () => Object.defineProperty(exports, "configurable", { value: "defined" }) === exports);
  attempt("define fixedPair with its getter", () => Object.defineProperty(exports, "fixedPair", { get: readCounter }) === exports);
  attempt("define fixedPair with another getter", () => Object.defineProperty(exports, "fixedPair", { get() { return 0; } }) === exports);
  attempt("define getter as data", () => Object.defineProperty(exports, "getter", { value: "data" }) === exports);
  attempt("the getters are the function that was defined", () => Object.getOwnPropertyDescriptor(exports, "fixedPair").get === readCounter && exports.__lookupGetter__("pair") === readCounter);

  attempt("hide plain", () => Object.defineProperty(exports, "plain", { enumerable: false }) === exports);
  attempt("plain is among the keys", () => Object.keys(exports).includes("plain"));
  attempt("show plain again", () => Object.defineProperty(exports, "plain", { enumerable: true }) === exports);
  attempt("ordinary becomes an accessor", () => Object.defineProperty(exports, "ordinary", { get() { return "accessor now"; } }) === exports);
  attempt("pair becomes data", () => Object.defineProperty(exports, "pair", { value: "data now" }) === exports);
  attempt("setter gains a getter", () => Object.defineProperty(exports, "setter", { get() { return "added getter"; } }) === exports);
  attempt("writableEnumerable becomes read-only", () => Object.defineProperty(exports, "writableEnumerable", { writable: false }) === exports);
  attempt("store to writableEnumerable", () => (exports.writableEnumerable = "stored"));
  attempt("writableConfigurable becomes enumerable", () => Object.defineProperty(exports, "writableConfigurable", { enumerable: true }) === exports);
  attempt("enumerableConfigurable becomes writable", () => Object.defineProperty(exports, "enumerableConfigurable", { writable: true }) === exports);
  attempt("reflected becomes an accessor", () => Reflect.defineProperty(exports, "reflected", { get: readCounter }));

  attempt("delete fixed", () => delete exports.fixed);
  attempt("Reflect.deleteProperty of fixed", () => Reflect.deleteProperty(exports, "fixed"));
  attempt("delete getter", () => delete exports.getter);
  attempt("delete configurable", () => delete exports.configurable);
  attempt("store configurable again", () => (exports.configurable = "stored again"));
  attempt("delete enumerableConfigurable", () => delete exports.enumerableConfigurable);
  attempt("define enumerableConfigurable again", () => Object.defineProperty(exports, "enumerableConfigurable", { value: "defined again", enumerable: true, configurable: true }) === exports);
  attempt("delete plain", () => delete exports.plain);
  attempt("define plain again", () => Object.defineProperty(exports, "plain", { value: "defined again" }) === exports);
  attempt("delete setter", () => delete exports.setter);
  attempt("delete absent", () => delete exports.absent);

  attempt("store storedLater", () => (exports.storedLater = "stored later"));
  attempt("define definedLater", () => Object.defineProperty(exports, "definedLater", { value: "defined later", enumerable: true }) === exports);
  const shared = { value: "shared", enumerable: true };
  attempt("descriptor in a variable", () => Object.defineProperty(exports, "byVariable", shared) === exports);
  attempt("descriptor with a spread", () => Object.defineProperty(exports, "bySpread", { ...shared, writable: true }) === exports);
  attempt("descriptor with computed keys", () => Object.defineProperty(exports, "byComputedKeys", { ["val" + "ue"]: "computed", ["enumerable"]: true }) === exports);
  attempt("descriptor with getters", () => Object.defineProperty(exports, "byGetters", { get value() { return "from a getter"; }, get enumerable() { return true; } }) === exports);
  attempt("descriptor with inherited flags", () => Object.defineProperty(exports, "byInheritedFlags", { __proto__: { enumerable: true, writable: true }, value: "inherited flags" }) === exports);
  attempt("descriptor that is an instance", () => Object.defineProperty(exports, "byInstance", new (class { value = "instance"; get configurable() { return true; } })()) === exports);
  attempt("flag known at run time", () => Object.defineProperty(exports, "byRunTimeFlag", { value: "run time", enumerable: process.argv.length < 100 }) === exports);
  attempt("flags that convert to true", () => Object.defineProperty(exports, "byTruthyFlags", { value: "truthy", writable: 1, enumerable: "yes", configurable: {} }) === exports);
  attempt("flags that convert to false", () => Object.defineProperty(exports, "byFalsyFlags", { value: "falsy", writable: 0, enumerable: "", configurable: null }) === exports);
  attempt("value and getter", () => Object.defineProperty(exports, "valueAndGetter", { value: 1, get() {} }) === exports);
  attempt("Reflect.defineProperty with value and getter", () => Reflect.defineProperty(exports, "valueAndGetter", { value: 1, get() {} }));
  attempt("getter that is no function", () => Object.defineProperty(exports, "badGetter", { get: 1 }) === exports);
  attempt("descriptor that is no object", () => Object.defineProperty(exports, "badDescriptor", 1) === exports);
  attempt("Object.defineProperties", () => Object.defineProperties(exports, { several: { value: "several", enumerable: true }, severalSetter: { set(value) { counter = value; }, configurable: true } }) === exports);
  attempt("Object.assign", () => Object.assign(exports, { assigned: 1, plain: "assigned", alsoAssigned: 2 }) === exports);
  attempt("__defineGetter__", () => exports.__defineGetter__("legacyGetter", function () { return "legacy"; }));
  attempt("__defineSetter__", () => exports.__defineSetter__("legacySetter", function (value) { counter = value; }));
  const define = Object.defineProperty;
  attempt("another name for Object.defineProperty", () => define(exports, "byOtherName", { value: "other name" }) === exports);
  attempt("Object.defineProperty.call", () => Object.defineProperty.call(null, exports, "byCall", { value: "call", enumerable: true }) === exports);
  attempt("a fourth argument", () => Object.defineProperty(exports, "fourArguments", { value: "four" }, "ignored") === exports);
  attempt("store to fourArguments", () => (exports.fourArguments = "stored"));
  attempt("define definedThenStored", () => Object.defineProperties(exports, { definedThenStored: { value: "defined", writable: true } }) === exports);
  attempt("store to definedThenStored", () => (exports.definedThenStored = "stored"));

  const child = Object.create(exports);
  attempt("a child stores over fixed", () => (child.fixed = "child"));
  attempt("a child stores over writable", () => (child.writable = "child"));
  attempt("a child stores over getter", () => (child.getter = "child"));
  attempt("a child stores over severalSetter", () => (child.severalSetter = 70));
  attempt("a child reads", () => [child.fixed, child.writable, child.hiddenGetter, child.fixedPair, child.absent]);
  attempt("keys of the child", () => Object.keys(child));
  return lines;
};
