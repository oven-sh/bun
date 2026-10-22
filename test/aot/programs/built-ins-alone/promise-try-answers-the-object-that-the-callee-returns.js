function target() {
  return { made: 1.5 };
}
const result = await Promise.try(target);
console.log(typeof result, result.made + 1);
