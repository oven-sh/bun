// STATISTIC: MethodCallsThroughTable >= 1
interface Runner { run(a?: number, b?: number): number }
var tally = 0;
class Hare implements Runner { run() { tally += 1; return 1; } }
class Mole implements Runner { run() { tally += 10; return 2; } }
function drive(runner: Runner) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; const before = tally; const got = runner.run(7, 8); const after = tally; return got * 1000 + (after - before) + work; }
console.log(drive(new Hare()), drive(new Mole()), tally);
