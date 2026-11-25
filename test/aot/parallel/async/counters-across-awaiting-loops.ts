// A second counter that steps beside the counter of an inner loop, while an outer loop's iterations change it: awaits in some iterations, and loops nested by hand.
// BUILD: --aot-harden=proof-checks
const LIST: number[] = [3, 1, 4, 1, 5, 9, 2, 6];
async function fills(xs: number[], stop: number): Promise<any> { let n = 0; const out: any[] = []; for (let i = 0; i < LIST.length; i++) { const x = LIST[i]; if (i === 2) await null; out[n++] = x + 1; if (i === stop) (xs as any)[i] = "str"; } return out.join() + xs.join(); }
async function jumps(add: number): Promise<any> { let n = 0; const out: any[] = []; for (let i = 0; i < LIST.length; i++) { const x = LIST[i]; if (i === 2) { await null; n += add; } out[n++] = x; } return [out.length, Object.keys(out).join(), n].join(" "); }
async function compares(add: number): Promise<any> { let n = 0, s = 0; for (let i = 0; i < LIST.length; i++) { if (i === 2) { await null; n += add; } s += n < 4294967296 ? 1 : 100; n++; s += LIST[n] === undefined ? 1000 : 0; } return s + " " + n; }
async function byHand(add: number): Promise<any> { let n = 0, i = 0; const out: any[] = []; outer: for (;;) { for (; i < LIST.length; i++) { const x = LIST[i]; if (i === 2) { await null; n += add; out[n++] = x; i++; continue outer; } out[n++] = x; } break; } return [out.length, Object.keys(out).join(), n].join(" "); }
let hits = 0; const jobs: (() => void)[] = [() => { hits++; }];
function inStep(add: number): any { let n = 0, i = 0; const out: any[] = []; outer: for (;;) { for (; i < LIST.length; i++) { const x = LIST[i]; if (i === 2) { jobs[0](); n += add; out[n++] = x; i++; continue outer; } out[n++] = x; } break; } return [out.length, Object.keys(out).join(), n].join(" "); }
async function caught(stop: number): Promise<any> { let n = 0; const out: any[] = []; try { for (let i = 0; i < LIST.length; i++) { const x = LIST[i]; if (i === 2) await null; out[n++] = x + 1; if (i === stop) throw n; } } catch (e) { return "caught " + e + out.join(); } finally { n++; } return out.join() + n; }
for (const stop of [-1, 0, 3, 7]) console.log(await fills([1, 2, 3, 4], stop), await caught(stop));
for (const add of [0, 5, -1, 0.5, 1e12, 4294967290, 2 ** 40, NaN]) console.log(await jumps(add), "|", await compares(add), "|", await byHand(add), "|", inStep(add));
console.log(hits);
