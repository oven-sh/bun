function describe(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return value.length > 120 ? JSON.stringify(value.slice(0, 60)) + " and " + (value.length - 60) + " more characters" : JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const prototype = Object.getPrototypeOf(value);
  const parts = [];
  for (const key of Reflect.ownKeys(value)) {
    const property = Reflect.getOwnPropertyDescriptor(value, key);
    parts.push(String(key) + ": " + ("value" in property ? describe(property.value) : "accessor"));
  }
  if (value instanceof Set || value instanceof Map) for (const entry of value) parts.push(describe(entry));
  if (parts.length > 16) parts.splice(8, parts.length - 16, "and " + (parts.length - 16) + " more");
  const name = prototype === null ? "no prototype" : prototype.constructor.name;
  return name + (Array.isArray(value) ? " [" + parts.join(", ") + "]" : " {" + parts.join(", ") + "}");
}

function attempt(label, run) {
  try {
    console.log(label + ": " + describe(run()));
  } catch (error) {
    console.log(label + ": threw " + error.constructor.name);
  }
}

var length = "the outer length";
var keys = "the outer keys";
var values = "the outer values";
var at = "the outer at";
var extra = "the outer extra";

function push() {
  return "the outer push";
}

function join() {
  return "the outer join";
}

function readLength(list) {
  with (list) {
    return length;
  }
}

function callPush(list) {
  with (list) {
    return push(9);
  }
}

function callJoin(list) {
  with (list) {
    return join("-");
  }
}

function readUnscopables(list) {
  with (list) {
    return [typeof keys, typeof values, typeof at];
  }
}

function storeLength(list) {
  with (list) {
    length = 1;
  }
  return [typeof list === "object" && list !== null ? list.length : "no object", length];
}

function readExtra(list) {
  with (list) {
    return extra;
  }
}

function loop(list) {
  var total = 0;
  with (list) {
    for (var i = 0; i < length; i++) total += list[i];
  }
  return total;
}

var uses = { readLength: readLength, callPush: callPush, callJoin: callJoin, readUnscopables: readUnscopables, storeLength: storeLength, readExtra: readExtra, loop: loop };

var makers = {
  "an array": function () { return [3, 1, 2]; },
  "an array with an extra member": function () { return Object.assign([3, 1, 2], { extra: "the list's extra" }); },
  "an array with its own push": function () { return Object.assign([3, 1, 2], { push: function () { return "its own push"; } }); },
  "an array with its own unscopables": function () { return Object.defineProperty([3, 1, 2], Symbol.unscopables, { value: { push: true, length: true } }); },
  "an array under null": function () { return Object.setPrototypeOf([3, 1, 2], null); },
  "an array-like": function () { return { 0: 3, 1: 1, 2: 2, length: 3 }; },
  "a string": function () { return "312"; },
  "a typed array": function () { return new Uint8Array([3, 1, 2]); },
  "a Set": function () { return new Set([3, 1, 2]); },
  "a frozen array": function () { return Object.freeze([3, 1, 2]); },
  "a proxy that has everything": function () { return new Proxy([3, 1, 2], { has: function () { return true; } }); },
  "an empty object": function () { return {}; },
  "a number": function () { return 5; },
  "null": function () { return null; },
};

for (var use in uses) for (var i = 0; i < 500; i++) uses[use]([3, 1, 2]);

Object.keys(makers).forEach(function (name) {
  Object.keys(uses).forEach(function (use) {
    length = "the outer length";
    attempt(name + ", " + use, function () { return uses[use](makers[name]()); });
  });
});
