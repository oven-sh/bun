async function target(first, second) {
  await null;
  return second + 1;
}
console.log(await target.apply(null, [1, 2.5]));
