globalThis.gate = new Promise((resolve, reject) => { globalThis.settle = resolve; globalThis.fail = reject; });
const say = load => { try { const m = load(); console.log('required', Object.keys(m).join()); } catch (error) { console.log('require throws', error.name, error.name === 'TypeError' ? '' : error.message); } console.log('behind require'); };
process.on('uncaughtException', e => console.log('uncaught', e.message)); process.on('unhandledRejection', e => console.log('unhandled', e.message));
queueMicrotask(() => say(() => require('./r.mjs')));
await globalThis.gate; console.log('waiter resumes'); throw new Error('from waiter');
