const unseen = (x: any): any => [x][JSON.parse("0")];
class Leaf { size = 2; }
function thrice(leaf: Leaf | undefined, a: boolean, b: boolean, c: boolean): number { if (leaf && a) return 1; if (leaf && b) return 2; if (leaf && c) return 3; return leaf ? 4 : 5; }
function summed(leaf: Leaf | undefined, a: boolean, b: boolean, c: boolean): number { let sum = 0; if (leaf && a) sum += leaf.size; if (leaf && b) sum += 10 * leaf.size; if (leaf && c) sum += 100 * leaf.size; return sum; }
const said: number[] = [];
for (const leaf of [undefined, new Leaf(), unseen(null), unseen(0), unseen({ size: 3 })]) for (let bits = 0; bits < 8; bits++) said.push(Reflect.apply(thrice, undefined, [leaf, !!(bits & 1), !!(bits & 2), !!(bits & 4)]), Reflect.apply(summed, undefined, [leaf, !!(bits & 1), !!(bits & 2), !!(bits & 4)]));
console.log(said.join());
