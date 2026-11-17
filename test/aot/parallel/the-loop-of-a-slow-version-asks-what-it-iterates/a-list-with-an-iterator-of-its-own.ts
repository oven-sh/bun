// The guard of told() fails on a parsed record, so its slow version runs. The list bears a method of its own under Symbol.iterator, and the heir of Array one on its prototype: both are stepped by that method.
// Under: --aot-check=Validate: the loop of a slow version asks what it iterates itself, and the compiler's own checks look at what it builds there.
class Ledger { tint: number; twine: number; constructor(n: number) { this.tint = 0; this.twine = n; } }
const kept: Ledger[] = []; for (let i = 0; i < 4; i++) kept.push(new Ledger(i));
const unseen = <T,>(x: T): T => [x][JSON.parse("0")];
const parsed = (): any => JSON.parse('{"twine":1,"tint":2}');
function told(bag: any, xs: any): string { let text = ""; for (const x of xs) { text = `${text}${x},`; } return text + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine; }
const own: any = unseen([1, 2, 3]); own[Symbol.iterator] = function* () { yield "own"; yield this.length; };
class Backwards extends Array<number> { *[Symbol.iterator](): any { for (let i = this.length - 1; i >= 0; i--) yield this[i]; } }
console.log(kept.length, told(parsed(), own), told(parsed(), unseen(Backwards.from([1, 2, 3]))));
