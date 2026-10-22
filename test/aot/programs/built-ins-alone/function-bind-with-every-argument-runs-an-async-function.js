async function target(first, second) {
  await null;
  return second + 1;
}
console.log(await target.bind(null, 1, 2.5)());
