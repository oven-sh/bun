globalThis.gate = new Promise((resolve, reject) => { globalThis.settle = resolve; globalThis.fail = reject; });
const say = load => { try { const m = load(); console.log('required', Object.keys(m).join()); } catch (error) { console.log('require throws', error.name, error.name === 'TypeError' ? '' : error.message); } console.log('behind require'); };
globalThis.gate2 = new Promise(r => { globalThis.settle2 = r; });
queueMicrotask(() => say(() => require('./r.mjs')));
await globalThis.gate; console.log('waiter first'); await globalThis.gate2; console.log('waiter second');
