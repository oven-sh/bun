// A variable that holds one of a few written texts is stored between two calls that may throw. The handler and the `finally` read what it held at the throw.
// Under: --aot-testing=CheckProofsAtRunTime: the type of a join of written texts
const parts = JSON.parse('["he","x","oc","t","bi","n","de","c"]') as string[];
const log: string[] = [];
let failAt = 0;
let calls = 0;
function fail() { if (++calls === failAt) throw new RangeError("at " + calls); }
function run(n: number, other: string) {
  let kind = n > 0 ? "hex" : "dec";
  try {
    fail();
    kind = n > 1 ? "oct" : "bin";
    fail();
    return "through " + kind;
  } catch (error) {
    return kind + String(kind === other) + (error as Error).message;
  } finally {
    log.push(kind);
  }
}
const lines: string[] = [];
for (const at of [1, 2, 3]) {
  for (const n of [0, 1, 2]) {
    failAt = at;
    calls = 0;
    lines.push(run(n, parts[0] + parts[1]) + " " + (calls = 0, run(n, parts[4] + parts[5])) + " " + (calls = 0, run(n, parts[2] + parts[3])) + " " + (calls = 0, run(n, parts[6] + parts[7])));
  }
}
console.log(lines.join("\n"));
console.log(log.join());
