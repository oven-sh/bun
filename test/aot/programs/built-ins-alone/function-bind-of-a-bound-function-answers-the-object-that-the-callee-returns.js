function target() {
  return { made: 1.5 };
}
const result = target.bind(undefined).bind(null)();
console.log(typeof result, result.made + 1);
