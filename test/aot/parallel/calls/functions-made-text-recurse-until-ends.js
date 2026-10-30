// A function made from text calls back into the program, which calls it again, until the stack ends. Each way of calling it ends in a RangeError that has a stack, and the next call works.
let again = () => 0;
globalThis.callAgain = () => again();

const locals = Array.from({ length: 400 }, (_, i) => "v" + i);
const parameters = Array.from({ length: 300 }, (_, i) => "p" + i);
const declareLocals = `var ${locals.join()};`;
const fillLocals = locals.map(name => `${name} = this;`).join("");
const shapes = {
  "few locals": [[], "return callAgain();"],
  "many locals": [[], `${declareLocals} ${fillLocals} return callAgain(v399);`],
  "many parameters": [parameters, "return callAgain(p299);"],
  "a handler": [[], `${declareLocals} try { return callAgain(v399); } catch (error) { throw error; }`],
};

const ways = {
  call: f => f(),
  setter: f => {
    const object = {};
    Object.defineProperty(object, "member", { set: f });
    object.member = 1;
  },
  getter: f => {
    const object = {};
    Object.defineProperty(object, "member", { get: f });
    return object.member;
  },
  "proxy get": f => new Proxy({}, { get: f }).member,
  "proxy set": f => {
    new Proxy({}, { set: f }).member = 1;
  },
  "proxy has": f => "member" in new Proxy({}, { has: f }),
  "proxy apply": f => new Proxy(function () {}, { apply: f })(),
  "proxy of it": f => new Proxy(f, {})(),
  bound: f => f.bind({})(),
  "bound setter": f => {
    const object = {};
    Object.defineProperty(object, "member", { set: f.bind({}) });
    object.member = 1;
  },
  "bound in map": f => [1].map(f.bind({})),
  sort: f => [2, 1].sort(f),
  replace: f => "a".replace(/a/, f),
  "Reflect.apply": f => Reflect.apply(f, {}, []),
  "Function.prototype.call": f => f.call({}),
  new: f => new f(),
  "Reflect.construct": f => Reflect.construct(f, []),
  "base class": f => new (class extends f {})(),
  toString: f => `${{ toString: f }}`,
  valueOf: f => +{ valueOf: f },
  toJSON: f => JSON.stringify({ toJSON: f }),
  iterator: f => [...{ [Symbol.iterator]: f }],
};

function runAll() {
  const lines = [];
  for (const [shape, [names, body]] of Object.entries(shapes)) {
    const results = [];
    for (const [way, call] of Object.entries(ways)) {
      const f = new Function(...names, body);
      again = () => call(f);
      let result;
      try {
        result = "returned " + typeof again();
      } catch (error) {
        const lines = String(error.stack).split("\n");
        result = error.name + (lines[0].startsWith("RangeError: ") && lines.length > 1 ? "" : " without a stack");
      }
      again = () => 7;
      try {
        call(f);
      } catch (error) {
        if (!(error instanceof TypeError)) result += ", then " + error.name;
      }
      results.push(way + ": " + result);
    }
    lines.push(shape + " | " + results.join(" | "));
  }
  return lines.join("\n");
}

if (Bun.isMainThread) {
  const here = runAll();
  console.log(here);
  const worker = new Worker(new URL(import.meta.url));
  const there = await new Promise(resolve => {
    worker.onmessage = event => resolve(event.data);
    worker.onerror = event => (resolve("error " + event.message), event.preventDefault());
  });
  console.log(there === here ? "the same in a worker" : there);
  worker.terminate();
} else postMessage(runAll());
