const kept = new Set<(x: number) => number>();
function keep(f: (x: number) => number): number { kept.add(f); return f(1); }
function forward(f: (x: number) => number): number { return keep(f); }
function twice(k: number): number { const f = (x: number) => x + k; return forward(f) + forward(f); }
console.log(twice(1), kept.size, twice(2), kept.size, forward(x => x), forward(x => x), kept.size);
