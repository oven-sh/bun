const N = 9;
let closed = 0;
class Steps { [Symbol.iterator]() { let i = 0; return { get left() { return N - i; }, next: () => { if (i === 7) throw new RangeError("seven"); return i < N ? { done: false, value: i++ } : { done: true, value: undefined }; }, return() { closed++; return { done: true, value: undefined }; } }; } }
const steps = new Steps();
(globalThis as any).published = new Steps();
function some(limit: number): number { let sum = 0; for (const item of steps) { if ((item as number) >= limit) break; sum += item as number; } return sum; }
const said: string[] = [];
for (const limit of [0, 3, 6, 8]) { try { said.push(String(some(limit))); } catch (thrown) { said.push((thrown as Error).message); } }
console.log("SAID", said.join(" "), closed, process.argv.length);
