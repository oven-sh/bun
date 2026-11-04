function outer(n) {
  const a = gen, b = gen, c = later;
  return [a === b, [...a(n)].join(""), Object.getPrototypeOf(a(1)) === gen.prototype, c === later, plain === plain, plain() === globalThis].join(",");
  function* gen(k) { for (let i = 0; i < k; i++) yield i; }
  async function later() { return n; }
  function plain() { return this; }
}
console.log(outer(3));
