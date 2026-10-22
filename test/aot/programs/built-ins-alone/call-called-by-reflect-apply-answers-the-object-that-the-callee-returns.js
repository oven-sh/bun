function target() {
  return { made: 1.5 };
}
const result = Reflect.apply(Function.prototype.call, target, [undefined]);
console.log(typeof result, result.made + 1);
