async function target(first, second) {
  await null;
  return second + 1;
}
console.log(await target.call(null, 1, 2.5));
