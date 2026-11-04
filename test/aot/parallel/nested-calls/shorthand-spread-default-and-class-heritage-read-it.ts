function outer() {
  const o = { f, g: f, ...{ h: f } };
  const [x = f] = [] as Array<typeof f>;
  const take = (y = f) => y;
  class K extends (Base as unknown as new () => object) {}
  return [o.f === f, o.g === o.h, x === f, take() === f, Object.getPrototypeOf(K) === Base, new K() instanceof Base].join(",");
  function f() {}
  function Base(this: unknown) {}
}
console.log(outer());
