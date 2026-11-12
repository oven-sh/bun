abstract class Cord {
  abstract readonly size: number;
  join(other: Cord): Cord {
    if (!this.size) return other;
    if (!other.size) return this;
    return new Pair(this, other);
  }
}
class Strand extends Cord {
  constructor(readonly text: string) { super(); }
  get size(): number { return this.text.length; }
}
class Pair extends Cord {
  readonly size: number;
  constructor(readonly left: Cord, readonly right: Cord) { super(); this.size = left.size + right.size; }
}
let all = 0;
for (let turn = 0; turn < 3000; turn++) {
  let cord: Cord = new Strand("");
  for (let i = 0; i < 6; i++) cord = cord.join(new Strand(i % 3 ? "ab" : "")).join(cord);
  all = (all * 7 + cord.size) % 1000003;
}
console.log(all);
