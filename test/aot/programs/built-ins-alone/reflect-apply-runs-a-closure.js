function adder(base) {
  return function (first, second) {
    return base + second;
  };
}
console.log(Reflect.apply(adder(0.5), null, [1, 2]));
