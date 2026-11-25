// The guard of told() fails on a parsed record, so its slow version runs. The turns push onto the list that is iterated and then cut it short: the length is asked anew in every turn.
// Under: --aot-check=Validate: the loop of a slow version asks what it iterates itself, and the compiler's own checks look at what it builds there.
class Ledger { tint: number; twine: number; constructor(n: number) { this.tint = 0; this.twine = n; } }
const kept: Ledger[] = []; for (let i = 0; i < 4; i++) kept.push(new Ledger(i));
const unseen = <T,>(x: T): T => [x][JSON.parse("0")];
const parsed = (): any => JSON.parse('{"twine":1,"tint":2}');
function told(bag: any, xs: any): string { let text = ""; for (const x of xs) { text = `${text}${x},`; if (xs.length < 6) xs.push(x * 2); else if (x === 4) xs.length = 4; } return text + xs.length + ";" + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine; }
console.log(kept.length, told(parsed(), unseen([1, 2])), told(parsed(), unseen([4, 4, 4, 4, 4, 4, 4, 4])));
