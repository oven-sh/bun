interface Base { kind: number }
function make(kind: number): Base { return { kind, set symbol(v: unknown) { console.log("set", v); } } as Base; }
const held = make(4), spare = make(5);
function parse(text: string): Base[] { return JSON.parse(text) as Base[]; }
const parsed = parse('[{"kind":3,"symbol":5},{"kind":2,"symbol":{"a":1}},{"kind":1}]');
for (const one of [...parsed, held, spare]) {
  const d = Object.getOwnPropertyDescriptor(one, "symbol");
  console.log(one.kind, typeof (one as any).symbol, d && typeof d.set, d && JSON.stringify(d.value), JSON.stringify(one), Object.keys(one).join());
  (one as any).symbol = 7;
  console.log(typeof (one as any).symbol);
}
