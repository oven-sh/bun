// Runs numbers through rules of the package in ./package. The arguments behind the first are numbers of turns. After each of them the program marks the place for ../instruction-counts/count-instructions.ts.
import { asRule, AtLeast, AtMost, MultipleOf, run } from "rules";

const rules = [
  new AtLeast({ kind: "least", limit: 3 }),
  new AtMost({ kind: "most", limit: 900 }),
  new MultipleOf({ kind: "multiple", limit: 3 }),
  new AtLeast({ kind: "least", limit: 1 }),
  new AtMost({ kind: "last", limit: 990 }),
].map(asRule);

let turn = 0,
  issues = 0;
for (const turns of process.argv.slice(3)) {
  for (let left = Number(turns); left > 0; left--) {
    turn++;
    for (let value = 0; value < 40; value++)
      issues += run({ value: (value * 29 + turn) % 1000, issues: [] }, rules).issues.length;
  }
  process.kill(process.pid, 0);
}
console.log(turn, issues);
