"use strict";

const log = [];

function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (value instanceof Error) return value.constructor.name;
  const parent = Object.getPrototypeOf(value);
  const kind = parent === Object.prototype || parent === Array.prototype ? "" : parent === null ? "bare " : parent.constructor.name + " ";
  const isList = Array.isArray(value);
  const parts = [];
  if (isList) for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
  for (const key of Reflect.ownKeys(value)) {
    if (isList && typeof key === "string" && (key === "length" || /^\d+$/.test(key))) continue;
    parts.push(String(key) + ": " + show(value[key]));
  }
  return kind + (isList ? "[" : "{") + parts.join(", ") + (isList ? "]" : "}");
}

function outcome(run) {
  log.length = 0;
  try {
    const value = run();
    const effects = log.join(", ");
    return show(value) + (effects ? " | " + effects : "");
  } catch (error) {
    const effects = log.join(", ");
    return "threw " + show(error) + (effects ? " | " + effects : "");
  }
}

function attempt(label, run) {
  console.log(label + " -> " + outcome(run));
}

console.log("strict:", (function () { return this === undefined; })());

class WithFields {
  x = 1;
  y = 2;
}
class Stores {
  constructor() {
    this.x = 1;
    this.y = 2;
  }
}
class Derived extends WithFields {
  z = 3;
}
function Old() {
  this.x = 1;
  this.y = 2;
}
class OfArray extends Array {}
class OfMap extends Map {}
class OfError extends Error {}
class OfPromise extends Promise {}
class OfBytes extends Uint8Array {}
class OfObject extends Object {}
class OfDate extends Date {}
class Unrelated {
  u = 9;
}
const bound = function () {}.bind(null);
const proxied = new Proxy(class Behind {}, {
  get(target, key, receiver) {
    log.push("get " + String(key));
    return Reflect.get(target, key, receiver);
  },
});
function numbered() {}
numbered.prototype = 5;
function listed() {}
listed.prototype = [];

function describe(made, prototype) {
  return [Object.keys(made).join(), made.x + made.y, made.z, Array.isArray(made), Object.getPrototypeOf(made) === prototype];
}

attempt("a class with fields for itself", () => describe(new WithFields(), WithFields.prototype));
attempt("a class with fields for a subclass of Array", () => describe(Reflect.construct(WithFields, [], OfArray), OfArray.prototype));
attempt("a class with fields for a subclass of Map", () => describe(Reflect.construct(WithFields, [], OfMap), OfMap.prototype));
attempt("a class with fields for a subclass of Error", () => describe(Reflect.construct(WithFields, [], OfError), OfError.prototype));
attempt("a class with fields for a subclass of Promise", () => describe(Reflect.construct(WithFields, [], OfPromise), OfPromise.prototype));
attempt("a class with fields for a subclass of Uint8Array", () => describe(Reflect.construct(WithFields, [], OfBytes), OfBytes.prototype));
attempt("a class with fields for a subclass of Object", () => describe(Reflect.construct(WithFields, [], OfObject), OfObject.prototype));
attempt("a class with fields for a subclass of Date", () => describe(Reflect.construct(WithFields, [], OfDate), OfDate.prototype));
attempt("a class with fields for an unrelated class with fields", () => describe(Reflect.construct(WithFields, [], Unrelated), Unrelated.prototype));
attempt("a class with fields for Array itself", () => describe(Reflect.construct(WithFields, [], Array), Array.prototype));
attempt("a class with fields for Map itself", () => describe(Reflect.construct(WithFields, [], Map), Map.prototype));
attempt("a class with fields for a bound function", () => describe(Reflect.construct(WithFields, [], bound), Object.prototype));
attempt("a class with fields for a proxy of a class", () => describe(Reflect.construct(WithFields, [], proxied), proxied.prototype));
attempt("a class with fields for a function whose prototype is a number", () => describe(Reflect.construct(WithFields, [], numbered), Object.prototype));
attempt("a class with fields for a function whose prototype is an array", () => describe(Reflect.construct(WithFields, [], listed), listed.prototype));
attempt("a class with fields for itself again", () => describe(new WithFields(), WithFields.prototype));

