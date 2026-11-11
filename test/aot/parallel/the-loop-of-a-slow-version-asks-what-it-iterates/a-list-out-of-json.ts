// The guard of told() fails on a parsed record, so its slow version runs. What it iterates is a list out of JSON.parse: the loop goes by index.
// Under: --aot-check=Validate: the loop of a slow version asks what it iterates itself, and the compiler's own checks look at what it builds there.
class Ledger { tint: number; twine: number; constructor(n: number) { this.tint = 0; this.twine = n; } }
const kept: Ledger[] = []; for (let i = 0; i < 4; i++) kept.push(new Ledger(i));
const unseen = <T,>(x: T): T => [x][JSON.parse("0")];
const parsed = (): any => JSON.parse('{"twine":1,"tint":2}');
function told(bag: any, xs: any): string { let text = ""; for (const x of xs) { text = `${text}${x},`; } return text + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine; }
console.log(kept.length, told(parsed(), JSON.parse('[1,"two",null,[3],{"four":4},true]')), told(parsed(), JSON.parse("[]")), told(kept[1], unseen([7, 8])));
