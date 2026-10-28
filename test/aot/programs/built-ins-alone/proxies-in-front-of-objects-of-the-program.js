const lines = [];
function attempt(name, run) {
  try {
    lines.push(name + ": " + String(run()));
  } catch (error) {
    lines.push(name + ": " + error.constructor.name + ": " + error.message);
  }
}
class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  get sum() {
    return this.x + this.y;
  }
}
const answers = { get(target, key) { return key === "x" ? 100 : target[key]; } };

const plain = new Proxy({ x: 1, y: 2 }, answers);
attempt("literal", () => plain.x + plain.y + String(plain.z));
const point = new Proxy(new Point(3, 4), answers);
attempt("instance", () => point.x + point.y + point.sum);

const frozen = Object.freeze({ x: 1, y: 2 });
attempt("frozen, another answer", () => new Proxy(frozen, answers).x);
attempt("frozen, the same answer", () => new Proxy(frozen, answers).y);
const sealed = Object.seal({ x: 1, y: 2 });
attempt("sealed", () => new Proxy(sealed, answers).x);
const redefined = { x: 1, y: 2 };
const inFront = new Proxy(redefined, answers);
attempt("before the definition", () => inFront.x);
Object.defineProperty(redefined, "x", { value: 1, writable: false, configurable: false });
attempt("read-only and not configurable", () => inFront.x);
attempt("its neighbor", () => inFront.y);
const onlySetter = new Point(5, 6);
Object.defineProperty(onlySetter, "x", { set(value) {}, configurable: false });
attempt("an accessor without a getter", () => new Proxy(onlySetter, answers).x);
attempt("an accessor without a getter, undefined", () => new Proxy(onlySetter, { get() { return undefined; } }).x);
const added = { x: 1 };
Object.defineProperty(added, "late", { value: 7 });
attempt("a name added late, another answer", () => new Proxy(added, { get() { return 8; } }).late);
attempt("a name added late, the same answer", () => new Proxy(added, { get() { return 7; } }).late);
const indexed = { x: 1 };
Object.defineProperty(indexed, "0", { value: "zero" });
attempt("an index, another answer", () => new Proxy(indexed, { get() { return "one"; } })[0]);
attempt("an index, the same answer", () => new Proxy(indexed, { get() { return "zero"; } })[0]);
const symbol = Symbol("mark");
const marked = { [symbol]: 1 };
Object.freeze(marked);
attempt("a symbol, another answer", () => new Proxy(marked, { get() { return 2; } })[symbol]);

let reads = 0;
const counted = { get get() { reads++; return (target, key) => "from a getter " + String(key); } };
attempt("the trap behind a getter", () => new Proxy({ x: 1 }, counted).x + " " + new Proxy({ x: 1 }, counted).y + " " + reads);
class Handler {
  get(target, key) {
    return "from the class " + String(key);
  }
}
attempt("the trap on a prototype", () => new Proxy({ x: 1 }, new Handler()).x);
const changing = { get(target, key) { return "first"; } };
const watched = new Proxy({ x: 1 }, changing);
attempt("the trap as made", () => watched.x);
changing.get = () => "second";
attempt("the trap replaced", () => watched.x);
delete changing.get;
attempt("the trap deleted", () => watched.x);
Object.setPrototypeOf(changing, { get() { return "inherited"; } });
attempt("the trap inherited", () => watched.x);
changing.get = null;
attempt("the trap null", () => watched.x);
changing.get = 5;
attempt("the trap a number", () => watched.x);
Object.defineProperty(changing, "get", { get() { return () => "by an accessor"; }, configurable: true });
attempt("the trap an accessor", () => watched.x);
const other = { has(target, key) { return key === "ghost"; }, set(target, key, value) { target[key] = value * 2; return true; }, deleteProperty(target, key) { return delete target[key]; }, ownKeys(target) { return ["x"]; } };
const busy = new Proxy({ x: 1 }, other);
attempt("the other traps", () => { busy.y = 4; return ("ghost" in busy) + " " + ("x" in busy) + " " + busy.y + " " + delete busy.y + " " + busy.y + " " + Reflect.ownKeys(busy).join(); });
const bare = {};
const through = new Proxy({ x: 1 }, bare);
attempt("no trap", () => through.x + " " + through.x);
bare.unrelated = 1;
attempt("another name on the handler", () => through.x);
bare.get = () => "late";
attempt("a trap added late", () => through.x);
const { proxy: revocable, revoke } = Proxy.revocable({ x: 1 }, answers);
attempt("before it is revoked", () => revocable.x);
revoke();
attempt("revoked", () => revocable.x);

let total = 0;
for (let round = 0; round < 20000; round++) total += plain.x + point.y;
lines.push("rounds " + total);
console.log(lines.join("\n"));
