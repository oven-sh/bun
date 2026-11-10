// Between two reads of the length stands a call that may shorten the list: the second read asks again.
// STATISTIC: ListsHandedInAskedOnceForWhatStandsBehindBranch = 1
const shared: number[] = JSON.parse("[1,2,3]");
let calls = 0;
function touch(): void { calls++; if (calls % 2) shared.pop(); else shared.push(calls, calls); }
function gather(parts: readonly number[]): string {
  if (parts.length === 0) return "none";
  touch();
  if (parts.length === 2) return "two:" + parts[1];
  touch();
  if (parts.length === 4) return "four:" + parts[3];
  return "other:" + parts.length;
}
const answers: string[] = [];
for (let turn = 0; turn < 6; turn++) answers.push(gather(shared));
console.log(answers.join(), shared.join());
