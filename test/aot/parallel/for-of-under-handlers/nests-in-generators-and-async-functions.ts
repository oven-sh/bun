// A for-of in a for-of whose turns yield or await; a generator that is returned from in the middle of the inner loop.
// STATISTIC: IteratorStepsThreadedUnderHandlers >= 2
function* flat(rows: number[][]) { for (const r of rows) for (const v of r) yield v; }
async function slow(rows: number[][]) { let s = 0; for (const r of rows) for (const v of r) { s += v; if (v === 3) await null; } return s; }
const rows: number[][] = []; for (let i = 0; i < 6; i++) { const r: number[] = []; for (let j = 0; j < 6; j++) r.push(j); rows.push(r); }
let s = 0; for (let k = 0; k < 30; k++) for (const v of flat(rows)) s += v;
console.log(s);
const g = flat(rows); g.next(); g.next(); console.log(JSON.stringify(g.return(9 as any)), JSON.stringify(g.next()));
slow(rows).then(v => console.log(v));
