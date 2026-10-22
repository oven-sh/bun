function adder(base) {
  return function (first, second) {
    return base + second;
  };
}
console.log(adder(0.5).bind(null, 1, 2)());
