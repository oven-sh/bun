export class Thing {
  constructor(seed) {
    this.size = "size" + seed;
    this.owner = [seed];
  }
}
export function makeThing(seed) {
  return seed === 2 ? { size: seed, owner: { name: "honest" } } : new Thing(seed);
}
