// `{ a, ...(c ? { p } : undefined) }`: the way that brings undefined, null, a boolean, a number, a bigint or a symbol copies nothing, and nothing is called for it: the object is as if the spread were not written.
// STATISTIC: ObjectSpreadsRemovedAsEmpty >= 5
function withUndefined(a: number, p: number | undefined) { const o: any = { a, ...(p !== undefined ? { p } : undefined) }; return o; }
function withNull(a: number, p: number | null) { const o: any = { a, ...(p !== null ? { p } : null) }; return o; }
function withFalse(a: number, on: boolean) { const o: any = { a, ...(on ? { on } : false), z: a + 1 }; return o; }
function withTrue(a: number, on: boolean) { const o: any = { a, ...(on ? (true as any) : { off: a }), z: a + 1 }; return o; }
function withNumber(a: number, on: boolean) { const o: any = { ...(on ? { first: a } : (0.5 as any)), a }; return o; }
function withBigInt(a: number, on: boolean) { const o: any = { a, ...(on ? { big: a } : (12n as any)) }; return o; }
function withSymbol(a: number, on: boolean) { const o: any = { a, ...(on ? { named: a } : (Symbol.iterator as any)) }; return o; }
function nothingElse() { const o: any = { ...(undefined as any), ...(null as any) }; return o; }
function show(o: any) { return JSON.stringify(o) + " " + Object.keys(o).join(); }
for (let i = 0; i < 4; i++) {
  console.log(show(withUndefined(i, i & 1 ? i : undefined)), show(withNull(i, i & 1 ? i : null)), show(withFalse(i, !(i & 1))), show(withTrue(i, !(i & 1))));
  console.log(show(withNumber(i, !(i & 1))), show(withBigInt(i, !(i & 1))), show(withSymbol(i, !(i & 1))), show(nothingElse()));
}
