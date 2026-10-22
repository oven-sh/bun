// Reads by name: member c. It prints what plain Bun prints.
const box = JSON.parse("[0]"); function hidden(value) { box[0] = value; return box[0]; }
class Base {
  constructor(value) { this.value = value; }
  first() { return "Base.first " + this.value; }
  second() { return "Base.second " + this.value; }
}
class Middle extends Base {
  second() { return "Middle.second " + this.value; }
}
function same(o) { return o.second === Base.prototype.second; }
const instances = [new Base(0), new Middle(1)];
for (let i = 0; i < 3; i++) for (const x of instances) { const o = hidden(x); console.log(i, typeof o.first, typeof o.second, typeof o.missing, same(o)); }
