function target(first, second, third, fourth, fifth) {
  console.log(typeof fourth, fourth + 1);
}
Reflect.apply(Function.prototype.call, target, [undefined, 0, 1, 2, 3.5, 4]);
