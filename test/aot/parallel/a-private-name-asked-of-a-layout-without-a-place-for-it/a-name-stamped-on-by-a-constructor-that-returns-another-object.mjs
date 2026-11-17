class Base { constructor(o) { return o; } }
class Stamp extends Base { #x = 1; static has(o) { return #x in o; } }
class Q { y = 2; }
const list = [new Q(), new Q(), new Q()];
const out = list.map((o) => Stamp.has(o)); out.push("|");
new Stamp(list[1]);
for (let turn = 0; turn < 3; turn++) for (const o of list) out.push(Stamp.has(o));
console.log(out.join(" "));
