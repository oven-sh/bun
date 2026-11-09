const kept = new Set<(x: number) => number>();
function plain(x: number): number { return x; }
function pick(n: number, visit: (x: number) => number = plain): number { kept.add(visit); return visit(n); }
function work(k: number): number { return pick(k, x => x + k) + pick(k); }
console.log(work(1), work(2), kept.size, [...kept].map(f => f(10)).join());
