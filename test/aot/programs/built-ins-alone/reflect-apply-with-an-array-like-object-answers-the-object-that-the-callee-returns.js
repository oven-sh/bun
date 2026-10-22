function target() {
  return { made: 1.5 };
}
const result = Reflect.apply(target, undefined, { length: 0 });
console.log(typeof result, result.made + 1);
