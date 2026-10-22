function target() {
  return { made: 1.5 };
}
const result = Function.prototype.bind.call(target, undefined)();
console.log(typeof result, result.made + 1);
