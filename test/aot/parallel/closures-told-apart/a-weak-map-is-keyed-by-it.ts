const tags = new WeakMap<object, number>();
function tag(f: () => number, n: number): number { const had = tags.get(f) ?? -1; tags.set(f, n); return had + f(); }
const kept = () => 100;
const out: number[] = [];
for (let i = 0; i < 3; i++) out.push(tag(() => i, i), tag(kept, i));
console.log(out.join());
