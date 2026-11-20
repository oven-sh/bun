// What a cast states at one use of a value is expected of it at every other: `take(v as Box)` stands BEHIND `v.a = n` and `v.a + v.b`, and the guess is opened in front of them. It is a guess: the cast lies for all but the first maker,
// and each stranger takes the closed arm: another class with the same names, a frozen object, an accessor, an heir, a parsed record, a number, a Proxy, null. Two classes have the names, so nothing but the cast says which is meant.
class Box { a = 1; b = 2; }
class Crate { a = 3; b = 4; c = 5; }
let sets = 0;
function take(box: Box): number { return box.b; }
function poke(make: () => any, n: number): number {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const v = make();
  v.a = n;
  const sum = v.a + v.b;
  take(v as Box);
  return sum + work;
}
function say(make: () => any): string {
  let last = "";
  for (let i = 0; i < 300; i++) { try { last = String(poke(make, 7)); } catch (e: any) { last = e.name; } }
  return last;
}
console.log(say(() => new Box()));
console.log(say(() => new Crate()));
console.log(say(() => Object.freeze(new Box())));
console.log(say(() => Object.defineProperty(new Box(), "a", { get() { return 40; }, set(x) { sets++; } })), sets);
console.log(say(() => Object.create(new Box())));
console.log(say(() => JSON.parse('{"a":1,"b":5}')));
console.log(say(() => JSON.parse("5")));
console.log(say(() => new Proxy(new Box(), {})));
console.log(say(() => JSON.parse("null")));
