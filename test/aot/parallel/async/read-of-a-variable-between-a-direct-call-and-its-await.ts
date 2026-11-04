// Between a direct call of an async function and the await of its promise a variable is read that the callee has written before its first await.
let count = 0;
async function load(x: number) {
  count = x;
  await null;
  count = -x;
  return x;
}
async function run(x: number) {
  const promise = load(x);
  const seen = count;
  const given = await promise;
  return seen + "," + given + "," + count;
}
function deed(x: number) {
  return run(x);
}
console.log(await deed(5));
console.log(await deed(6));
for (let i = 1; i < 4; i++) console.log(await deed(i * 10));
