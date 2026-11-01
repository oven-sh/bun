// util.types.isAsyncFunction, isGeneratorFunction and isGeneratorObject classify every kind of function and generator object by its declaration, before and after a property is added to it.
import { types } from "node:util";

function declaration() {}
const expression = function () {};
const arrow = () => {};
async function asyncFunction() {}
const asyncArrow = async () => {};
function* generator() {
  yield 1;
}
async function* asyncGenerator() {
  yield 1;
}
class C {
  method() {}
  async asyncMethod() {}
  *generatorMethod() {
    yield 1;
  }
  async *asyncGeneratorMethod() {
    yield 1;
  }
  static async staticAsyncMethod() {}
  get getter() {
    return 1;
  }
}

function classify(name: string, value: unknown) {
  console.log(name, types.isAsyncFunction(value), types.isGeneratorFunction(value), types.isGeneratorObject(value));
}
function classifyTwice(entries: [string, unknown][]) {
  for (const [name, value] of entries) {
    classify(name, value);
    (value as any).extra = 1;
    classify(name + " with a property", value);
  }
}

classifyTwice([
  ["function declaration", declaration],
  ["function expression", expression],
  ["arrow function", arrow],
  ["async function", asyncFunction],
  ["async arrow function", asyncArrow],
  ["generator function", generator],
  ["async generator function", asyncGenerator],
  ["method", C.prototype.method],
  ["async method", C.prototype.asyncMethod],
  ["generator method", C.prototype.generatorMethod],
  ["async generator method", C.prototype.asyncGeneratorMethod],
  ["static async method", C.staticAsyncMethod],
  ["getter", Object.getOwnPropertyDescriptor(C.prototype, "getter")!.get],
  ["class", C],
  ["bound async function", asyncFunction.bind(null)],
  ["bound generator function", generator.bind(null)],
]);

const finished = generator();
while (!finished.next().done);
classifyTwice([
  ["generator object", generator()],
  ["async generator object", asyncGenerator()],
  ["generator method object", new C().generatorMethod()],
  ["finished generator object", finished],
]);

const others: [string, unknown][] = [
  ["Math.max", Math.max],
  ["Promise.resolve", Promise.resolve],
  ["object with next", { next() {} }],
  ["array iterator", [][Symbol.iterator]()],
  ["promise", Promise.resolve()],
  ["null", null],
  ["number", 1],
  ["string", "function*"],
];
for (const [name, value] of others) classify(name, value);
