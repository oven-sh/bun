// the members of a union list `kind` at different places among their fields, one of them below a base class. Wherever the slots lie, the keys are listed in the order in which the objects got them, each field holds its own value, and a collection between the making and the reads moves nothing
class Base { id = 1; }
class Decl extends Base { extra = 2; kind = "decl"; }
class Expr { kind = "expr"; more = 3; other = 4; }
type Rec = { a: number; kind: string };
function kindOf(n: Decl | Expr | Rec) { return n.kind; }
function show(o: object) { return Object.keys(o).join() + "=" + JSON.stringify(o); }
function deed() { return [new Decl(), new Expr(), { a: 5, kind: "rec" } as Rec]; }
const made = deed();
Bun.gc(true);
for (let i = 0; i < made.length; i++) console.log(kindOf(made[i]), show(made[i]));
let kinds = "";
for (let turn = 0; turn < 300; turn++) { const all = deed(); kinds = kindOf(all[turn % 3]) + kindOf(all[(turn + 1) % 3]); }
console.log(kinds);
const decl = new Decl();
decl.kind = "changed";
decl.extra = 20;
decl.id = 10;
console.log(show(decl), kindOf(decl), show(new Base()));
