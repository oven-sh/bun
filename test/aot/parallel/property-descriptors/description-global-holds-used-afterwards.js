// What a description of a property of the global object holds is used afterwards: its getter is called, its function is renamed, it is put back under another name, and it is printed by a console.log of the program.
function show(label, make) {
  try {
    console.log(label, make());
  } catch (error) {
    console.log(label, "threw", error.constructor.name, error.message);
  }
}
const computed = ["na", "vigator"].join("");
const absent = ["no", "such", "name"].join(" ");

// The getter of an accessor of the host is called later, with and without the global object.
const ofNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
show("navigator keys", () => Object.keys(ofNavigator).sort().join());
show("navigator through the description", () => typeof (ofNavigator.get ? ofNavigator.get.call(globalThis) : ofNavigator.value).userAgent);
const ofPerformance = Object.getOwnPropertyDescriptor(globalThis, "performance");
show("performance through the description", () => typeof (ofPerformance.get ? ofPerformance.get.call(globalThis) : ofPerformance.value).now());
const ofProcess = Reflect.getOwnPropertyDescriptor(globalThis, "process");
show("process through the description", () => typeof (ofProcess.get ? ofProcess.get.call(globalThis) : ofProcess.value).pid);

// A getter that the program defined.
let reads = 0;
Object.defineProperty(globalThis, "counted", { get() { return ++reads; }, set(value) { reads = value; }, configurable: true, enumerable: false });
const ofCounted = Object.getOwnPropertyDescriptor(globalThis, "counted");
console.log(ofCounted);
show("getter called later", () => [ofCounted.get(), ofCounted.get.call(null), globalThis.counted, reads].join());
show("setter called later", () => (ofCounted.set(40), [globalThis.counted, reads].join()));

// A function of the program is renamed through the description.
function first() { return new Error("from first").stack.split("\n")[1].trim().split(" ")[1]; }
globalThis.kept = first;
const ofKept = Object.getOwnPropertyDescriptor(globalThis, "kept");
console.log(ofKept);
Object.defineProperty(ofKept.value, "name", { value: "second" });
show("renamed", () => [first.name, globalThis.kept.name, first(), first.bind(null).name].join());

// A method is renamed through a description that is printed first.
class K { v = 1; plain(x) { return this.v + x; } }
globalThis.method = K.prototype.plain;
const ofMethod = Object.getOwnPropertyDescriptor(globalThis, "method");
console.log(ofMethod);
Object.defineProperty(ofMethod.value, "name", { value: "renamed method" });
const k = new K();
show("bound", () => [k.plain.bind(k).name, k.plain.bind(k)(2), k.plain.name].join());

// The name is computed.
show("computed name", () => Object.keys(Object.getOwnPropertyDescriptor(globalThis, computed)).sort().join());
show("computed name that nothing has", () => Object.getOwnPropertyDescriptor(globalThis, absent));
show("computed through Reflect.get", () => typeof Reflect.get(globalThis, computed).userAgent);
show("constant through Reflect.get", () => [typeof Reflect.get(globalThis, "Array"), typeof Reflect.get(globalThis, "no such name"), Reflect.get(globalThis, "counted")].join());

// The description is put back under another name.
Object.defineProperty(globalThis, "List", Object.getOwnPropertyDescriptor(globalThis, "Array"));
show("put back", () => [List === Array, new List(3).length, List.from("ab").join("+")].join());
Object.defineProperty(globalThis, ["other", "counted"].join(""), ofCounted);
show("accessor put back", () => [globalThis.othercounted, globalThis.othercounted, reads].join());
const ofFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch");
Object.defineProperty(globalThis, "get" + "It", ofFetch);
show("host function put back", () => [typeof getIt, getIt === fetch, getIt.name].join());
for (const name of ["URL", "queueMicrotask", "structuredClone"]) Object.defineProperty(globalThis, "my" + name, Object.getOwnPropertyDescriptor(globalThis, name));
show("put back in a loop", () => [new myURL("http://a/b").pathname, typeof myqueueMicrotask, mystructuredClone({ a: [1] }).a[0]].join());

// console.log is replaced by the program.
const log = console.log;
const seen = [];
console.log = (...values) => { for (const value of values) seen.push(value); };
console.log(Object.getOwnPropertyDescriptor(globalThis, "counted"), Object.getOwnPropertyDescriptor(globalThis, "Map"), Object.getOwnPropertyDescriptor(globalThis, "no such name"));
console.log = log;
show("taken by the replaced log", () => [seen.length, seen[0].get(), new seen[1].value([[1, 2]]).get(1), seen[2]].join());
seen[1].value.prototype.extra = function () { return this.size + 100; };
show("changed through what the log took", () => new Map([[1, 1]]).extra());

// An object with a method that the formatter calls sits under the name.
globalThis.custom = { [Symbol.for("nodejs.util.inspect.custom")]() { reads = 1000; return "shown by its own method"; } };
console.log(Object.getOwnPropertyDescriptor(globalThis, "custom"));
show("the formatter ran the method", () => reads);
globalThis.lazy = { get late() { reads = 2000; return 1; } };
console.log(Object.getOwnPropertyDescriptor(globalThis, "lazy"));
show("the formatter ran no getter", () => reads);

// Other objects are described.
const plainObject = { a: 1, get b() { return reads; }, hidden() { return "hidden " + this.a; } };
console.log(Object.getOwnPropertyDescriptor(plainObject, "a"), Object.getOwnPropertyDescriptor(plainObject, "b"), Object.getOwnPropertyDescriptor(plainObject, "zzz"));
show("untouched", () => [plainObject.hidden(), plainObject.b].join());
console.log(Object.getOwnPropertyDescriptor(process, "title") !== undefined, Object.getOwnPropertyDescriptor(Bun, "version") !== undefined, Object.getOwnPropertyDescriptor(console, "log").value === log);
console.log(Object.getOwnPropertyDescriptor(globalThis, "any name"), Object.getOwnPropertyDescriptor(globalThis, "Array"), Object.getOwnPropertyDescriptor(globalThis, "undefined"), Object.getOwnPropertyDescriptor(globalThis, "globalThis").value === globalThis);
