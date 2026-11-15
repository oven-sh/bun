const kLevel = Symbol("level"), kNote = Symbol("note");
let log = "";
function Base() { this.id = 1; }
const source = { get [kLevel]() { log += "g"; return 7; }, set [kLevel](v) { log += "s" + v; }, plain() { return 1; } };
for (const key of Reflect.ownKeys(source)) Object.defineProperty(Base.prototype, key, Object.getOwnPropertyDescriptor(source, key));
class Below extends Base { constructor() { super(); this.name = "below"; } }
function mark(b, n) { b[kLevel] = n; b[kNote] = "n" + n; return b[kLevel]; }
const out = [], kept = [];
for (let i = 0; i < 5; i++) { const b = i & 1 ? new Below() : new Base(); kept.push(b); out.push(mark(b, i) + "|" + Reflect.ownKeys(b).map(String).join() + "|" + Object.hasOwn(b, kLevel)); }
console.log(out.join("\n")); console.log(log); console.log(kept[0], kept[1]);
