// `all = { ...all, [key]: value }` under a dictionary type. A copy takes the Structure and the words of its source, and needs no call while the properties fit the cell.
// COUNT: operation:operationAOTCopyDataProperties = 0
// COUNT: operation:operationAOTCopyObject <= 80000
// COUNT: allCells <= 730000
function grown(i: number): number {
  let all: Record<string, number> = {};
  for (let k = 0; k < 8; k++) all = { ...all, ["k" + k]: k + i };
  return all.k7! + all.k0!;
}
let sum = 0;
for (let i = 0; i < 70000; i++) sum += grown(i);
console.log(sum);
