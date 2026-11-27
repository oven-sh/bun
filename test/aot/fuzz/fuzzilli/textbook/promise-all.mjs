async function doubled(n) {
  await null;
  return n * 2;
}
async function all(values) {
  const answers = await Promise.all(values.map(doubled));
  return answers.join();
}
console.log(await all([1, 2, 3]));
