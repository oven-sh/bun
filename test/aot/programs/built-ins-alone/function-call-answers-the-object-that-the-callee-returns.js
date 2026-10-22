function target() {
  return { made: 1.5 };
}
const result = target.call(undefined);
console.log(typeof result, result.made + 1);
