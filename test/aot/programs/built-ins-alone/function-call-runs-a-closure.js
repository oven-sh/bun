function adder(base) {
  return function (first, second) {
    return base + second;
  };
}
console.log(adder(0.5).call(null, 1, 2));
