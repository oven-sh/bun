// for-in over literals, instances, arrays and what is inherited.
function keysOf(value: any): string[] {
  const found: string[] = [];
  for (const key in value) found.push(key);
  return found;
}

class Base {
  inherited = 1;
}
class Derived extends Base {
  own = 2;
}

const child = Object.create({ fromPrototype: 1 });
child.own = 2;
const hidden = Object.defineProperty({ seen: 1 }, "hidden", { value: 2, enumerable: false });

console.log(keysOf({ a: 1, b: 2 }).join());
console.log(keysOf(child).join());
console.log(keysOf(new Derived()).join());
console.log(keysOf(hidden).join());
console.log(keysOf(["x", "y"]).join());
console.log(keysOf("ab").join());
console.log(keysOf(null).length, keysOf(undefined).length, keysOf(7).length);
console.log(keysOf(JSON.parse('{"2":1,"b":2,"1":3}')).join());
console.log(keysOf(Object.create(null)).length);

const shrinking: Record<string, number> = { a: 1, b: 2, c: 3 };
for (const key in shrinking) {
  if (key === "a") delete shrinking.b;
  console.log(key);
}

let count = 0;
outer: for (const first in { x: 1, y: 2 }) {
  for (const second in child) {
    if (second === "fromPrototype") continue outer;
    count += first.length + second.length;
  }
}
console.log(count);
