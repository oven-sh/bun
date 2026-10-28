import { AsyncLocalStorage } from 'node:async_hooks'; const store = new AsyncLocalStorage();
globalThis.gate = new Promise((resolve, reject) => { globalThis.settle = resolve; globalThis.fail = reject; });
const say = load => { try { const m = load(); console.log('required', Object.keys(m).join()); } catch (error) { console.log('require throws', error.name, error.name === 'TypeError' ? '' : error.message); } console.log('behind require'); };
queueMicrotask(() => store.run('of the job', () => say(() => require('./r.mjs'))));
store.enterWith('of the entry'); await globalThis.gate; console.log('waiter resumes', store.getStore()); await Promise.resolve(); console.log('waiter second', store.getStore());
