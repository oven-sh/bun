async function target(first, second) {
  await null;
  return second + 1;
}
console.log(await Reflect.apply(target, null, [1, 2.5]));
