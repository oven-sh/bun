// Each table is read under a key that comes from a captured variable that is read before its store: the first read uses the key undefined, the second one "a".
// What the table holds under "undefined" differs from what it holds under "a" in a way its use can tell. Each line prints both uses and what they left behind.
// await
const T0 = { a: Promise.resolve(1), undefined: { then(r) { r('late'); } } };
async function outer0() { const probe = async () => { const v = T0[k]; return await v; }; const first = await probe(); var k = 'a'; return [first, await probe()]; }
const [first0, second0] = await outer0();
console.log('await', String(first0), typeof first0, String(second0), String(0));
// await-primitive
const T1 = { a: Promise.resolve(1), undefined: 'late' };
async function outer1() { const probe = async () => { const v = T1[k]; return await v; }; const first = await probe(); var k = 'a'; return [first, await probe()]; }
const [first1, second1] = await outer1();
console.log('await-primitive', String(first1), typeof first1, String(second1), String(0));
// await-rejected
const T2 = { a: Promise.resolve(1), undefined: Promise.reject('late') };
async function outer2() { const probe = async () => { const v = T2[k]; try { return await v; } catch (e) { return 'caught ' + e; } }; const first = await probe(); var k = 'a'; return [first, await probe()]; }
const [first2, second2] = await outer2();
console.log('await-rejected', String(first2), typeof first2, String(second2), String(0));
// then
const T3 = { a: Promise.resolve(1), undefined: { then(r) { r('late'); } } };
async function outer3() { const probe = async () => { const v = T3[k]; return Promise.resolve(v).then(x => x + 1); }; const first = await probe(); var k = 'a'; return [first, await probe()]; }
const [first3, second3] = await outer3();
console.log('then', String(first3), typeof first3, String(second3), String(0));
// then-callback
const T4 = { a: x => x, undefined: x => 'late' };
async function outer4() { const probe = async () => { const v = T4[k]; return Promise.resolve(1).then(v); }; const first = await probe(); var k = 'a'; return [first, await probe()]; }
const [first4, second4] = await outer4();
console.log('then-callback', String(first4), typeof first4, String(second4), String(0));
// async-return
const T5 = { a: 1, undefined: { then(r) { r('late'); } } };
async function outer5() { const probe = async () => { const v = T5[k]; return v; }; const first = await probe(); var k = 'a'; return [first, await probe()]; }
const [first5, second5] = await outer5();
console.log('async-return', String(first5), typeof first5, String(second5), String(0));
// promise-all
const T6 = { a: [Promise.resolve(1)], undefined: [{ then(r) { r('late'); } }] };
async function outer6() { const probe = async () => { const v = T6[k]; return (await Promise.all(v))[0]; }; const first = await probe(); var k = 'a'; return [first, await probe()]; }
const [first6, second6] = await outer6();
console.log('promise-all', String(first6), typeof first6, String(second6), String(0));
// for-await
const T7 = { a: [1], undefined: { async *[Symbol.asyncIterator]() { yield 'late'; } } };
async function outer7() { const probe = async () => { const v = T7[k]; let r = ''; for await (const x of v) r += x; return r; }; const first = await probe(); var k = 'a'; return [first, await probe()]; }
const [first7, second7] = await outer7();
console.log('for-await', String(first7), typeof first7, String(second7), String(0));
// for-await-sync
const T8 = { a: [1], undefined: [Promise.resolve('late')] };
async function outer8() { const probe = async () => { const v = T8[k]; let r = ''; for await (const x of v) r += x; return r; }; const first = await probe(); var k = 'a'; return [first, await probe()]; }
const [first8, second8] = await outer8();
console.log('for-await-sync', String(first8), typeof first8, String(second8), String(0));
// async-callee
const T9 = { a: async () => 1, undefined: async () => 'late' };
async function outer9() { const probe = async () => { const v = T9[k]; return await v(); }; const first = await probe(); var k = 'a'; return [first, await probe()]; }
const [first9, second9] = await outer9();
console.log('async-callee', String(first9), typeof first9, String(second9), String(0));
// microtask
let side10 = 0;
const T10 = { a: () => {}, undefined: () => { side10 = 'late'; } };
async function outer10() { const probe = async () => { const v = T10[k]; queueMicrotask(v); await null; return side10; }; const first = await probe(); var k = 'a'; return [first, await probe()]; }
const [first10, second10] = await outer10();
console.log('microtask', String(first10), typeof first10, String(second10), String(0));
