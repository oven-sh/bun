const unseen = (x) => [x][JSON.parse("0")];
const kept = [], pending = [];
function smash(n, x) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return n ? smash(n - 1, unseen(x + work)) + 1 : x; }
const out = [], steppers = [], waits = [];
function each(list, job) { let n = 0; for (let i = 0; i < list.length; i++) { waits.push(job(list[i])); n++; } return n; }
function eachBackwards(list, job) { let n = 0; for (let i = list.length - 1; i >= 0; i--) { waits.push(job(list[i])); n++; } return n; }
const runners = [each, eachBackwards];
function maker(run, list, base) {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const n = run(list, async (x) => { await null; out.push(base + x); });
  return n + work;
}
function drive() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; const run = runners[JSON.parse("0")], back = runners[JSON.parse("1")]; let total = 0; for (let t = 0; t < 6; t++) total += maker(t & 1 ? back : run, [1, 2], t * 100); return total; }
async function main() { const total = drive(), depth = smash(300, 0); for (const s of steppers) s.next(); await Promise.all(waits); await null; await null; for (const s of steppers) s.next(); console.log(total, depth, out.join(" ")); }
main();
