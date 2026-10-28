globalThis.gate = new Promise((resolve, reject) => { globalThis.settle = resolve; globalThis.fail = reject; });
const say = load => { try { const m = load(); console.log('required', Object.keys(m).join()); } catch (error) { console.log('require throws', error.name, error.name === 'TypeError' ? '' : error.message); } console.log('behind require'); };
setTimeout(() => say(() => require('./r.mjs')), 1);
globalThis.gate.then(() => console.log('then before')); const p = globalThis.gate; queueMicrotask(() => p.then(() => console.log('then after'))); await p;
console.log('waiter resumes');
