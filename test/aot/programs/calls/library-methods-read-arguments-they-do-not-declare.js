// Methods of the library whose text reads an argument it does not declare (`thisArg`, `initialValue`, `mapFn`, `receiver`) or counts its arguments,
// called where the callee is known and where it is found by name at run time.
const unknown = new Function("value", "return value" + process.argv[0].slice(process.argv[0].length));
const lines = [];
const show = (label, value) => lines.push(label + ": " + (typeof value === "string" ? value : JSON.stringify(value)));

function describeThis() {
  "use strict";
  return this === undefined ? "undefined" : this === null ? "null" : typeof this === "object" ? "object " + this.tag : typeof this + " " + String(this);
}
function describeSloppyThis() {
  return this === globalThis ? "global" : typeof this === "object" ? "object " + (this.tag ?? String(this)) : typeof this;
}

const makeSloppy = new Function("seen", "describe", "return function (value) { seen.push(describe.call(this)); return value > 1; };");

const receiver = { tag: "receiver" };
const arrayMethods = ["every", "forEach", "filter", "map", "some", "find", "findLast", "findIndex", "findLastIndex", "flatMap"];

function callEach(label, list, pick) {
  for (const name of arrayMethods) {
    const seen = [];
    const strict = function (value) { "use strict"; seen.push(describeThis.call(this)); return value > 1; };
    const sloppy = makeSloppy(seen, describeSloppyThis);
    const method = pick(list, name);
    method.call(list, strict);
    method.call(list, strict, undefined);
    method.call(list, strict, null);
    method.call(list, strict, receiver);
    method.call(list, strict, 7);
    method.call(list, strict, receiver, "surplus", "more");
    method.call(list, sloppy);
    method.call(list, sloppy, undefined);
    method.call(list, sloppy, receiver);
    method.call(list, sloppy, "text");
    show(label + " " + name, [...new Set(seen)].join(" | ") + " (" + seen.length + ")");
  }
}
callEach("known", [1, 2], (list, name) => Array.prototype[name]);
callEach("by name", unknown([1, 2]), (list, name) => unknown(list)[name]);

function direct(list, callback, thisArg) {
  return [
    list.map(callback).join(), list.map(callback, thisArg).join(), list.map(callback, thisArg, 1, 2, 3).join(),
    list.filter(callback).length, list.filter(callback, thisArg).length,
    list.some(callback), list.some(callback, thisArg), list.every(callback), list.every(callback, thisArg),
    list.find(callback), list.find(callback, thisArg), list.findIndex(callback, thisArg), list.findLast(callback, thisArg), list.findLastIndex(callback, thisArg),
    list.flatMap(callback).join(), list.flatMap(callback, thisArg).join(),
  ];
}
const tagOrValue = function (value) { "use strict"; return this === undefined ? value : this.tag + value; };
show("direct, known", direct([1, 2, 3], tagOrValue, receiver));
show("direct, by name", direct(unknown([1, 2, 3]), unknown(tagOrValue), unknown(receiver)));

const add = (sum, value) => sum + "+" + value;
function reduceEach(label, list, empty) {
  show(label + " reduce", [list.reduce(add), list.reduce(add, undefined), list.reduce(add, "start"), list.reduce(add, "start", "surplus"), list.reduce(add, null)]);
  show(label + " reduceRight", [list.reduceRight(add), list.reduceRight(add, undefined), list.reduceRight(add, "start"), list.reduceRight(add, "start", "surplus")]);
  show(label + " empty with a value", [empty.reduce(add, undefined) === undefined, empty.reduceRight(add, undefined) === undefined, empty.reduce(add, 0), empty.reduceRight(add, null)]);
  for (const name of ["reduce", "reduceRight"]) {
    try {
      empty[name](add);
      show(label + " empty " + name, "no error");
    } catch (error) {
      show(label + " empty " + name, error.constructor.name + ": " + error.message);
    }
  }
}
reduceEach("known", [1, 2, 3], []);
reduceEach("by name", unknown([1, 2, 3]), unknown([]));

function collections(label, map, set) {
  const seen = [];
  const callback = function (value, key) { "use strict"; seen.push(describeThis.call(this) + " " + key + "=" + value); };
  map.forEach(callback);
  map.forEach(callback, undefined);
  map.forEach(callback, receiver);
  map.forEach(callback, receiver, "surplus");
  set.forEach(callback);
  set.forEach(callback, receiver);
  show(label + " collections", seen.join(" | "));
}
collections("known", new Map([["a", 1]]), new Set(["s"]));
collections("by name", unknown(new Map([["a", 1]])), unknown(new Set(["s"])));

function creators(label, arrayClass, typedClass) {
  const double = function (value, index) { "use strict"; return (this === undefined ? 0 : this.base) + value * 2 + index; };
  const base = { base: 100 };
  show(label + " Array.from", [arrayClass.from([1, 2]), arrayClass.from([1, 2], undefined), arrayClass.from([1, 2], double), arrayClass.from([1, 2], double, base), arrayClass.from([1, 2], double, base, "surplus"), arrayClass.from({ length: 2, 0: 5, 1: 6 }, double, base)]);
  show(label + " typed from", [[...typedClass.from([1, 2])], [...typedClass.from([1, 2], undefined)], [...typedClass.from([1, 2], double)], [...typedClass.from([1, 2], double, base)]]);
  for (const mapFn of [null, 1, "text", {}]) {
    try {
      arrayClass.from([1], mapFn);
      show(label + " Array.from with " + String(mapFn), "no error");
    } catch (error) {
      show(label + " Array.from with " + String(mapFn), error.constructor.name);
    }
  }
}
creators("known", Array, Int32Array);
creators("by name", unknown(Array), unknown(Int32Array));

