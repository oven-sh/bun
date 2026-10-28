globalThis.gate = new Promise((resolve, reject) => { globalThis.settle = resolve; globalThis.fail = reject; });
const say = load => { try { const m = load(); console.log('required', Object.keys(m).join()); } catch (error) { console.log('require throws', error.name, error.name === 'TypeError' ? '' : error.message); } console.log('behind require'); };
queueMicrotask(() => say(() => require('./r.mjs')));
try { await globalThis.gate; } catch (error) { console.log('waiter catches', error.message); }
console.log('waiter resumes');
