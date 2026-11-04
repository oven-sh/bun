type Pair = { get?: () => number; add?: (by: number) => number };
const kept: Pair[] = [];
function both(k: number): Pair { let n = k; const o: Pair = { get: () => n, add: by => (n += by) }; kept.push(o); return o; }
function neither(): Pair { const o: Pair = {}; kept.push(o); return o; }
const a = both(1), b = neither();
console.log(a.add!(2), a.get!(), typeof b.get, typeof b.add, Object.keys(a).join(), Object.keys(b).length);
