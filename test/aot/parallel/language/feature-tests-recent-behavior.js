// Feature tests that a polyfill (core-js) runs when it loads, for behavior that engines got right only lately: Promise.try, includes on sparse arrays, limits of iterator helpers, helpers that close their iterator, set methods on set-like objects, iteration that is closed when a callback throws. Each answers as in plain Bun, also where the compiler expands the method itself.
function attempt(label, run) {
  try { console.log(label + ": " + String(run())); } catch (error) { console.log(label + ": " + error.constructor.name); }
}

attempt("Promise.try hands on its arguments and returns the promise it gets", () => {
  const promise = Promise.resolve();
  let given;
  const result = Promise.try(argument => { given = argument; return promise; }, 8);
  return [result === promise, given].join();
});

attempt("includes on sparse arrays", () => [Array(1).includes(), [, 1].includes(undefined, 1), [, 1].includes(undefined), [1, , 2].includes(undefined, 2), [NaN].includes(NaN), [, ,].includes(undefined, -1)].join());
function includesFrom(list, value, from) { return list.includes(value, from); }
attempt("the same through a function", () => [includesFrom([, 1], undefined, 1), includesFrom([, 1], undefined, 0), includesFrom([1.5, , 2.5], undefined, 2), includesFrom(["a", , "b"], undefined, 1)].join());

for (const name of ["take", "drop"]) {
  attempt(name + " with a limit past the safe integers", () => Iterator.prototype[name].call({ next() { return { done: true }; } }, 0x20000000000000));
  attempt(name + " with Infinity", () => typeof Iterator.prototype[name].call({ next() { return { done: true }; } }, Infinity));
  attempt(name + " with NaN", () => Iterator.prototype[name].call({ next() { return { done: true }; } }, NaN));
}
for (const [name, Expected] of [["take", RangeError], ["drop", RangeError], ["map", TypeError], ["filter", TypeError], ["flatMap", TypeError], ["forEach", TypeError], ["some", TypeError], ["every", TypeError], ["find", TypeError], ["reduce", TypeError]]) {
  attempt(name + " closes the iterator on a bad argument", () => {
    let closed = false;
    let right = false;
    try {
      Iterator.prototype[name].call({ next() { return { done: true }; }, return() { closed = true; return {}; } }, -1);
    } catch (error) {
      right = error instanceof Expected;
    }
    return [closed, right].join();
  });
}
for (const [name, argument] of [["take", 1], ["drop", 0], ["map", () => 1], ["filter", () => true], ["flatMap", () => []]]) {
  attempt(name + " on an iterator whose next is null", () => Iterator.prototype[name].call({ next: null }, argument).next());
}

const emptySetLike = size => ({ size, has() { return false; }, keys() { return { next() { return { done: true }; } }; } });
const endlessSetLike = size => ({ size, has() { return true; }, keys() { throw new Error("keys was called"); } });
for (const name of ["union", "intersection", "difference", "symmetricDifference", "isSubsetOf", "isSupersetOf", "isDisjointFrom"]) {
  attempt(name + " takes a set-like object", () => { const result = new Set([1])[name](emptySetLike(0)); return typeof result === "boolean" ? result : [...result].join("+"); });
  attempt(name + " refuses a negative size", () => new Set()[name](emptySetLike(-1)));
  attempt(name + " refuses a size of -Infinity", () => new Set()[name](endlessSetLike(-Infinity)));
  attempt(name + " with a size of Infinity", () => { const result = new Set([1, 2])[name](endlessSetLike(Infinity)); return typeof result === "boolean" ? result : result.size; });
}
for (const name of ["union", "symmetricDifference"]) {
  attempt(name + " asks for the keys before it copies the set", () => {
    const base = new Set();
    const setLike = {
      size: 0,
      has() { return true; },
      keys() { return Object.defineProperty({}, "next", { get() { base.clear(); base.add(4); return () => ({ done: true }); } }); },
    };
    const result = base[name](setLike);
    return [result.size, result.values().next().value].join();
  });
}
attempt("difference while the set is cleared", () => {
  const base = new Set([1, 2, 3, 4]);
  const setLike = {
    size: 1,
    has() { return true; },
    keys() { let index = 0; return { next() { const done = index++ > 1; if (base.has(1)) base.clear(); return { done, value: 2 }; } }; },
  };
  return base.difference(setLike).size;
});

attempt("Array.from closes the iterator when the callback throws", () => {
  let closed = false;
  let called = 0;
  const iterator = { next() { return { done: !!called++ }; }, return() { closed = true; return {}; }, [Symbol.iterator]() { return this; } };
  try { Array.from(iterator, () => { throw 2; }); } catch (error) { return [closed, error].join(); }
  return "nothing was thrown";
});
function iterates(run) {
  let asked = false;
  const object = { [Symbol.iterator]() { return { next() { return { done: (asked = true) }; } }; } };
  try { run(object); } catch (error) { return asked + " " + error.constructor.name; }
  return asked;
}
attempt("who iterates an object with Symbol.iterator", () => [
  iterates(object => Array.from(object)), iterates(object => new Map(object)), iterates(object => new Set(object)), iterates(object => new WeakMap(object)), iterates(object => new WeakSet(object)),
  iterates(object => new Int8Array(object)), iterates(object => new Float64Array(object)),
  iterates(object => { Promise.all(object).then(undefined, () => {}); }), iterates(object => { Promise.race(object).then(undefined, () => {}); }),
  iterates(object => { Promise.any(object).then(undefined, () => {}); }), iterates(object => { Promise.allSettled(object).then(undefined, () => {}); }),
  iterates(object => Object.fromEntries(object)), iterates(object => [...object]), iterates(([first]) => first),
].join());
attempt("constructors close the iterator on an entry that is no object", () => {
  const outcomes = [];
  for (const Class of [Map, WeakMap]) {
    let closed = false;
    const iterator = { next() { return { done: false, value: 1 }; }, return() { closed = true; return {}; }, [Symbol.iterator]() { return this; } };
    try { new Class(iterator); } catch (error) { outcomes.push(Class.name + " " + closed + " " + error.constructor.name); }
  }
  return outcomes.join();
});
