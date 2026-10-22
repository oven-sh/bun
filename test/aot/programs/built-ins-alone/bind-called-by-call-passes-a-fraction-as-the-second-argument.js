function target(first, second, third, fourth, fifth) {
  console.log(typeof second, second + 1);
}
Function.prototype.bind.call(target, undefined, 0, 1.5, 2, 3, 4)();
