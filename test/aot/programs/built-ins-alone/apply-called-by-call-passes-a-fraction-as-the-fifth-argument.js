function target(first, second, third, fourth, fifth) {
  console.log(typeof fifth, fifth + 1);
}
Function.prototype.apply.call(target, undefined, [0, 1, 2, 3, 4.5]);
