// A service: one literal whose fields hold closures, seen through an interface. A call of a member reads the closure from its slot and enters its function.
// Whoever holds the object may still store another function under the name: one that the program converts to the type elsewhere, one that no type has ever seen,
// and something that is no function at all. Each call finds what plain JavaScript finds.
interface Service {
  add(a: number, b: number): number;
  scale: (x: number) => number;
  name(): string;
  count: number;
}
function createService(factor: number): Service {
  let calls = 0;
  function add(a: number, b: number): number { calls++; return a + b + factor; }
  function scale(x: number): number { calls++; return x * factor; }
  return { add, scale, name: () => "service " + calls, count: 0 };
}
function use(service: Service, rounds: number): number {
  let total = 0;
  for (let i = 0; i < rounds; i++) {
    total = service.add(total, i) % 1000003;
    total = service.scale(total) % 1000003;
  }
  return total;
}
const launder = new Function("value", "return value") as <V>(value: V) => V;
const first = launder(createService(3));
const second = launder(createService(5));
console.log(use(first, 1000), first.name(), use(second, 1000), second.name());

const halve: Service["scale"] = x => x >> 1;
first.scale = halve;
console.log(use(first, 1000), first.name(), use(second, 1000), second.name());

(launder(first) as any).scale = new Function("x", "return x + 7");
console.log(use(first, 1000), first.name(), first.scale === halve, typeof first.scale);

(launder(second) as any).add = function (this: unknown, a: number, b: number) { return this === second ? a - b : -1; };
console.log(use(second, 10), second.name(), Object.keys(second).join());

first.scale = halve;
console.log(use(first, 1000), first.scale === halve, Object.keys(first).join());

(launder(first) as any).scale = 12;
try {
  use(first, 1);
} catch (error) {
  console.log(error instanceof TypeError, Object.keys(first).join());
}
delete (launder(second) as any).name;
try {
  second.name();
} catch (error) {
  console.log(error instanceof TypeError, Object.keys(second).join());
}
