// `Object.assign(this, given)` goes through all of `given`, as in plain Bun: any object is stored into a field of a class type, whatever its own fields hold, and what comes after it is stored too.
class Tree {
  depth: number;
  constructor(depth: number) {
    this.depth = depth;
  }
}
class Holder {
  first = "f";
  held!: Tree;
  name!: string;
  last?: Tree;
  takeAny(given: any) {
    Object.assign(this, given);
  }
}
const misfits: [string, any][] = [
  ["an object whose depth is a string, between two texts", { first: "stored", held: { depth: "deep" }, name: "stored too" }],
  ["a native object, before a text", { held: new Map(), name: "stored too" }],
  ["an object that fits, then one whose depth is null", { held: { depth: 5 }, last: { depth: null }, name: "stored too" }],
  ["two that fit", { held: { depth: 6 }, last: { depth: 7 }, name: "stored" }],
];
for (const [name, given] of misfits) {
  const holder = new Holder();
  for (let i = 0; i < 3; i++) holder.takeAny({ held: new Tree(i), name: "n" });
  let thrown = "nothing";
  try {
    holder.takeAny(given);
  } catch (error) {
    thrown = (error as Error).constructor.name;
  }
  console.log(name + ": " + JSON.stringify([thrown, holder.first, holder.held, holder.name, holder.last, Object.keys(holder).join()]));
}
