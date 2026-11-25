const holder = { made: null }; globalThis.heldForWitness = holder;
function hidden(v) { holder.made = v; return Reflect.get(globalThis, "heldForWitness").made; }
function tried(f) { try { return f(); } catch (error) { return error.constructor.name + ":" + error.message.slice(0, 40); } }
function show(o) { return o === null || typeof o !== "object" ? typeof o + ":" + String(o) : Object.getPrototypeOf(o) === null ? "null-proto " + JSON.stringify(o) : (Object.getPrototypeOf(o).constructor && Object.getPrototypeOf(o).constructor.name) + " " + JSON.stringify(o) + " " + Reflect.ownKeys(o).map(String).join(); }
function Point(x, y) { var _ = this; _.x = x; _.y = y; _.sum = x + y; }
Point.prototype.norm = function () { return this.x * this.x + this.y * this.y; };
function Other() {} Other.prototype.norm = function () { return "other"; }; Other.prototype.tag = "other";
class Below extends Point { constructor(x) { super(x, x + 1); this.z = 9; } }
class Bare extends Point {}
const P = hidden(Point);
for (let i = 0; i < 4; i++) {
  console.log(show(new P(i, 2)), new P(i, 2).norm());
  const r = Reflect.construct(P, [i, 3], Other); console.log(show(r), r.norm(), r.tag, r instanceof Point, r instanceof Other);
  console.log(show(new Below(i)), new Below(i).norm(), show(new Bare(i, 1)), new Bare(i, 1) instanceof Point);
  console.log(show(Reflect.construct(P, [i, 4], Below)), show(Reflect.construct(P, [i, 5], function () {}.bind(null))), show(Reflect.construct(P, [i, 6], new Proxy(Other, {}))));
  const bound = P.bind(null, 7); console.log(show(new bound(i)), new bound(i) instanceof Point);
}
