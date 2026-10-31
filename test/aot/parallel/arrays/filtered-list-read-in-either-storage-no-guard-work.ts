// A list that filter() made is summed and read by index in one function. The list has storage for any value where storage for numbers is expected, so the reads are copied for the other kind of storage. Built with no work allowed for the analysis that says which test stands for which.
// Flags: --aot-validate --aot-limit=MaxGuardAvailabilityWork:0
const keepAll = [(): unknown => 1][0];
function kept(list: number[]): number[] {
  return list.filter(keepAll);
}
function look(list: number[]): string {
  const result = kept(list);
  return [result.reduce((sum, each) => sum + each, 0), result[1], result.at(1)].map(String).join(" ");
}
let last = "";
for (let turn = 0; turn < 3000; turn++) last = look(turn < 2990 ? [] : [3.5, turn + 0.25]);
console.log(last);
