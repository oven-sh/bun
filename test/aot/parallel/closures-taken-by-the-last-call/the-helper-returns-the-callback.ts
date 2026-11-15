function give(f: () => number): () => number { return f; }
function make(k: number): () => number { return give(() => k); }
const a = make(1), b = make(1), c = make(2);
console.log(a === a, a === b, new Set([a, b, c, a]).size, a(), b(), c());
