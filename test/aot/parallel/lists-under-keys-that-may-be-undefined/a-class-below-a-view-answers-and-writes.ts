// The same for views: the getter `undefined` of a class below Uint8Array writes into a record that it reaches through a variable of the module, and into the view.
class Count { n: number = 1; }
const counts = [new Count(), new Count()];
class Below extends Uint8Array { get undefined(): number { (counts[0] as unknown as { n: unknown }).n = "text"; this[0] = 9; return this.length; } }
const none: number[] = [];
function look(view: Uint8Array): string { const found: unknown = view[none.pop()!]; let s = 0; for (let i = 0; i < counts.length; i++) s += counts[i]!.n; (counts[0] as Count).n = 1; return String(found) + " " + String(s) + " " + view[0]; }
console.log(look(new Below(2)), look(Below.of(1, 2)), look(Below.from([1, 2])), look(new Below(4).subarray(1, 3)), look(new Below(2).map(x => x)), look(Reflect.construct(Uint8Array, [2], Below) as Uint8Array), look(new Below(3).slice(1)), look((Uint8Array.of as Function).call(Below, 1, 2) as Uint8Array));
console.log(look(new Uint8Array(2)));
