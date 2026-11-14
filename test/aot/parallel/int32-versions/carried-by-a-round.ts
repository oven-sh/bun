// Generators that are walked where they are stepped, with a try in a loop over numbers: what the round carries is named anew where the ways of the try meet, and a version for int32 storage is entered with the names of in front.
// STATISTIC: LoopsUnswitched >= 1
// @ts-nocheck
let closed = 0;
function msg(e: any): any { return e === null ? 'null' : e && typeof e === 'object' ? e.name + ':' + String(e.message).slice(0, 20) : String(e); }
function show(v: any): any { return v && typeof v === 'object' ? JSON.stringify(v) : Object.is(v, -0) ? '-0' : String(v); }
function fail(i: any): any { throw new RangeError('f' + i); }
function boom(p: any, i: any): any { if (p) throw new TypeError('b' + i); return 1; }
function two(p: any, i: any): any { try { if (p) fail(i); return 1; } finally { closed++; } }
function need(x: any): any { if (typeof x !== 'number') throw new Error('n'); return x; }
function f2(...a: any): any { return a.length; }
async function later(x: any) { await 0; return x; }
const nothing: any = undefined, bad: any = { get get() { throw new Error('get'); } }, badText: any = { toString() { throw new Error('text'); } }, badValue: any = { valueOf() { throw new Error('value'); } }, pxy: any = new Proxy({}, { get() { throw new Error('px'); } });
const badIter: any = { [Symbol.iterator]() { return { next() { throw new Error('next'); }, return() { closed += 10; return {}; } }; } };
const closing: any = { [Symbol.iterator]() { return { next() { return { value: 1, done: false }; }, return() { closed += 100; return {}; } }; } };
function* h(l: number[], n: number, tail: number[]): any { let s: number = 0.5, c = 0, t = '', k = 0, last: any = 0, outer = 0; const arr: any = [], b: any = [0, 0, 0, 0], o: any = { n: 0, v: 0 }, m: any = new Map(), log: any = []; for (let i = 0; i < l.length; i++) { const x = l[i]; last = x; try { if (i > 10) (nothing as any).x = i; o.v = x; if (x > 2) c += 2; } catch (e: any) { k = -i;    } s += tail[i & 7]; } return ['end', s, c, t.length, k, show(last), outer, arr.length, b.join('/'), o.n, m.size, log.slice(0, 40).join('/')]; }
function f(l: any, n: any, tl: any): any { const it = h(l, n, tl); let r: any, w = 0; do r = it.next(1); while (!r.done && ++w < 300); return r.value ?? ['cut']; }
for (let z = 0; z < 2; z++) for (const mk of [(): any => [1, 2, 3, , 5, 6], (): any => JSON.parse('[1,2,3,4.5,5,6,7,8,9]'), (): any => [1, 2, 'a', 4, 5, 6, 7, 8]]) { const l: any = mk(); let y: any; try { y = f(l, l.length, [1, 2, 3, 4.5, 5, 6, 7, 8]).map(String).join(' '); } catch (e: any) { y = 'T' + msg(e); } console.log(y, closed); }
export {};
