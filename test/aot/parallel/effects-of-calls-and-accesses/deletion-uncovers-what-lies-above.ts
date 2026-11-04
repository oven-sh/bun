// a field is deleted, and the read behind the deletion finds the getter that the class has under the same name
let log = "";
class Above { get x() { log = log + "g"; return "above"; } set x(v: unknown) { Object.defineProperty(this, "x", { value: v, writable: true, configurable: true, enumerable: true }); } }
class P extends Above { y = 2; constructor() { super(); this.x = "own"; } }
function deed(p: P) { const first = p.x; const gone = delete (p as any).x; const second = p.x; return String(first) + " " + gone + " " + String(second) + " " + Object.keys(p).join() + " " + log; }
console.log(deed(new P()));
let all = "";
for (let i = 0; i < 3; i++) all += deed(new P()) + ";";
console.log(all);
const frozen = Object.freeze(new P());
try { console.log(deed(frozen)); } catch (e) { console.log((e as Error).name + " " + String(frozen.x)); }
