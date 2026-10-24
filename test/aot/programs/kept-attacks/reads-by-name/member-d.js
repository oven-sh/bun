// Reads by name: member d. It prints what plain Bun prints.
const box = JSON.parse("[0]"); function hidden(value) { box[0] = value; return box[0]; }
class Base {
  constructor(value) { this.value = value; }
  first() { return "Base.first " + this.value; }
  second() { return "Base.second " + this.value; }
}
class Middle extends Base {
  second() { return "Middle.second " + this.value; }
}
if (process.argv.length > 99) hidden(new Middle(3)).second = () => 1;
const instances = [new Base(0), new Middle(1)];
for (let i = 0; i < 40; i++) for (const x of instances) { const o = hidden(x); if (i % 13 === 0) console.log(i, typeof o.first, typeof o.second, typeof o.missing); }
