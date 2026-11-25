// STATISTIC: AccessesInsideViews >= 3
class Tally {
  readonly bytes = new Uint8Array(6);
  readonly counts = new Uint32Array(4);
  readonly sums = new Float64Array(4);
  at = 0;
  bump(left: number): void {
    const key = this.bytes[this.at++]!;
    this.counts[key]!++;
    this.sums[key]! += 0.5;
    this.counts[key] = this.counts[key]! * 2;
    if (left > 0) this.bump(left - 1);
  }
}
const tally = new Tally();
tally.bytes.set([0, 3, 3, 4, 255, 1]);
tally.bump(8);
console.log(tally.at, tally.counts.join(), tally.sums.join(), Object.keys(tally.counts).join(), String((tally.counts as any).undefined));
