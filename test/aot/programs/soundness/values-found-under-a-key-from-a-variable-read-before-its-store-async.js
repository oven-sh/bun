// Each table is read under a key that comes from a variable that is read before its store: the first read uses the key undefined, the second one "a".
// What the table holds under "undefined" differs from what it holds under "a" in a way its use can tell. Each line prints both uses and what they left behind.
// await
const T0 = { a: Promise.resolve(1), undefined: { then(r) { r('late'); } } };
async function probe0() { const v = T0[k0]; return await v; }
const first0 = await probe0();
var k0 = 'a';
console.log('await', String(first0), typeof first0, String(await probe0()), String(0));
// await-primitive
const T1 = { a: Promise.resolve(1), undefined: 'late' };
async function probe1() { const v = T1[k1]; return await v; }
const first1 = await probe1();
var k1 = 'a';
console.log('await-primitive', String(first1), typeof first1, String(await probe1()), String(0));
// await-rejected
const T2 = { a: Promise.resolve(1), undefined: Promise.reject('late') };
async function probe2() { const v = T2[k2]; try { return await v; } catch (e) { return 'caught ' + e; } }
const first2 = await probe2();
var k2 = 'a';
console.log('await-rejected', String(first2), typeof first2, String(await probe2()), String(0));
// then
const T3 = { a: Promise.resolve(1), undefined: { then(r) { r('late'); } } };
async function probe3() { const v = T3[k3]; return Promise.resolve(v).then(x => x + 1); }
const first3 = await probe3();
var k3 = 'a';
console.log('then', String(first3), typeof first3, String(await probe3()), String(0));
// then-callback
const T4 = { a: x => x, undefined: x => 'late' };
async function probe4() { const v = T4[k4]; return Promise.resolve(1).then(v); }
const first4 = await probe4();
var k4 = 'a';
console.log('then-callback', String(first4), typeof first4, String(await probe4()), String(0));
// async-return
const T5 = { a: 1, undefined: { then(r) { r('late'); } } };
async function probe5() { const v = T5[k5]; return v; }
const first5 = await probe5();
var k5 = 'a';
console.log('async-return', String(first5), typeof first5, String(await probe5()), String(0));
// promise-all
const T6 = { a: [Promise.resolve(1)], undefined: [{ then(r) { r('late'); } }] };
async function probe6() { const v = T6[k6]; return (await Promise.all(v))[0]; }
const first6 = await probe6();
var k6 = 'a';
console.log('promise-all', String(first6), typeof first6, String(await probe6()), String(0));
// for-await
const T7 = { a: [1], undefined: { async *[Symbol.asyncIterator]() { yield 'late'; } } };
async function probe7() { const v = T7[k7]; let r = ''; for await (const x of v) r += x; return r; }
const first7 = await probe7();
var k7 = 'a';
console.log('for-await', String(first7), typeof first7, String(await probe7()), String(0));
// for-await-sync
const T8 = { a: [1], undefined: [Promise.resolve('late')] };
async function probe8() { const v = T8[k8]; let r = ''; for await (const x of v) r += x; return r; }
const first8 = await probe8();
var k8 = 'a';
console.log('for-await-sync', String(first8), typeof first8, String(await probe8()), String(0));
// async-callee
const T9 = { a: async () => 1, undefined: async () => 'late' };
async function probe9() { const v = T9[k9]; return await v(); }
const first9 = await probe9();
var k9 = 'a';
console.log('async-callee', String(first9), typeof first9, String(await probe9()), String(0));
// microtask
let side10 = 0;
const T10 = { a: () => {}, undefined: () => { side10 = 'late'; } };
async function probe10() { const v = T10[k10]; queueMicrotask(v); await null; return side10; }
const first10 = await probe10();
var k10 = 'a';
console.log('microtask', String(first10), typeof first10, String(await probe10()), String(0));
