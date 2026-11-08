function tell() { return this.v; }
function make(i) {
  const self = { v: i }, target = { v: i + 1 }, handler = { get(t, k) { return k === "v" ? t.v * 10 : undefined; } }, args = [i + 2];
  return [tell.bind(self), new Proxy(target, handler), Reflect.apply(x => ({ x }), null, args), Object.create(self), Object.freeze({ v: i + 3 })];
}
const [bound, proxy, applied, child, frozen] = make(1);
console.log(bound(), proxy.v, applied.x, child.v, frozen.v);
