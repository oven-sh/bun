// Feature tests that polyfills (core-js, es5-ext) run when they load: an array or a promise whose own `constructor` names a species, an array that says it is not spreadable, array subclasses written with functions. A test that fails makes the library replace a member of a built-in prototype, so each answers as in plain Bun.
function attempt(label, run) {
  try { console.log(label + ": " + String(run())); } catch (error) { console.log(label + ": " + error.constructor.name); }
}

for (const method of ["filter", "map", "slice", "splice", "concat"]) {
  attempt("[]." + method + " asks the species of an own constructor", () => {
    const list = [];
    const constructor = (list.constructor = {});
    constructor[Symbol.species] = function () { return { made: 1 }; };
    return list[method](Boolean).made;
  });
}
attempt("the same five by name", () => {
  const make = () => {
    const list = [1, 2];
    list.constructor = { [Symbol.species]: function (length) { return { made: String(length) }; } };
    return list;
  };
  return [make().filter(Boolean).made, make().map(Boolean).made, make().slice(1).made, make().splice(0, 1).made, make().concat([3]).made].join();
});
attempt("a species that is undefined or null gives an array", () => {
  const list = [1];
  list.constructor = { [Symbol.species]: undefined };
  const other = [1];
  other.constructor = { [Symbol.species]: null };
  return [Array.isArray(list.map(Boolean)), Array.isArray(other.slice())].join();
});
attempt("an own constructor that is no object", () => { const list = [1]; list.constructor = 5; return list.map(Boolean); });

attempt("an array that is not spreadable is concatenated whole", () => {
  const list = [];
  list[Symbol.isConcatSpreadable] = false;
  return list.concat()[0] === list;
});
attempt("as an argument too", () => {
  const list = [1, 2];
  list[Symbol.isConcatSpreadable] = false;
  const result = [0].concat(list, [3]);
  return [result.length, result[1] === list].join();
});
attempt("an object that says it is spreadable", () => [0].concat({ length: 2, 0: "a", 1: "b", [Symbol.isConcatSpreadable]: true }).join());

attempt("then asks the species of an own constructor", () => {
  const promise = new Promise(resolve => { resolve(1); });
  function Other(executor) { executor(() => {}, () => {}); }
  const constructor = (promise.constructor = {});
  constructor[Symbol.species] = Other;
  return [promise.then(() => {}) instanceof Other, promise.catch(() => {}) instanceof Other, promise.finally(() => {}) instanceof Other].join();
});

function NotAnArray() { Array.apply(this, arguments); }
Object.setPrototypeOf(NotAnArray, Array);
NotAnArray.prototype = Object.create(Array.prototype, { constructor: { value: NotAnArray, enumerable: false, writable: true, configurable: true } });
attempt("a function that only calls Array makes no array", () => {
  const made = new NotAnArray();
  made[34] = "far";
  return [Array.isArray(made), made instanceof NotAnArray, made.length].join();
});

function SubArray() {
  const list = Array.apply(this, arguments);
  Object.setPrototypeOf(list, SubArray.prototype);
  return list;
}
Object.setPrototypeOf(SubArray, Array);
SubArray.prototype = Object.create(Array.prototype, { constructor: { value: SubArray, enumerable: false, writable: true, configurable: true } });
attempt("concat of a subclass written with functions", () => new SubArray().concat("more") instanceof SubArray);
attempt("filter", () => new SubArray().filter(() => true) instanceof SubArray);
attempt("map", () => new SubArray().map(value => value) instanceof SubArray);
attempt("slice", () => new SubArray().slice() instanceof SubArray);
attempt("splice", () => new SubArray().splice(0) instanceof SubArray);
attempt("what they hold", () => {
  const list = new SubArray(1, 2, 3);
  return [list.concat(4).join("+"), list.filter(n => n > 1).join("+"), list.map(n => n * 2).join("+"), list.slice(1).join("+"), list.splice(0, 2).join("+"), list.join("+")].join();
});
