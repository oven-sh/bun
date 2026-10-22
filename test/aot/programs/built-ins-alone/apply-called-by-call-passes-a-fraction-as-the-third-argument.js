function target(first, second, third, fourth, fifth) {
  console.log(typeof third, third + 1);
}
Function.prototype.apply.call(target, undefined, [0, 1, 2.5, 3, 4]);
