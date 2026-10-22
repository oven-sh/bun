function adder(base) {
  return function (first, second) {
    return base + second;
  };
}
console.log(adder(0.5).apply(null, [1, 2]));
