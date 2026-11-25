const N = 9;
let replaces = false;
class Steps { [Symbol.iterator]() { let i = 0; const made = { get left() { return N - i; }, next: () => (i < N ? { done: false, value: i++ } : { done: true, value: undefined as number | undefined }) }; if (replaces) made.next = () => (i < N ? { done: false, value: 100 + i++ } : { done: true, value: undefined }); return made; } }
const steps = new Steps();
(globalThis as any).published = new Steps();
function drain(): number { let sum = 0; for (const item of steps) sum += item as number; return sum; }
let said = 0; for (let t = 0; t < 50; t++) { replaces = t % 5 === 4; said = (said + drain()) | 0; }
console.log("SAID", said, process.argv.length);
