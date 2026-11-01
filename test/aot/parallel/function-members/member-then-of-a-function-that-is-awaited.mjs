// await, Promise.resolve() and an async function each look for `then`.
function K() {}
K.n = 1;
function bump() {
  return ++K.n;
}
bump();
K.then = resolve => resolve("then");
console.log(await K, await Promise.resolve(K), await (async () => K)(), bump());
