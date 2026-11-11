async function* arriving(values) {
  for (const value of values) {
    await null;
    yield value;
  }
}
async function gathered(source) {
  const out = [];
  for await (const one of source) out.push(one * 10);
  return out;
}
console.log((await gathered(arriving([1, 2, 3]))).join());
