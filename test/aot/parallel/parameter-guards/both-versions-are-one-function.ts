// The fast version, the slow version and the guard are one function to whoever looks: its name, its length, its text, its frames in a stack trace, its identity.
class Box {
  value = 1;
  other = 2;
}
function reads(box: Box, fail: boolean): number {
  const sum = box.value + box.other;
  if (fail) throw new Error("from reads " + sum);
  return sum + box.value;
}
function outer(box: unknown, fail: boolean): number {
  return reads(box as Box, fail) + 1;
}
const frames = (error: Error) =>
  (error.stack ?? "")
    .split("\n")
    .filter(line => line.includes("reads") || line.includes("outer"))
    .map(line => line.replace(/\(.*[\\/]/, "(").trim())
    .join(" | ");
for (const box of [new Box(), { value: 3, other: 4 }, new Box()]) {
  console.log(outer(box, false));
  try {
    outer(box, true);
  } catch (error) {
    console.log((error as Error).message, "#", frames(error as Error));
  }
}
console.log(reads.name, reads.length, typeof reads, reads === reads, String(reads).length, String(reads).includes("box.value + box.other"));
const table = new Map<Function, string>([[reads, "reads"]]);
console.log(table.get(reads), Object.getOwnPropertyNames(reads).sort().join());
