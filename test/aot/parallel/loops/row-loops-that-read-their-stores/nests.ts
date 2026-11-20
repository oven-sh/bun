// A tub knows how often it was asked how full it is.
class Tub {
  asked = 0;
  held = 0;
  valueOf(): number {
    this.asked++;
    return this.held + this.asked;
  }
}
function equals(level: number[], rain: number[], tub: Tub, full: number, days: number): number {
  for (let day = 0; day < days; day++) {
    if ((tub as any) == full) return day;
    for (let at = 0; at < level.length; at++) level[at] = level[at] + rain[at];
  }
  return -1;
}
function over(level: number[], rain: number[], tub: Tub, full: number, days: number): number {
  for (let day = 0; day < days; day++) {
    if ((tub as any) > full) return day;
    for (let at = 0; at < level.length; at++) level[at] = level[at] + rain[at];
  }
  return -1;
}
function columns(rows: number[][], shares: number[], into: number[], tub: Tub, full: number, many: number, high: number): number {
  for (let column = 0; column < many; column++) {
    if ((tub as any) > full) return column;
    let sum = 0;
    for (let at = 0; at < high; at++) sum += rows[at][column] * shares[at];
    into[column] = sum;
  }
  return -1;
}
for (const full of [2, 5, 40]) {
  for (const days of [3, 10]) {
    const first = new Tub(), second = new Tub(), third = new Tub();
    const level = [0.5, 1.25, 2, 0.75], other = [0.5, 1.25, 2, 0.75], into = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
    console.log("equals", full, days, equals(level, [0.5, 1, 0.25, 0.125], first, full, days), first.asked, level.join(" "));
    console.log("over", full, days, over(other, [0.5, 1, 0.25, 0.125], second, full, days), second.asked, other.join(" "));
    const rows = Array.from({ length: 4 }, (_, row) => Array.from({ length: 8 }, (_, at) => row * 0.5 + at + 0.25));
    console.log("columns", full, days, columns(rows, [0.5, 1.5, 2.25, 0.75], into, third, full, 8, 4), third.asked, into.join(" "));
  }
}
console.log("END");
export {};