attempt("a class that stores in its constructor for itself", () => describe(new Stores(), Stores.prototype));
attempt("a class that stores in its constructor for a subclass of Array", () => describe(Reflect.construct(Stores, [], OfArray), OfArray.prototype));
attempt("a class that stores in its constructor for a subclass of Map", () => describe(Reflect.construct(Stores, [], OfMap), OfMap.prototype));
attempt("a class that stores in its constructor for a subclass of Error", () => describe(Reflect.construct(Stores, [], OfError), OfError.prototype));
attempt("a class that stores in its constructor for a subclass of Promise", () => describe(Reflect.construct(Stores, [], OfPromise), OfPromise.prototype));
attempt("a class that stores in its constructor for a subclass of Uint8Array", () => describe(Reflect.construct(Stores, [], OfBytes), OfBytes.prototype));
attempt("a class that stores in its constructor for a subclass of Object", () => describe(Reflect.construct(Stores, [], OfObject), OfObject.prototype));
attempt("a class that stores in its constructor for a subclass of Date", () => describe(Reflect.construct(Stores, [], OfDate), OfDate.prototype));
attempt("a class that stores in its constructor for an unrelated class with fields", () => describe(Reflect.construct(Stores, [], Unrelated), Unrelated.prototype));
attempt("a class that stores in its constructor for Array itself", () => describe(Reflect.construct(Stores, [], Array), Array.prototype));
attempt("a class that stores in its constructor for Map itself", () => describe(Reflect.construct(Stores, [], Map), Map.prototype));
attempt("a class that stores in its constructor for a bound function", () => describe(Reflect.construct(Stores, [], bound), Object.prototype));
attempt("a class that stores in its constructor for a proxy of a class", () => describe(Reflect.construct(Stores, [], proxied), proxied.prototype));
attempt("a class that stores in its constructor for a function whose prototype is a number", () => describe(Reflect.construct(Stores, [], numbered), Object.prototype));
attempt("a class that stores in its constructor for a function whose prototype is an array", () => describe(Reflect.construct(Stores, [], listed), listed.prototype));
attempt("a class that stores in its constructor for itself again", () => describe(new Stores(), Stores.prototype));

attempt("a derived class for itself", () => describe(new Derived(), Derived.prototype));
attempt("a derived class for a subclass of Array", () => describe(Reflect.construct(Derived, [], OfArray), OfArray.prototype));
attempt("a derived class for a subclass of Map", () => describe(Reflect.construct(Derived, [], OfMap), OfMap.prototype));
attempt("a derived class for a subclass of Error", () => describe(Reflect.construct(Derived, [], OfError), OfError.prototype));
attempt("a derived class for a subclass of Promise", () => describe(Reflect.construct(Derived, [], OfPromise), OfPromise.prototype));
attempt("a derived class for a subclass of Uint8Array", () => describe(Reflect.construct(Derived, [], OfBytes), OfBytes.prototype));
attempt("a derived class for a subclass of Object", () => describe(Reflect.construct(Derived, [], OfObject), OfObject.prototype));
attempt("a derived class for a subclass of Date", () => describe(Reflect.construct(Derived, [], OfDate), OfDate.prototype));
attempt("a derived class for an unrelated class with fields", () => describe(Reflect.construct(Derived, [], Unrelated), Unrelated.prototype));
attempt("a derived class for Array itself", () => describe(Reflect.construct(Derived, [], Array), Array.prototype));
attempt("a derived class for Map itself", () => describe(Reflect.construct(Derived, [], Map), Map.prototype));
attempt("a derived class for a bound function", () => describe(Reflect.construct(Derived, [], bound), Object.prototype));
attempt("a derived class for a proxy of a class", () => describe(Reflect.construct(Derived, [], proxied), proxied.prototype));
attempt("a derived class for a function whose prototype is a number", () => describe(Reflect.construct(Derived, [], numbered), Object.prototype));
attempt("a derived class for a function whose prototype is an array", () => describe(Reflect.construct(Derived, [], listed), listed.prototype));
attempt("a derived class for itself again", () => describe(new Derived(), Derived.prototype));

attempt("a constructor function for itself", () => describe(new Old(), Old.prototype));
attempt("a constructor function for a subclass of Array", () => describe(Reflect.construct(Old, [], OfArray), OfArray.prototype));
attempt("a constructor function for a subclass of Map", () => describe(Reflect.construct(Old, [], OfMap), OfMap.prototype));
attempt("a constructor function for a subclass of Error", () => describe(Reflect.construct(Old, [], OfError), OfError.prototype));
attempt("a constructor function for a subclass of Promise", () => describe(Reflect.construct(Old, [], OfPromise), OfPromise.prototype));
attempt("a constructor function for a subclass of Uint8Array", () => describe(Reflect.construct(Old, [], OfBytes), OfBytes.prototype));
attempt("a constructor function for a subclass of Object", () => describe(Reflect.construct(Old, [], OfObject), OfObject.prototype));
attempt("a constructor function for a subclass of Date", () => describe(Reflect.construct(Old, [], OfDate), OfDate.prototype));
attempt("a constructor function for an unrelated class with fields", () => describe(Reflect.construct(Old, [], Unrelated), Unrelated.prototype));
attempt("a constructor function for Array itself", () => describe(Reflect.construct(Old, [], Array), Array.prototype));
attempt("a constructor function for Map itself", () => describe(Reflect.construct(Old, [], Map), Map.prototype));
attempt("a constructor function for a bound function", () => describe(Reflect.construct(Old, [], bound), Object.prototype));
attempt("a constructor function for a proxy of a class", () => describe(Reflect.construct(Old, [], proxied), proxied.prototype));
attempt("a constructor function for a function whose prototype is a number", () => describe(Reflect.construct(Old, [], numbered), Object.prototype));
attempt("a constructor function for a function whose prototype is an array", () => describe(Reflect.construct(Old, [], listed), listed.prototype));
attempt("a constructor function for itself again", () => describe(new Old(), Old.prototype));
