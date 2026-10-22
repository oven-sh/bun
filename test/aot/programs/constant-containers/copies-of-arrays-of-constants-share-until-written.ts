function source(): number[] { return [1, 2, 3, 4]; }
function longSource(): number[] { return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]; }
function fractions(): number[] { return [0.5, 1.5, 2.5]; }
for (const make of [source, longSource, fractions]) {
  const a = make();
  const copies: [string, number[]][] = [["slice", a.slice()], ["slice 0", a.slice(0)], ["concat", a.concat()], ["concat empty", a.concat([])], ["empty concat", ([] as number[]).concat(a)], ["spread", [...a]], ["from", Array.from(a)], ["toSorted", a.toSorted()], ["toReversed", a.toReversed()], ["with", a.with(0, 1)], ["toSpliced", a.toSpliced(0, 0)], ["map", a.map(v => v)], ["clone", structuredClone(a)], ["of", Array.of(...a)], ["values", [...a.values()]]];
  for (const [how, copy] of copies) {
    const before = copy.join();
    copy[0] = -5; copy.push(100);
    console.log(make.name, how, before, copy.join(), a.join(), make().join(), copy !== a);
  }
  const b = make(), c = b.slice(); b[1] = 77; console.log(make.name, b.join(), c.join(), make().join());
  const d = make(), e = d.slice(), f = e.slice(); e.reverse(); console.log(make.name, d.join(), e.join(), f.join());
}
function take(a: number, b: number, c: number, d?: number): number { return a * 1000 + b * 100 + c * 10 + (d ?? 0); }
console.log(take(...(source() as [number, number, number, number])), take.apply(null, source() as [number, number, number, number]), Math.max(...longSource()), Reflect.apply(take, null, fractions()));
const [p, q, ...rest] = longSource(); rest[0] = -1; console.log(p, q, rest.join(), longSource().join());
console.log(new Set(source()).size, new Map(source().map(v => [v, v])).size, Buffer.from(source()).toString("hex"), new Uint8Array(longSource()).join(), String(source()), source().toString(), `${fractions()}`, source() + "", JSON.stringify({ a: source(), b: fractions() }));
console.log(source().toString(), source().toString(), longSource().join("-"), longSource().join("-"));
