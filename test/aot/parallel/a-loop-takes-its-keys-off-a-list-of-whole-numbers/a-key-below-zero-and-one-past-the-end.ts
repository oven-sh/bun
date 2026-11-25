// A loop takes its keys off a list of whole numbers. One key lies below zero, one past the end of the list below.
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
lines[0]![1] = -1;
lines[1]![1] = 6;

for (let round = 0; round < 3; round++) console.log(new Grid().total(lines));
export {};
