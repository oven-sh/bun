// An untyped package and a program of it (semaphores): a queue of workers with priorities, pausing, draining, retries; a mutex, a semaphore and a barrier beside it
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
(async () => { const s = new lib.Semaphore(3), b = new lib.Barrier(4), log = []; const jobs = []; for (let i = 0; i < 14; i++) jobs.push(s.use(async waiting => { log.push('in' + i + '/' + waiting); for (let k = 0; k < i % 4; k++) await null; if (i % 5 === 4) throw new RangeError('job ' + i); return i * 10; })); const r = await Promise.allSettled(jobs); say(log.join(' ')); say(r.map(x => x.status === 'fulfilled' ? x.value : x.reason.message).join()); const rounds = await Promise.all([...Array(12).keys()].map(async i => { const out = []; for (let k = 0; k < 2; k++) { out.push(await b.wait()); } return i + ':' + out.join('/'); })); rounds.forEach(x => say(x)); say(b.round, b.count); for (let i = 0; i < 6; i++) say(i, await s.use(() => 'sync ' + i), await s.use(w => Promise.resolve(w)), await s.use(async () => { throw new Error('e' + i); }).catch(e => e.message)); })();
