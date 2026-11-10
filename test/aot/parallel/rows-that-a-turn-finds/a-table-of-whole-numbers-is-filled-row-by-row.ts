// The turns of the outer loop fill the rows that they find, so no row is asked in them: read as raw numbers, whole numbers would be stored back as fractions are.
// STATISTIC: ArraysGuardedInIterations = 0
class Table {
  private readonly rows: number[][] = [];
  constructor(
    private readonly left: readonly string[],
    private readonly right: readonly string[],
  ) {
    for (let i = 0; i <= left.length; i++) this.rows.push(new Array<number>(right.length + 1).fill(0));
    this.fill();
  }
  private fill(): void {
    for (let i = this.left.length - 1; i >= 0; i--) {
      const row = this.rows[i]!;
      const below = this.rows[i + 1]!;
      for (let j = this.right.length - 1; j >= 0; j--) {
        row[j] = this.left[i] === this.right[j] ? below[j + 1]! + 1 : Math.max(below[j]!, row[j + 1]!);
      }
    }
  }
  longest(): number {
    return this.rows[0]![0]!;
  }
  show(): string {
    return this.rows.map(row => row.join("")).join("|");
  }
}
const words: string[][] = JSON.parse('[["a","b","c","a","b"],["b","c","a","b","a"],[],["a"]]');
const said: string[] = [];
for (const left of words)
  for (const right of words) said.push(new Table(left, right).longest() + ":" + new Table(left, right).show());
console.log(said.join("\n"));