function reflect(label, reflectObject) {
  const target = { get own() { return this === target ? "target" : this === undefined ? "undefined" : this === null ? "null" : this.tag; } };
  show(label + " Reflect.get", [reflectObject.get(target, "own"), reflectObject.get(target, "own", receiver), reflectObject.get(target, "own", receiver, "surplus")]);
  const strictTarget = Object.defineProperty({}, "own", { get() { "use strict"; return this === undefined ? "undefined" : this === strictTarget ? "target" : typeof this; } });
  show(label + " Reflect.get with undefined", [reflectObject.get(strictTarget, "own"), reflectObject.get(strictTarget, "own", undefined), reflectObject.get(strictTarget, "own", 5)]);
}
reflect("known", Reflect);
reflect("by name", unknown(Reflect));

function iterators(label, values) {
  show(label + " iterator reduce", [values().reduce(add), values().reduce(add, undefined), values().reduce(add, "start"), values().reduce(add, "start", "surplus")]);
  try {
    [].values().reduce(add);
  } catch (error) {
    show(label + " empty iterator reduce", error.constructor.name);
  }
  show(label + " empty iterator reduce with undefined", String([].values().reduce(add, undefined)));
}
iterators("known", () => [1, 2, 3].values());
iterators("by name", () => unknown([1, 2, 3].values()));

show("typed toLocaleString", [new Int32Array([1234, 5]).toLocaleString(), new Int32Array([1234, 5]).toLocaleString("de-DE"), new Float64Array([0.5]).toLocaleString("en-US", { style: "percent" }), unknown(new Float64Array([0.5])).toLocaleString("en-US", { style: "percent" })]);

const described = [
  [Array.prototype, arrayMethods.concat(["reduce", "reduceRight"])], [Array, ["from", "fromAsync"]], [Map.prototype, ["forEach"]], [Set.prototype, ["forEach"]],
  [Reflect, ["get"]], [Object.getPrototypeOf(Int32Array), ["from"]], [Object.getPrototypeOf(Int32Array.prototype), ["toLocaleString"]], [Iterator.prototype, ["reduce"]],
  [Function.prototype, ["call"]], [Promise, ["try"]],
];
for (const [holder, names] of described) {
  for (const name of names) {
    const method = unknown(holder)[name];
    const length = Object.getOwnPropertyDescriptor(method, "length");
    show("function " + method.name, [method.length, length.writable, length.enumerable, length.configurable, "prototype" in method, Object.getOwnPropertyNames(method).sort().join()]);
  }
}

class Tagged extends Array {
  static get [Symbol.species]() { lines.push("species read"); return Tagged; }
}
class Plain extends Array {
  static get [Symbol.species]() { return Array; }
}
function species(label, tagged, plain) {
  const mapped = tagged.map(tagOrValue, receiver);
  const filtered = tagged.filter(function () { "use strict"; return this === receiver; }, receiver);
  const flat = tagged.flatMap(tagOrValue, receiver);
  show(label + " species", [mapped instanceof Tagged, mapped.join(), filtered instanceof Tagged, filtered.length, flat instanceof Tagged, flat.join()]);
  const other = plain.map(tagOrValue, receiver);
  show(label + " species of Array", [other instanceof Plain, Array.isArray(other), other.join()]);
}
species("known", Tagged.from([1, 2]), Plain.from([1, 2]));
species("by name", unknown(Tagged.from([1, 2])), unknown(Plain.from([1, 2])));

const arrayLike = { length: 2, 0: "a", 1: "b" };
show("array-like", [Array.prototype.map.call(arrayLike, tagOrValue, receiver), Array.prototype.reduce.call(arrayLike, add), Array.prototype.reduce.call(unknown(arrayLike), add, undefined)]);
show("apply", [Array.prototype.map.apply([1], [tagOrValue, receiver]), Array.prototype.map.apply([1], [tagOrValue]), Array.prototype.reduce.apply([1, 2], [add, undefined]), Array.prototype.reduce.apply(unknown([1, 2]), unknown([add]))]);
show("spread", [[1].map(...[tagOrValue, receiver]), [1].map(...unknown([tagOrValue])), [1, 2].reduce(...unknown([add, undefined])), [1, 2].reduce(...unknown([add]))]);
show("bound", [Array.prototype.map.bind([1], tagOrValue, receiver)(), Array.prototype.map.bind([1], tagOrValue)(receiver), Array.prototype.reduce.bind([1, 2], add)(), Array.prototype.reduce.bind([1, 2], add)(undefined), Array.prototype.reduce.bind([1, 2], add, undefined)()]);
show("Function.prototype.call", [tagOrValue.call(receiver, 1), tagOrValue.call(undefined, 1), unknown(tagOrValue).call(receiver, 1, 2, 3), Function.prototype.call.call(tagOrValue, receiver, 4), Function.prototype.call.apply(tagOrValue, [receiver, 5])]);

Promise.try(function (...values) { return values.length + ":" + values.join(); }, 1, 2, 3)
  .then(value => show("Promise.try", value))
  .then(() => unknown(Promise).try(function () { return arguments.length; }))
  .then(value => show("Promise.try without arguments", value))
  .then(() => Array.fromAsync([1, 2], function (value) { "use strict"; return this.tag + value; }, receiver))
  .then(value => show("Array.fromAsync", value))
  .then(() => unknown(Array).fromAsync([1, 2]))
  .then(value => show("Array.fromAsync without a function", value))
  .then(() => console.log(lines.join("\n")));
