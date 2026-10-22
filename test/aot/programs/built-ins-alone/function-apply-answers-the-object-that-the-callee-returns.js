function target() {
  return { made: 1.5 };
}
const result = target.apply(undefined, []);
console.log(typeof result, result.made + 1);
