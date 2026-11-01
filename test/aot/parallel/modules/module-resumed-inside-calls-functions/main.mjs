// A module resumed inside require awaits calls of async functions.
globalThis.gate = new Promise((resolve, reject) => { globalThis.settle = resolve; globalThis.fail = reject; });
const say = load => { try { const m = load(); console.log('required', Object.keys(m).join()); } catch (error) { console.log('require throws', error.name, error.name === 'TypeError' ? '' : error.message); } console.log('behind require'); };
const now = async v => v; const later = async v => { await 0; return v; }; const fails = async () => { throw new Error('no'); }; const chain = async v => await now(v); const returnsPromise = async v => Promise.resolve(v);
queueMicrotask(() => say(() => require('./r.mjs')));
await globalThis.gate; console.log('now', await now(1)); try { await fails(); } catch (e) { console.log('caught', e.message); } console.log('chain', await chain(2)); console.log('later', await later(3));
