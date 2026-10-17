// tests objects against the class that made them at one site that sees sixteen classes
class Base {
  constructor(readonly id: number) {}
}
const classes: (new (id: number) => Base)[] = [];
for (let n = 0; n < 16; n++) {
  const made = class extends Base {
    static readonly index = n;
  };
  Object.defineProperty(made, "tag" + n, { value: n });
  classes.push(made);
}
const objects = classes.map((made, n) => new made(n));
const operations = 160;
let total = 0;

kernel: {
  for (let i = 0; i < operations; i++) {
    if (objects[i & 15]! instanceof classes[i & 15]!) total++;
  }
}

console.log(total);
