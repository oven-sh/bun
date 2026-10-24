// Each table is read under a key that comes from a static field that is read before it is defined: the first read uses the key undefined, the second one "a".
// What the table holds under "undefined" differs from what it holds under "a" in a way its use can tell. Each line prints both uses and what they left behind.
// await
const T0 = { a: Promise.resolve(1), undefined: { then(r) { r('late'); } } };
async function probe0(c) { const v = T0[c.k]; return await v; }
class S0 { static r = probe0(this); static k = 'a'; }
const first0 = await S0.r;
console.log('await', String(first0), typeof first0, String(await probe0(S0)), String(0));
// await-primitive
const T1 = { a: Promise.resolve(1), undefined: 'late' };
async function probe1(c) { const v = T1[c.k]; return await v; }
class S1 { static r = probe1(this); static k = 'a'; }
const first1 = await S1.r;
console.log('await-primitive', String(first1), typeof first1, String(await probe1(S1)), String(0));
// await-rejected
const T2 = { a: Promise.resolve(1), undefined: Promise.reject('late') };
async function probe2(c) { const v = T2[c.k]; try { return await v; } catch (e) { return 'caught ' + e; } }
class S2 { static r = probe2(this); static k = 'a'; }
const first2 = await S2.r;
console.log('await-rejected', String(first2), typeof first2, String(await probe2(S2)), String(0));
// then
const T3 = { a: Promise.resolve(1), undefined: { then(r) { r('late'); } } };
async function probe3(c) { const v = T3[c.k]; return Promise.resolve(v).then(x => x + 1); }
class S3 { static r = probe3(this); static k = 'a'; }
const first3 = await S3.r;
console.log('then', String(first3), typeof first3, String(await probe3(S3)), String(0));
// then-callback
const T4 = { a: x => x, undefined: x => 'late' };
async function probe4(c) { const v = T4[c.k]; return Promise.resolve(1).then(v); }
class S4 { static r = probe4(this); static k = 'a'; }
const first4 = await S4.r;
console.log('then-callback', String(first4), typeof first4, String(await probe4(S4)), String(0));
// async-return
const T5 = { a: 1, undefined: { then(r) { r('late'); } } };
async function probe5(c) { const v = T5[c.k]; return v; }
class S5 { static r = probe5(this); static k = 'a'; }
const first5 = await S5.r;
console.log('async-return', String(first5), typeof first5, String(await probe5(S5)), String(0));
// promise-all
const T6 = { a: [Promise.resolve(1)], undefined: [{ then(r) { r('late'); } }] };
async function probe6(c) { const v = T6[c.k]; return (await Promise.all(v))[0]; }
class S6 { static r = probe6(this); static k = 'a'; }
const first6 = await S6.r;
console.log('promise-all', String(first6), typeof first6, String(await probe6(S6)), String(0));
// for-await
const T7 = { a: [1], undefined: { async *[Symbol.asyncIterator]() { yield 'late'; } } };
async function probe7(c) { const v = T7[c.k]; let r = ''; for await (const x of v) r += x; return r; }
class S7 { static r = probe7(this); static k = 'a'; }
const first7 = await S7.r;
console.log('for-await', String(first7), typeof first7, String(await probe7(S7)), String(0));
// for-await-sync
const T8 = { a: [1], undefined: [Promise.resolve('late')] };
async function probe8(c) { const v = T8[c.k]; let r = ''; for await (const x of v) r += x; return r; }
class S8 { static r = probe8(this); static k = 'a'; }
const first8 = await S8.r;
console.log('for-await-sync', String(first8), typeof first8, String(await probe8(S8)), String(0));
// async-callee
const T9 = { a: async () => 1, undefined: async () => 'late' };
async function probe9(c) { const v = T9[c.k]; return await v(); }
class S9 { static r = probe9(this); static k = 'a'; }
const first9 = await S9.r;
console.log('async-callee', String(first9), typeof first9, String(await probe9(S9)), String(0));
// microtask
let side10 = 0;
const T10 = { a: () => {}, undefined: () => { side10 = 'late'; } };
async function probe10(c) { const v = T10[c.k]; queueMicrotask(v); await null; return side10; }
class S10 { static r = probe10(this); static k = 'a'; }
const first10 = await S10.r;
console.log('microtask', String(first10), typeof first10, String(await probe10(S10)), String(0));
