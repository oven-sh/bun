globalThis.gate = new Promise((resolve, reject) => { globalThis.settle = resolve; globalThis.fail = reject; });
const say = load => { try { const m = load(); console.log('required', Object.keys(m).join()); } catch (error) { console.log('require throws', error.name, error.name === 'TypeError' ? '' : error.message); } console.log('behind require'); };
globalThis.ready = () => setTimeout(() => say(() => require('./r.mjs')), 1);
import('./w.mjs').then(() => console.log('import settled'));
