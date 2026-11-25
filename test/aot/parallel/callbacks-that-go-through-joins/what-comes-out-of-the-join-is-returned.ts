function plain(): number { return 0; }
function choose(f?: () => number): () => number { const chosen = f ?? plain; chosen(); return chosen; }
function work(k: number): number { const got = choose(() => k); return got() + choose()(); }
const a = choose(), b = choose();
console.log(work(4), work(5), a === b, a === plain);
