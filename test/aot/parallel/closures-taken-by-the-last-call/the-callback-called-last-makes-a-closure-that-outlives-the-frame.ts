function last<T>(f: () => T): T { return f(); }
function counter(start: number): () => number { let n = start; return last(() => () => ++n); }
function constant(k: number): () => number { return last(() => () => k); }
const c = counter(5), d = counter(10), e = constant(7);
console.log(c(), c(), d(), c(), d(), e());
