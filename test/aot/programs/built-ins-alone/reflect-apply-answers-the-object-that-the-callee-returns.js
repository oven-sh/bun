function target() {
  return { made: 1.5 };
}
const result = Reflect.apply(target, undefined, []);
console.log(typeof result, result.made + 1);
