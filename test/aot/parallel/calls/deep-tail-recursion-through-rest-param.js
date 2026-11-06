// Functions with a rest parameter, or that use `arguments`, call each other in tail position a million times, through values and by name. They only read the rest array, so it need not be on the heap,
// and wherever else it lies, no frame may stay behind for it: the stack would run out. The output is that of plain Bun.
const table = {
  even(n, ...rest) {
    return n === 0 ? "even " + rest.length + rest[0] : table.odd(n - 1, ...rest);
  },
  odd(n, ...rest) {
    return n === 0 ? "odd " + rest.length + rest[1] : table.even(n - 1, rest[0], rest[1]);
  },
};
const names = ["even", "odd"];

function throughValue(n, ...rest) {
  if (n === 0) return "value " + rest.length + rest[0];
  const next = table[names[2]] ?? throughValue;
  return next(n - 1, rest[0], n);
}

function byName(n, ...rest) {
  return n === 0 ? "name " + rest.length + rest[0] : byName(n - 1, rest[0], rest.length);
}

function surplus(n) {
  return n === 0 ? "surplus " + arguments.length + arguments[1] : surplus(n - 1, arguments[1], n);
}

function applies(n, ...rest) {
  return n === 0 ? "apply " + rest.length + rest[0] : applies.apply(undefined, [n - 1, rest[0]]);
}

function literal(list, n) {
  return n === 0 ? "literal " + list.length + list[0] : literal([list[0], n], n - 1);
}

console.log(table[names[0]](1000000, "a", "b"));
console.log(table[names[1]](1000001, "a", "b"));
console.log(throughValue(1000000, "v"));
console.log(byName(1000000, "n"));
console.log(surplus(1000000, "s"));
console.log(applies(1000000, "p"));
console.log(literal(["l"], 1000000));
