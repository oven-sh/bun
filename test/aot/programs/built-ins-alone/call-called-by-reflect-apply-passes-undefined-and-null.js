function target(first, second, third, fourth, fifth) {
  console.log(first === undefined, typeof first);
  console.log(second === null, typeof second);
  console.log(third + 1, arguments.length);
}
Reflect.apply(Function.prototype.call, target, [undefined, undefined, null, 0.5]);
