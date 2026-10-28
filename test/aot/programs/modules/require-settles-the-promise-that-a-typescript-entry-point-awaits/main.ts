(globalThis as any).gate = new Promise((resolve, reject) => { (globalThis as any).settle = resolve; (globalThis as any).fail = reject; });
const say = (load: () => object) => { try { const m = load(); console.log('required', Object.keys(m).join()); } catch (error: any) { console.log('require throws', error.name, error.name === 'TypeError' ? '' : error.message); } console.log('behind require'); };
queueMicrotask(() => say(() => require('./r.ts')));
await (globalThis as any).gate; console.log('waiter resumes');
