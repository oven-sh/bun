// What reflection says about one function of each kind: typeof, name, length, source text, the name and length after bind, the class string and `caller`. Each question gets a new function object: first one that was only called, then one that also has an own property.
const kinds = {
  sloppy: () =>
    function sloppy(a, b) {
      return a;
    },
  strict: () =>
    function strict(a, b, c) {
      "use strict";
      return a;
    },
  arrow: () => {
    const arrow = (a, b) => a;
    return arrow;
  },
  method: () =>
    ({
      method(a) {
        return a;
      },
    }).method,
  class: () =>
    class Point {
      constructor(x, y) {
        this.x = x;
      }
    },
  generator: () =>
    function* generator(a) {
      yield a;
    },
  async: () =>
    async function asynchronous(a, b) {
      return a;
    },
  "async generator": () =>
    async function* asyncGenerator(a) {
      yield a;
    },
  bound: () =>
    function target(a, b, c) {
      return a;
    }.bind(null),
  "bound method": () => {
    const holder = {
      method(a, b, c) {
        return a;
      },
    };
    return holder.method.bind(holder);
  },
  "bound arrow": () => {
    const arrow = (a, b, c) => a;
    return arrow.bind(null);
  },
};

const questions = {
  typeof: f => typeof f,
  name: f => f.name,
  length: f => f.length,
  "source text": f => String(f).replace(/\s+/g, " "),
  "name after bind": f => f.bind(null).name,
  "length after bind": f => f.bind(null, 1).length,
  "class string": f => Object.prototype.toString.call(f),
  caller: f => Reflect.get(Function.prototype, "caller", f),
};

const states = {
  "only called": f => {},
  "with an own property": f => {
    f.extra = 1;
  },
};

function answer(question, f) {
  try {
    return String(question(f));
  } catch (error) {
    return error.constructor.name;
  }
}

for (const [kind, create] of Object.entries(kinds)) {
  for (const [state, prepare] of Object.entries(states)) {
    for (const [name, question] of Object.entries(questions)) {
      const f = create();
      if (kind === "class") new f(1, 2);
      else f(1, 2);
      prepare(f);
      console.log(`${kind}, ${state}, ${name}: ${answer(question, f)}`);
    }
  }
}

class B extends Map {}
const describe = map => [map instanceof B, map instanceof Map, Map.prototype.set.call(map, 1, 2) === map].join();
for (let i = 0; i < 2; i++) console.log("new.target is a class:", describe(Reflect.construct(Map, [], B)));
console.log("new.target is a function:", describe(Reflect.construct(Map, [], function () {})));

// Makes this file CommonJS: in an ES module every function is strict.
module.exports = {};
