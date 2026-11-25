const said: unknown[] = [];
class Pair { left = 0; right = 0; set both(v: number) { this.left = v; this.right = v; } get both() { return this.left + this.right; } }
type Side = "left" | "right";
function store(pair: Pair, side: Side, v: number) { pair[side] = v; }
function storeAny(pair: Pair, side: Side | "both", v: number) { pair[side] = v; return pair[side]; }
function asks(pair: object, side: Side) { return side in pair; }
function drops(pair: Partial<Pair>, side: Side) { return delete pair[side]; }
const pair = new Pair(); const frozen = Object.freeze(new Pair()); const sealed = Object.seal(new Pair());
for (let i = 0; i < 300; i++) {
  pair[i & 1 ? "left" : "right"] = i; store(pair, i & 2 ? "left" : "right", -i);
  try { store(frozen, i & 1 ? "left" : "right", i); } catch (e) { if (i < 2) said.push((e as Error).constructor.name); }
  store(sealed, i & 1 ? "left" : "right", i);
  if (i % 50 === 0) {
    said.push(pair.left, pair.right, storeAny(pair, i % 100 ? "both" : "left", i), asks(pair, i & 1 ? "left" : "right"), asks({ left: 1 }, i % 100 ? "left" : "right"));
    const loose: Partial<Pair> = { left: 1, right: 2 }; said.push(drops(loose, i % 100 ? "left" : "right"), JSON.stringify(loose));
    try { said.push(drops(sealed, i % 100 ? "left" : "right")); } catch (e) { said.push((e as Error).constructor.name); }
  }
}
said.push(pair.left, pair.right, frozen.left, sealed.left, sealed.right);
console.log(said.map(String).join(" "));
