function* target(first, second) {
  yield first + 1;
  yield second.length;
}
console.log([...target.apply(null, [1.5, "two"])].join());
