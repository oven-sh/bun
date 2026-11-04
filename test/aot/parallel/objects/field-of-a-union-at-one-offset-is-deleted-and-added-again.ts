// the members of a union list `kind` at different places among their fields, one of them below a base class. `kind` is deleted from one object and stored again: it reads undefined in between, and comes last among the keys from then on
class Base { id = 1; }
class Decl extends Base { extra = 2; kind = "decl"; }
class Expr { kind = "expr"; more = 3; other = 4; }
function kindOf(n: Decl | Expr) { return n.kind; }
function show(o: object) { return Object.keys(o).join() + "=" + JSON.stringify(o); }
function deed(n: Decl | Expr) { delete (n as any).kind; return n; }
const decl = new Decl();
const expr = new Expr();
console.log(kindOf(decl), kindOf(expr));
console.log(String(kindOf(deed(decl))), show(decl), String(kindOf(deed(expr))), show(expr));
decl.kind = "again";
expr.kind = "anew";
console.log(kindOf(decl), show(decl), kindOf(expr), show(expr));
let kinds = "";
for (let turn = 0; turn < 300; turn++) kinds = String(kindOf(turn % 3 ? new Decl() : deed(new Expr()))) + kinds.slice(0, 24);
console.log(kinds);
