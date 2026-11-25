class Base { constructor(o) { return o; } }
class Stamp extends Base { #x = 1; #m() {} static has(o) { return #x in o; } static hasMethod(o) { return #m in o; } }
class Q { y = 2; }
const q = new Q(); const out = [];
for (let i = 0; i < 4; i++) out.push(Stamp.has(q), Stamp.hasMethod(q));
new Stamp(q);
for (let i = 0; i < 4; i++) out.push(Stamp.has(q), Stamp.hasMethod(q));
console.log(out.join(" "), Stamp.has(new Q()));
