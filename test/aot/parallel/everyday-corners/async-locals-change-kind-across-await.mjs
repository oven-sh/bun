// Async locals change kind across await: compiled answers as plain.
async function f(x) {
  let v = x;
  v = await v;
  v = typeof v === "number" ? String(v) : Number(v);
  await null;
  return [v, typeof v].join();
}
console.log(await f(1), await f("2"), await f(Promise.resolve(3)));
