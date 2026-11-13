function Made(n) {
  this.x = n;
  if (n > 2) return { x: 41 };
}
function* each(list) {
  for (const n of list) {
    const one = new Made(n);
    yield one.x;
  }
}
async function later(n) {
  const one = new Made(n);
  await null;
  return one.x;
}
for (const x of each([1, 2, 3, 4])) console.log(x);
for (const n of [1, 2, 3, 4]) console.log(await later(n));
