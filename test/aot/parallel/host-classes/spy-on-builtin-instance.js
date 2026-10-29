// `spyOn` on an object that only inherits from a locked prototype, and on objects, classes and functions of the program, behaves as in plain Bun: the spy is called, `mockRestore` undoes it, and the own property it defines has the attributes the member had before the lock.
import { spyOn } from "bun:test";

const descriptorText = (target, name) =>
  JSON.stringify(Object.getOwnPropertyDescriptor(target, name), (key, value) =>
    typeof value === "function" ? "function" : value,
  );

function spyAndRestore(label, target, name, call) {
  console.log(label + ": " + call());
  const spy = spyOn(target, name).mockReturnValue("spied");
  console.log(label + " spied: " + call() + ", calls " + spy.mock.calls.length + ", " + descriptorText(target, name));
  spy.mockRestore();
  console.log(label + " restored: " + call() + ", " + descriptorText(target, name));
}

class Service {
  method() {
    return "real";
  }
}

class Counter {
  count = 1;
  step = 2;
}

const list = [1];
const map = new Map([[1, 2]]);
const date = new Date(0);
const headers = new Headers({ a: "1" });
const service = new Service();
const frozen = Object.freeze({
  method() {
    return "real";
  },
});

spyAndRestore("array.push", list, "push", () => list.push(2));
spyAndRestore("map.get", map, "get", () => map.get(1));
spyAndRestore("date.getTime", date, "getTime", () => date.getTime());
spyAndRestore("headers.get", headers, "get", () => headers.get("a"));
spyAndRestore("instance.method", service, "method", () => service.method());
spyAndRestore("Service.prototype.method", Service.prototype, "method", () => new Service().method());
spyAndRestore("frozen.method", frozen, "method", () => frozen.method());

for (const restrict of [Object.preventExtensions, Object.seal, Object.freeze]) {
  const restricted = restrict(new Service());
  spyAndRestore(restrict.name + " instance.method", restricted, "method", () => restricted.method());
}

const point = { x: 1, y: 2 };
spyAndRestore("point.x", point, "x", () => point.x);
console.log("point keys: " + Object.keys(point));
const counter = new Counter();
spyAndRestore("counter.count", counter, "count", () => counter.count);
console.log("counter keys: " + Object.keys(counter));

const pushSpy = spyOn(list, "push").mockReturnValue("spied");
console.log("another array: " + [1].push(2) + ", calls " + pushSpy.mock.calls.length);
pushSpy.mockRestore();

const createFunctions = () => ({
  method(a, b) {},
  arrow: a => a,
  named: function written(a, b, c) {},
  asynchronous: async function (a, b, c, d) {},
});

function printNames(label, functions) {
  for (const key of Object.keys(functions)) {
    const spy = spyOn(functions, key);
    console.log(label + " " + key + ": " + JSON.stringify([spy.getMockName(), spy.name, spy.length]));
    spy.mockRestore();
  }
}

printNames("never touched", createFunctions());
const extended = createFunctions();
for (const key of Object.keys(extended)) extended[key].extra = 1;
printNames("with an added property", extended);

function printError(label, install) {
  try {
    install();
    console.log(label + ": no error");
  } catch (error) {
    console.log(label + ": " + error.name + ": " + error.message);
  }
}

printError("prototype of a function", () => spyOn(function () {}, "prototype"));
printError("prototype of an arrow function", () => spyOn(createFunctions().arrow, "prototype"));
