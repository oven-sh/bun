function* target(first, second) {
  yield first + 1;
  yield second.length;
}
console.log([...Reflect.apply(target, null, [1.5, "two"])].join());
