// Every call of the constructor and of the two methods is copied in line, and nothing enters them by value: their closures are made, their entries are closed, their bodies are not in the executable.
// STATISTIC: GenericEntriesProvenUnreachable >= 3
class Crate {
  readonly width: number;
  readonly depth: number;
  constructor(width: number, depth: number) {
    this.width = width;
    this.depth = depth;
  }
  floor(): number {
    return this.width * this.depth;
  }
  tag(): string {
    return `crate(${this.width}x${this.depth})`;
  }
}
let sum = 0;
for (let size = 1; size < 5; size++) {
  const crate = new Crate(size, size + 1);
  sum += crate.floor() + crate.tag().length;
}
console.log(sum);
