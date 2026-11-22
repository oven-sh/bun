// A loop takes its keys off a list of whole numbers. One list has a hole, and the list below has a property named "undefined".
class Grid {
  readonly cells: number[] = [10, 20, 30, 40, 50, 60];
  total(lines: readonly (readonly number[])[]): string {
    let sum = 0;
    let missed = 0;
    for (const keys of lines) {
      for (const key of keys) {
        const at = this.cells[key];
        if (at === undefined) missed++;
        else sum += at;
      }
    }
    return `${sum} ${missed}`;
  }
}
const lines: number[][] = [0, 1, 2].map(row => [0, 1].map(k => row * 2 + k));
lines[1]![3] = 5;
let asked = 0;
const named = new Grid();
Object.defineProperty(named.cells, "undefined", { get() { asked++; return 1000; }, configurable: true });
for (let round = 0; round < 3; round++) console.log(named.total(lines), asked);

for (let round = 0; round < 3; round++) console.log(new Grid().total(lines));
export {};
