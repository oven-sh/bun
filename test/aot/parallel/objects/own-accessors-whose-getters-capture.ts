function counter(start: number, step: number) {
    let current = start;
    return { get next() { current += step; return current; }, get start() { return start; } };
}
const byOne = counter(0, 1), byTen = counter(100, 10);
function drain(source: { readonly next: number; readonly start: number }) { return source.next + source.next + source.start; }
const rounds = Number(process.argv[2] ?? 1000) | 0;
let sum = 0;
for (let r = 0; r < rounds; r++) sum += drain(byOne) + drain(byTen);
console.log(sum);
