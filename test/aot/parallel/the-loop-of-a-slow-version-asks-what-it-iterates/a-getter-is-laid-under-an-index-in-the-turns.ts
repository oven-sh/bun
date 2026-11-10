// The guard of told() fails on a parsed record, so its slow version runs. The first turn lays a getter under an index that is still to come: the turn that reaches it calls the getter, once.
// Under: --aot-check=Validate: the loop of a slow version asks what it iterates itself, and the compiler's own checks look at what it builds there.
class Ledger { tint: number; twine: number; constructor(n: number) { this.tint = 0; this.twine = n; } }
const kept: Ledger[] = []; for (let i = 0; i < 4; i++) kept.push(new Ledger(i));
const unseen = <T,>(x: T): T => [x][JSON.parse("0")];
const parsed = (): any => JSON.parse('{"twine":1,"tint":2}');
let calls = 0;
function told(bag: any, xs: any): string { let text = ""; for (const x of xs) { text = `${text}${x},`; if (x === "first") Object.defineProperty(xs, "2", { get() { calls++; return "gotten"; }, configurable: true }); } return text + calls + ";" + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine; }
console.log(kept.length, told(parsed(), unseen(["first", "second", "third", "fourth"])));
