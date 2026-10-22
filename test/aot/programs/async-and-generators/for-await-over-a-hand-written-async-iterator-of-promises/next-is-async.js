async function fetchLike(n) { return n * 2; }
async function collectAsync(it) { const list = []; for await (const v of it) { list.push(v); } return list.length + ":" + list.map(x => typeof x + (x instanceof Promise)).join(); }
const o = { [Symbol.asyncIterator]() { let i = 0; return { async next() { return i++ < 2 ? { done: false, value: Promise.resolve(7) } : { done: true, value: undefined }; } }; } };
console.log(await collectAsync(o));
