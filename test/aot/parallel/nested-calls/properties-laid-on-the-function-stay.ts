function outer() {
  (counter as unknown as { hits: number }).hits = 0;
  bump(); bump();
  const viaArrow = () => (counter as unknown as { hits: number }).hits;
  return viaArrow() + ":" + counter.name + ":" + counter.length + ":" + typeof counter + ":" + (counter.prototype === counter.prototype) + ":" + (new (counter as unknown as new () => object)() instanceof counter);
  function counter(this: unknown, _a?: number) {}
  function bump() { (counter as unknown as { hits: number }).hits++; }
}
console.log(outer());
