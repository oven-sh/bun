// tests objects against one class at one site
class Base {
  constructor(readonly id: number) {}
}
class Derived extends Base {}
const made: new (id: number) => Base = [Derived][0]!;
const objects = Array.from({ length: 16 }, (_, n) => new made(n));
const operations = 160;
let total = 0;

kernel: {
  for (let i = 0; i < operations; i++) {
    if (objects[i & 15]! instanceof made) total++;
  }
}

console.log(total);
