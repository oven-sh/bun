// The guard of told() fails on a parsed record, so its slow version runs. What it is to iterate cannot be iterated: the error is the one that `bun <file>` throws.
// Under: --aot-check=Validate: the loop of a slow version asks what it iterates itself, and the compiler's own checks look at what it builds there.
class Ledger { tint: number; twine: number; constructor(n: number) { this.tint = 0; this.twine = n; } }
const kept: Ledger[] = []; for (let i = 0; i < 4; i++) kept.push(new Ledger(i));
const unseen = <T,>(x: T): T => [x][JSON.parse("0")];
const parsed = (): any => JSON.parse('{"twine":1,"tint":2}');
function told(bag: any, xs: any): string { let text = ""; for (const x of xs) { text = `${text}${x},`; } return text + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine; }
for (const odd of [null, undefined, 5, {}, { [Symbol.iterator]: 3 }, { [Symbol.iterator]() { return 3; } }, { [Symbol.iterator]() { return {}; } }]) { try { console.log(told(parsed(), unseen(odd))); } catch (error: any) { console.log(error.name, error.message); } }
