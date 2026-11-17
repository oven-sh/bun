const N = 9;
class Steps { [Symbol.iterator]() { let i = 0; return { get left() { return N - i; }, next: () => (i < N ? { done: false, value: i++ } : { done: true, value: undefined }) }; } }
const steps = new Steps();
(globalThis as any).published = new Steps();
function drain(): number { let sum = 0; for (const item of steps) sum += item as number; return sum; }
function take(): number { let sum = 0; for (let t = 0; t < 4; t++) { const [a, b, c] = steps as Iterable<number>; sum += a + b * 10 + c * 100; } return sum; }
let said = 0; for (let t = 0; t < 50; t++) said = (said + drain() + take()) | 0;
console.log("SAID", said, steps[Symbol.iterator]().left, process.argv.length);
