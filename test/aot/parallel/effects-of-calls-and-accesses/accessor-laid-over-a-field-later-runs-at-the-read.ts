// an accessor is laid over a field of one object of the class later, and runs at a read that is written as a read of the field
let log = "";
class P { x = 1; y = 2; }
function deed(p: P) { const y = p.y; const before = log; const got = p.x; return y + " " + got + " " + p.y + " " + before + "|" + log; }
const plain = new P();
const hostile = new P();
console.log(deed(plain));
console.log(deed(hostile));
Object.defineProperty(hostile, "x", { get() { log = log + "g"; this.y = this.y + 1; return 7; } });
console.log(deed(hostile));
let all = "";
for (let i = 0; i < 4; i++) all += deed(i % 2 ? hostile : plain) + ";";
console.log(all);
