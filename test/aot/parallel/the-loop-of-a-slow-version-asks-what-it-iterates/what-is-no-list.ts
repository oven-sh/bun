// The guard of told() fails on a parsed record, so its slow version runs. What it iterates is a Set, a Map, a text, a view and the arguments of a call: none is a list, each is stepped by its own protocol.
// Under: --aot-check=Validate: the loop of a slow version asks what it iterates itself, and the compiler's own checks look at what it builds there.
class Ledger { tint: number; twine: number; constructor(n: number) { this.tint = 0; this.twine = n; } }
const kept: Ledger[] = []; for (let i = 0; i < 4; i++) kept.push(new Ledger(i));
const unseen = <T,>(x: T): T => [x][JSON.parse("0")];
const parsed = (): any => JSON.parse('{"twine":1,"tint":2}');
function told(bag: any, xs: any): string { let text = ""; for (const x of xs) { text = `${text}${x},`; } return text + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine; }
function given(...rest: any[]): any { return (function () { return arguments; })(...rest as []); }
console.log(kept.length, told(parsed(), unseen(new Set(["a", "b", "a"]))), told(parsed(), unseen(new Map([["k", 1]]))), told(parsed(), unseen("t\u{1F600}x")), told(parsed(), unseen(new Uint8Array([5, 6]))), told(parsed(), given(9, 8)));
