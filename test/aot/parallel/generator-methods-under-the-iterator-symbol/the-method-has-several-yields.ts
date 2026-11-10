// A loop over an object with a generator method under Symbol.iterator: the method has several yields.
// STATISTIC: GeneratorMethodsWalkedInPlaceOfIterations >= 1
class Pair { constructor(private left: number, private right: string) {} *[Symbol.iterator]() { yield this.left; yield this.right; yield this.left + 1; } }
function join(pair: Pair): string { let text = ""; for (const part of pair) text += part + ";"; return text; }
for (let turn = 0; turn < 3; turn++) console.log(join(new Pair(turn, "b")));
