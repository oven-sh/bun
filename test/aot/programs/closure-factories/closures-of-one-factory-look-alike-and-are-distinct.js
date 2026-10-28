// Closures that several calls of one factory return have the same name, length, text and prototype rules, and each is an object of its own.
const once = run =>
  function cached(first, second) {
    return run(first, second);
  };

const add = once((a, b) => a + b);
const join = once((a, b) => `${a}-${b}`);
const none = once(() => undefined);

console.log(add.name, join.name, none.name);
console.log(add.length, join.length, none.length);
console.log(add.toString() === join.toString(), add.toString().replace(/\s+/g, " "));
console.log(add === join, add === add, join !== none);
console.log(Object.getPrototypeOf(add) === Function.prototype, typeof add.prototype, add.prototype === join.prototype);
console.log(add.prototype.constructor === add, join.prototype.constructor === join);
console.log(Object.getOwnPropertyNames(add).sort().join(), Object.getOwnPropertyNames(join).sort().join());
console.log(add(1, 2), join(1, 2), none(1, 2));

add.label = "sum";
console.log(add.label, join.label, "label" in none);

const made = new add(3, 4);
console.log(made instanceof add, made instanceof join);

const seen = new Map([
  [add, "add"],
  [join, "join"],
]);
console.log(seen.get(add), seen.get(join), seen.get(none), new Set([add, join, none, add]).size);
