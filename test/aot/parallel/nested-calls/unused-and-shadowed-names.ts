function outer() {
  const unused = () => { throw new Error("never"); };
  const f = () => "outer";
  const a = f();
  { const f = () => "inner"; var b = f(); }
  const viaParameter = (f: () => string) => f();
  return [a, b, viaParameter(() => "parameter"), f()].join(",");
}
console.log(outer());
