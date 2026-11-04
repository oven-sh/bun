// one member of an interface stands below Map, so no test of shapes lets it through: where the others are tested for, its objects take the closed arm, which runs the getter that it lays over `size`
interface Sized {
  size: number;
}

class Plain implements Sized {
  size: number;
  constructor(size: number) {
    this.size = size;
  }
}

let reads = 0;
class Registry extends Map<string, number> implements Sized {
  get size() {
    reads++;
    return Reflect.get(Map.prototype, "size", this) + 100;
  }
}

function sizeOf(x: Sized): number {
  return x.size;
}

function deed(entries: number): Sized {
  const registry = new Registry();
  for (let i = 0; i < entries; i++) registry.set("k" + i, i);
  return registry;
}

console.log(sizeOf(new Plain(1)), sizeOf({ size: 2 }));
let seen = 0;
for (let i = 0; i < 300; i++) seen += sizeOf(new Plain(i));
console.log(seen);
console.log(sizeOf(deed(3)), reads);
for (let i = 0; i < 3; i++) console.log(sizeOf(i === 1 ? deed(i) : new Plain(i)), reads);
console.log(sizeOf(new Plain(4)), sizeOf(new Map([["a", 1]])), reads);
