// Each table is read under a key that comes from a field that is read before the constructor stores it: the first read uses the key undefined, the second one "a".
// What the table holds under "undefined" differs from what it holds under "a" in a way its use can tell. Each line prints both uses and what they left behind.
// await
const T0 = { a: Promise.resolve(1), undefined: { then(r) { r('late'); } } };
let sink0;
async function probe0() { const v = T0[sink0.k]; return await v; }
class K0 { constructor() { sink0 = this; this.r = probe0(); this.k = 'a'; } }
const first0 = await new K0().r;
console.log('await', String(first0), typeof first0, String(await probe0()), String(0));
// await-primitive
const T1 = { a: Promise.resolve(1), undefined: 'late' };
let sink1;
async function probe1() { const v = T1[sink1.k]; return await v; }
class K1 { constructor() { sink1 = this; this.r = probe1(); this.k = 'a'; } }
const first1 = await new K1().r;
console.log('await-primitive', String(first1), typeof first1, String(await probe1()), String(0));
// await-rejected
const T2 = { a: Promise.resolve(1), undefined: Promise.reject('late') };
let sink2;
async function probe2() { const v = T2[sink2.k]; try { return await v; } catch (e) { return 'caught ' + e; } }
class K2 { constructor() { sink2 = this; this.r = probe2(); this.k = 'a'; } }
const first2 = await new K2().r;
console.log('await-rejected', String(first2), typeof first2, String(await probe2()), String(0));
// then
const T3 = { a: Promise.resolve(1), undefined: { then(r) { r('late'); } } };
let sink3;
async function probe3() { const v = T3[sink3.k]; return Promise.resolve(v).then(x => x + 1); }
class K3 { constructor() { sink3 = this; this.r = probe3(); this.k = 'a'; } }
const first3 = await new K3().r;
console.log('then', String(first3), typeof first3, String(await probe3()), String(0));
// then-callback
const T4 = { a: x => x, undefined: x => 'late' };
let sink4;
async function probe4() { const v = T4[sink4.k]; return Promise.resolve(1).then(v); }
class K4 { constructor() { sink4 = this; this.r = probe4(); this.k = 'a'; } }
const first4 = await new K4().r;
console.log('then-callback', String(first4), typeof first4, String(await probe4()), String(0));
// async-return
const T5 = { a: 1, undefined: { then(r) { r('late'); } } };
let sink5;
async function probe5() { const v = T5[sink5.k]; return v; }
class K5 { constructor() { sink5 = this; this.r = probe5(); this.k = 'a'; } }
const first5 = await new K5().r;
console.log('async-return', String(first5), typeof first5, String(await probe5()), String(0));
// promise-all
const T6 = { a: [Promise.resolve(1)], undefined: [{ then(r) { r('late'); } }] };
let sink6;
async function probe6() { const v = T6[sink6.k]; return (await Promise.all(v))[0]; }
class K6 { constructor() { sink6 = this; this.r = probe6(); this.k = 'a'; } }
const first6 = await new K6().r;
console.log('promise-all', String(first6), typeof first6, String(await probe6()), String(0));
// for-await
const T7 = { a: [1], undefined: { async *[Symbol.asyncIterator]() { yield 'late'; } } };
let sink7;
async function probe7() { const v = T7[sink7.k]; let r = ''; for await (const x of v) r += x; return r; }
class K7 { constructor() { sink7 = this; this.r = probe7(); this.k = 'a'; } }
const first7 = await new K7().r;
console.log('for-await', String(first7), typeof first7, String(await probe7()), String(0));
// for-await-sync
const T8 = { a: [1], undefined: [Promise.resolve('late')] };
let sink8;
async function probe8() { const v = T8[sink8.k]; let r = ''; for await (const x of v) r += x; return r; }
class K8 { constructor() { sink8 = this; this.r = probe8(); this.k = 'a'; } }
const first8 = await new K8().r;
console.log('for-await-sync', String(first8), typeof first8, String(await probe8()), String(0));
// async-callee
const T9 = { a: async () => 1, undefined: async () => 'late' };
let sink9;
async function probe9() { const v = T9[sink9.k]; return await v(); }
class K9 { constructor() { sink9 = this; this.r = probe9(); this.k = 'a'; } }
const first9 = await new K9().r;
console.log('async-callee', String(first9), typeof first9, String(await probe9()), String(0));
// microtask
let side10 = 0;
const T10 = { a: () => {}, undefined: () => { side10 = 'late'; } };
let sink10;
async function probe10() { const v = T10[sink10.k]; queueMicrotask(v); await null; return side10; }
class K10 { constructor() { sink10 = this; this.r = probe10(); this.k = 'a'; } }
const first10 = await new K10().r;
console.log('microtask', String(first10), typeof first10, String(await probe10()), String(0));
