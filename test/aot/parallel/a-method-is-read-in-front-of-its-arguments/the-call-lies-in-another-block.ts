const hide = new Function("value", "return value") as <V>(value: V) => V;
class Slot { total = 0; seen = ""; take(a: unknown): number { this.total += 1; this.seen += String(a) + ";"; return this.total; } }
const slot = hide(new Slot());
function f(): number { return hide(4); } const c = hide(true);
class Two { n = 0; of(a: number, b: number): number { this.n += a * b; return this.n; } } const two = hide(new Two());
function bump(): string { return two.of(f(), c ? 1 : 2) + ""; }
console.log(hide(bump)(), "|", hide(bump)());
