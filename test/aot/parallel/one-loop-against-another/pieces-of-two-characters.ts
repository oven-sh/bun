// Pieces cut out of a text and kept: by slice() and as the groups of a match. One loop of each kind cuts pieces of three characters, the other pieces of two, and nothing else in its turns makes a string.
// COUNT: operations <= 160
// COUNT: arrivals <= 20
// COUNT: cells <= 25100
// COUNT: branches <= 45500
const text = "0123456789abcdefghijklmnopqrstuvwxyz".slice(process.argv.length > 99 ? 1 : 0);
const shortDates = ["10-26", "11-05", "01-31", "12-25"];
const longDates = ["110-226", "111-305", "101-131", "112-325"];
const kept: string[] = ["", "", "", "", "", "", "", ""];
function slicesOf(length: number, turns: number): number {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const piece = text.slice(i & 15, (i & 15) + length);
    sum += piece.length;
    kept[i & 7] = piece;
  }
  return sum;
}
function groupsOfTwo(turns: number): number {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const match = /^(\d\d)-(\d\d)$/.exec(shortDates[i & 3]!);
    if (match === null) continue;
    sum += match[1]!.length;
    kept[i & 7] = match[2]!;
  }
  return sum;
}
function groupsOfThree(turns: number): number {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const match = /^(\d\d\d)-(\d\d\d)$/.exec(longDates[i & 3]!);
    if (match === null) continue;
    sum += match[1]!.length;
    kept[i & 7] = match[2]!;
  }
  return sum;
}
const loops: Record<string, (turns: number) => number> = {
  "slices of three characters": turns => slicesOf(3, turns),
  "slices of two characters": turns => slicesOf(2, turns),
  "groups of three digits": groupsOfThree,
  "groups of two digits": groupsOfTwo,
};
for (const name in loops) console.log(name, loops[name]!(2500), kept.join(" "));
export {};
