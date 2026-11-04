function outer(seed: number): () => string { const a = seed + 1, b = seed + 2, c = "c" + seed; let n = 0; const bump = () => { n++; return a + ":" + b + ":" + c + ":" + n; }; bump(); return bump; }
const first = outer(1), second = outer(10);
console.log(first(), second(), first());
