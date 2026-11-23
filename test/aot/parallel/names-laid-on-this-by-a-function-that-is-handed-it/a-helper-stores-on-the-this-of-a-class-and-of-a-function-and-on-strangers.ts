const out: string[] = [];
function stamp(target: any, tag: string) { target.tag = tag; target.count = (target.count ?? 0) + 1; }
function moved(target: any, tag: string) { target = { other: true }; target.lost = tag; return target; }
class Card { face: string; constructor(face: string) { this.face = face; stamp(this, "card"); moved(this, "card"); } again() { stamp(this, "again"); return this; } }
class Gold extends Card { shine = 1; constructor() { super("gold"); stamp(this, "gold"); } }
function Coin(this: any, side: string) { const self = this; self.side = side; stamp(self, "coin"); }
const show = (o: any) => Object.keys(o).join() + "|" + JSON.stringify(o);
const world = globalThis as any; world.make = { card: (f: string) => new Card(f), gold: () => new Gold(), coin: (s: string) => new (Coin as any)(s) };
for (let i = 0; i < 100; i++) { world.make.card("a"); world.make.gold(); world.make.coin("h"); }
out.push(show(world.make.card("ace")), show(world.make.card("two").again()), show(world.make.gold()), show(world.make.coin("tails")));
const stranger = { first: 1 }; stamp(stranger, "stranger"); out.push(show(stranger));
const frozen = Object.freeze({ tag: "kept" }); try { stamp(frozen, "frozen"); out.push("stored"); } catch (e) { out.push((e as Error).constructor.name); } out.push(show(frozen));
class Watched { set tag(value: string) { out.push("setter " + value); } constructor() { stamp(this, "watched"); } }
out.push(show(new Watched()));
console.log(out.join("\n"));
