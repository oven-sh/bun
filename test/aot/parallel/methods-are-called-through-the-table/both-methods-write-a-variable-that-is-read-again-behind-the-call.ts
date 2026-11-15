// STATISTIC: MethodCallsThroughTable >= 1
interface Runner { run(): number }
var tally = 0;
class Hare implements Runner { n = 1; run() { tally += this.n; return 1; } }
class Mole implements Runner { n = 10; run() { tally += this.n; return 2; } }
function drive(runner: Runner) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; const before = tally; const got = runner.run(); const after = tally; return got * 1000 + (after - before) + work; }
console.log(drive(new Hare()), drive(new Mole()), tally);
