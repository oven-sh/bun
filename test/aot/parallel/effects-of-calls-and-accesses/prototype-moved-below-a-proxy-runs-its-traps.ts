// an object of the class is moved below a Proxy, whose traps run at a read, a test and a store of a name that the object lacks
let log = "";
class P { x = 1; }
function deed(p: any) { const x = p.x; const before = log; const got = p.missing; const has = "absent" in p; p.added = 1; return x + " " + String(got) + " " + has + " " + p.x + " " + before + "|" + log; }
const plain = new P();
const hostile = new P();
console.log(deed(plain));
Object.setPrototypeOf(hostile, new Proxy({}, { get(t, k) { log = log + "g"; hostile.x = hostile.x + 1; return "trapped"; }, has(t, k) { log = log + "h"; return true; }, set(t, k, v, r) { log = log + "s"; return true; } }));
console.log(deed(hostile));
let all = "";
for (let i = 0; i < 4; i++) all += deed(i % 2 ? hostile : new P()) + ";";
console.log(all);
