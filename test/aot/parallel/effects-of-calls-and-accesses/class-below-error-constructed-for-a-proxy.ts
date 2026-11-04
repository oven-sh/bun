// a class below Error is constructed with a Proxy as new.target, whose trap runs where the super call reads `prototype` and writes a variable that the constructor reads on both sides
let log = "";
class E extends Error { seen: string; constructor(m: string) { const before = log; super(m); this.seen = before + "|" + log; } }
const trapped = new Proxy(E, { get(target, key, receiver) { if (key === "prototype") log = log + "p"; return Reflect.get(target, key, receiver); } });
function deed(newTarget: any) { const e = Reflect.construct(E, ["m"], newTarget); return e.seen + " " + e.message + " " + (e instanceof E); }
console.log(deed(E));
console.log(deed(trapped));
let all = "";
for (let i = 0; i < 4; i++) all += deed(i % 2 ? trapped : E) + ";";
console.log(all);
console.log(new E("plain").seen);
