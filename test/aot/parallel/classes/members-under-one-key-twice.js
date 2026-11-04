class Twice {
    m() { return 1; }
    m() { return 2; }
    static s() { return 1; }
    static s() { return 2; }
    get g() { return 1; }
    get g() { return 2; }
    both() { return 1; }
    get both() { return 2; }
    get back() { return 1; }
    back() { return 2; }
    get pair() { return 1; }
    set pair(v) { this.kept = v; }
    get pair() { return 3; }
}
const t = new Twice();
console.log(t.m(), Twice.s(), t.g, t.both, t.back(), t.pair);
t.pair = 5;
console.log(t.kept, Object.getOwnPropertyNames(Twice.prototype).join(), Object.getOwnPropertyNames(Twice).join());
class Below extends Twice { m() { return super.m() + 10; } m() { return super.m() + 20; } }
console.log(new Below().m(), Twice.prototype.m.name, typeof Object.getOwnPropertyDescriptor(Twice.prototype, "both").get, typeof Object.getOwnPropertyDescriptor(Twice.prototype, "back").value);
function call(o) { return o.m(); }
let sum = 0;
for (let i = 0; i < 1000; i++) sum += call(i & 1 ? t : new Below());
console.log(sum);
