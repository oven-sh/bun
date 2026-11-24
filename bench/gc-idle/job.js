// A timer job that builds rows, holds them over an await and drops them. A collection that begins inside the hold finds
// the rows alive, and then only a full collection frees them.
//
//   BUN_JSC_logGC=1 bun bench/gc-idle/job.js [seconds=25] [MB=3.5] [hold ms=50] [delay ms=0] [period ms=1000] 2> log
//
// The job is created `delay` ms after load. Count in the log:
//   grep -c "=> FullCollection" log
//   grep -c "=> EdenCollection" log
//   awk '/JOB-HELD/{held=1;hit=0} /JOB-DROPPED/{n+=hit;held=0} held&&/Collection, /{hit=1} END{print n+0}' log
// The awk line counts the jobs that had a collection begin inside their hold. The last line of the log is the CPU time
// of the process in ms.
const [seconds = 25, mb = 3.5, hold = 50, delay = 0, period = 1000] = process.argv.slice(2).map(Number);

const row = i => ({ id: i, name: "row-" + i, tags: ["a" + i, "b" + i], extra: { a: i, c: [i, i + 1] } });
function rows() {
  const all = [];
  const count = Math.round((mb * 1048576) / 330);
  for (let i = 0; i < count; i++) all.push(row(i));
  return all;
}

let held = null;
async function job() {
  held = rows();
  console.error("JOB-HELD");
  await new Promise(resolve => setTimeout(resolve, hold));
  held = null;
  console.error("JOB-DROPPED");
}
const start = () => setInterval(job, period);
if (delay > 0) setTimeout(start, delay);
else start();

setTimeout(() => {
  const { user, system } = process.cpuUsage();
  console.error("CPU-MS " + Math.round((user + system) / 1000));
  process.exit(0);
}, seconds * 1000);
