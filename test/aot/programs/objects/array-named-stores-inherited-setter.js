// Three named stores in a row to an array. They must still find a setter, a read-only property or a proxy on the array's prototype chain, and must fail on an array that cannot be extended. When one store throws, the earlier stores have taken effect and the later ones have not.
"use strict";

const log = [];

function describe(list) {
  return `${JSON.stringify(list)} [${Object.keys(list).join()}] ${JSON.stringify(list.first)} ${JSON.stringify(list.second)} ${JSON.stringify(list.third)}`;
}

function tag(list, i) {
  list.first = "first" + i;
  list.second = [i];
  list.third = { at: i };
  return list;
}

function attempt(label, list, i) {
  try {
    tag(list, i);
  } catch (error) {
    console.log(label, error.name);
  }
  console.log(label, describe(list), log.splice(0).join());
}

function withPrototype(prototype) {
  const list = [1, 2];
  Object.setPrototypeOf(list, prototype);
  return list;
}

let total = 0;
for (let round = 0; round < 1000; round++) total += tag([round, round + 1], round).second[0];
console.log("fresh", total, describe(tag([1, 2], 3)));

attempt("empty", [], 1);
attempt("doubles", [0.5, 1.5], 2);
attempt("strings", ["a", "b"], 3);
attempt("holes", [1, , 3], 4);

const sparse = [];
sparse[100000] = "last";
tag(sparse, 5);
console.log("sparse", sparse.length, Object.keys(sparse).join(), JSON.stringify(sparse.third));

const partly = [1];
partly.second = "old";
attempt("one exists", partly, 6);
attempt("all exist", tag([1], 7), 8);

const withSetter = Object.create(Array.prototype, {
  second: {
    configurable: true,
    set(value) {
      log.push("set second " + JSON.stringify(value));
    },
  },
});
attempt("inherited setter", withPrototype(withSetter), 9);

const withReadOnly = Object.create(Array.prototype, { third: { value: "fixed", writable: false } });
attempt("inherited read-only", withPrototype(withReadOnly), 10);

const changing = Object.create(Array.prototype);
for (let round = 0; round < 4; round++) {
  if (round === 2) {
    Object.defineProperty(changing, "first", {
      configurable: true,
      set(value) {
        log.push("set first " + value);
      },
    });
  }
  attempt("setter round " + round, withPrototype(changing), round);
}

const trapping = new Proxy(Object.create(Array.prototype), {
  set(target, key, value, receiver) {
    log.push("trap " + String(key));
    return Reflect.set(target, key, value, receiver);
  },
});
attempt("proxy", withPrototype(trapping), 11);

class Tagged extends Array {
  set second(value) {
    log.push("class setter " + JSON.stringify(value));
  }
}
attempt("subclass", Tagged.of(1, 2), 12);

attempt("not extensible", Object.preventExtensions([1, 2]), 13);
attempt("frozen", Object.freeze([1, 2]), 14);
attempt("sealed with names", Object.seal(tag([1], 15)), 16);
attempt("frozen with names", Object.freeze(tag([1], 17)), 18);

const kept = [];
for (let round = 0; round < 2000; round++) {
  const list = tag([round], round);
  if (round % 500 === 0) kept.push(list);
}
Bun.gc(true);
for (const list of kept) console.log("kept", describe(list));
