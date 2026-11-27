const N = 9;
class Steps { [Symbol.iterator]() { let i = 0; return { get left() { return N - i; }, next: () => ({ done: true, value: undefined }), ["next"]: () => (i < N ? { done: false, value: i++ } : { done: true, value: undefined }) }; } }
const steps = new Steps();
globalThis.published = new Steps();
function drain() { let sum = 0; for (const item of steps) sum += item; return sum; }
let said = 0; for (let t = 0; t < 50; t++) said = (said + drain()) | 0;
console.log("SAID", said, process.argv.length);
