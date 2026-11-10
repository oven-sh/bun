// The guard of told() fails on a parsed record, so its slow version runs. A turn leaves the loop by break, by return and by a throw: over a list nothing is called, over an iterator of the program its return() is called once each time.
// Under: --aot-check=Validate: the loop of a slow version asks what it iterates itself, and the compiler's own checks look at what it builds there.
class Ledger { tint: number; twine: number; constructor(n: number) { this.tint = 0; this.twine = n; } }
const kept: Ledger[] = []; for (let i = 0; i < 4; i++) kept.push(new Ledger(i));
const unseen = <T,>(x: T): T => [x][JSON.parse("0")];
const parsed = (): any => JSON.parse('{"twine":1,"tint":2}');
let closed = 0;
function told(bag: any, xs: any, how: number): string { let text = ""; for (const x of xs) { text = `${text}${x},`; if (x === 2) { if (how === 0) break; if (how === 1) return "left;" + text + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine; throw new RangeError("thrown at " + text); } } return text + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine + bag.twine; }
const steps = (): any => ({ at: 0, [Symbol.iterator]() { return this; }, next() { return { done: this.at >= 4, value: ++this.at }; }, return() { closed++; return {}; } });
for (let how = 0; how < 3; how++) for (const make of [() => unseen([1, 2, 3]), steps]) { try { console.log(how, told(parsed(), make(), how), closed); } catch (error: any) { console.log(how, error.name, error.message, closed); } }
