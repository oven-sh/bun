// The constructor above is entered by super() alone, and that call is copied too.
// STATISTIC: GenericEntriesProvenUnreachable >= 4
class Base {
  readonly seed: number;
  constructor(seed: number) {
    this.seed = seed;
  }
  twice(): number {
    return this.seed * 2;
  }
}
class Below extends Base {
  readonly more: number;
  constructor(seed: number, more: number) {
    super(seed);
    this.more = more;
  }
  all(): number {
    return this.twice() + this.more;
  }
}
let sum = 0;
for (let i = 0; i < 4; i++) sum += new Below(i, 3).all();
console.log(sum);
