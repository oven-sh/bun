// The list under the key is named in front of the loops. Each key is an index of it.
class Grid {
  readonly cells: number[] = [10, 20, 30, 40, 50, 60];
  stepped(lines: readonly (readonly number[])[]): string {
    const grid = this.cells;
    let sum = 0;
    let missed = 0;
    for (const keys of lines) {
      for (const key of keys) {
        const at = grid[key];
        if (at === undefined) missed++;
        else sum += at;
      }
    }
    return `${sum} ${missed}`;
  }
  counted(lines: readonly (readonly number[])[]): string {
    const grid = this.cells;
    let sum = 0;
    let missed = 0;
    for (let l = 0; l < lines.length; l++) {
      const keys = lines[l]!;
      for (let k = 0; k < keys.length; k++) {
        const key = keys[k]!;
        const at = grid[key];
        if (at === undefined) missed++;
        else sum += at;
      }
    }
    return `${sum} ${missed}`;
  }
}
const lines: number[][] = [0, 1, 2].map(row => [0, 1].map(k => row * 2 + k));
for (let round = 0; round < 3; round++) console.log(new Grid().stepped(lines), "|", new Grid().counted(lines));
export {};
