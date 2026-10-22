function* target(first, second) {
  yield first + 1;
  yield second.length;
}
console.log([...target.call(null, 1.5, "two")].join());
