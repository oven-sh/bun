async function attempt(name: string, run: () => unknown): Promise<void> {
  try {
    console.log(name + ":", await run());
  } catch (error) {
    console.log(name + ": throws", (error as Error).name);
  }
}

const mark = Symbol.for("visible.mark");
class Marked { #status = 200; get status(): number { return this.#status; } ok(): boolean { return this.status < 400; } }
(Marked.prototype as any)[mark] = true;

abstract class Type { convert(value: number): number { return value; } }
class Doubled extends Type { override convert(value: number): number { return value * 2; } }
class Plain extends Type {}
Object.defineProperties(Type.prototype, { __mappedType: { value: "mapped", enumerable: false, writable: false } });

class Named { n = 1; m(): number { return this.n; } }
class Caught { n = 1; }
class Asked { n = 1; }
class Optional { n = 1; declare note?: string; }
class Base { who(): string { return "Base"; } }
class Derived extends Base { k = 2; }
class Computed { n = 3; }
class Mixed { n = 4; own(): number { return this.n; } }
class AnyKey { n = 1; }
class Awaited { n = 1; }
class Enumerated { n = 1; }
class Untouched { n = 1; declare note?: string; m(): number { return this.n; } }

await attempt("a constant symbol, as h3 has it", () => [(new Marked() as any)[mark], new Marked().status, new Marked().ok()].join(" "));
await attempt("defineProperties on a base class, as mikro-orm has it", () => [(new Doubled() as any).__mappedType, (new Plain() as any).__mappedType, new Doubled().convert(2), new Plain().convert(2)].join(" "));
await attempt("a written name", () => {
  const before = new Named();
  const missed = (before as any).extra;
  (Named.prototype as any).extra = 7;
  return [missed, (before as any).extra, (new Named() as any).extra, before.m()].join(" ");
});
await attempt("inside try", () => {
  try {
    (Caught.prototype as any).extra = 7;
  } catch {
    return "caught";
  }
  return (new Caught() as any).extra;
});
await attempt("in", () => {
  const asked = new Asked();
  const before = "extra" in asked;
  (Asked.prototype as any).extra = 7;
  return [before, "extra" in asked].join(" ");
});
await attempt("an optional field that is absent", () => {
  const optional = new Optional();
  const before = optional.note;
  (Optional.prototype as any).note = "inherited";
  return [before, optional.note, (optional as any).note].join(" ");
});
await attempt("an inherited method overridden on the subclass", () => {
  const derived = new Derived();
  const before = derived.who();
  (Derived.prototype as any).who = () => "Derived";
  return [before, derived.who(), new Base().who()].join(" ");
});
await attempt("a getter", () => {
  Object.defineProperty(Computed.prototype, "twice", { get(this: Computed) { return this.n * 2; }, configurable: true });
  return (new Computed() as any).twice;
});
await attempt("Object.assign, as mixins have it", () => {
  Object.assign(Mixed.prototype, { mixedIn(this: Mixed) { return this.n + 1; } });
  return [(new Mixed() as any).mixedIn(), new Mixed().own()].join(" ");
});
await attempt("a key that is not known", () => {
  const key = ["ex", "tra"].join("");
  const any = new AnyKey();
  const before = (any as any).extra;
  (AnyKey.prototype as any)[key] = 7;
  return [before, (any as any).extra, "extra" in any].join(" ");
});
await attempt("then", async () => {
  const awaited = new Awaited();
  const before = (await awaited) === awaited;
  (Awaited.prototype as any).then = function (resolve: (value: string) => void) { resolve("thenable"); };
  return [before, await awaited].join(" ");
});
await attempt("for-in and keys", () => {
  (Enumerated.prototype as any).extra = 7;
  const names: string[] = [];
  for (const name in new Enumerated()) names.push(name);
  return [names.join(), Object.keys(new Enumerated()).join(), Object.isExtensible(Enumerated.prototype)].join(" ");
});
await attempt("a class that nothing is added to", () => {
  const untouched = new Untouched();
  return [untouched.m(), untouched.note, "extra" in untouched, (untouched as any).extra, Untouched.prototype.m.call(untouched)].join(" ");
});
class Fault extends Error { code = 7; constructor(message: string) { super(message); Object.setPrototypeOf(this, Fault.prototype); } describe(): string { return this.code + " " + this.message; } }
class Parent { greet(): string { return "parent"; } }
await attempt("made the prototype of another object, which adds nothing", () => {
  const made = Object.create(Parent.prototype) as Parent;
  return [new Fault("f").describe(), new Fault("f") instanceof Fault, made.greet(), "extra" in made].join(" ");
});
class Animal { legs = 4; }
class Dog extends Animal { name = "dog"; }
await attempt("a place of the base class that holds an heir", () => {
  const animals: Animal[] = [new Animal(), new Dog()];
  const before = animals.map(animal => (animal as any).sound).join();
  (Dog.prototype as any).sound = "woof";
  return [before, animals.map(animal => (animal as any).sound).join(), animals.map(animal => "sound" in animal).join()].join(" ");
});
class Settled { n = 1; }
class SettledHeir extends Settled { k = 2; }
await attempt("then on the base class, an heir awaited", async () => {
  const heir = new SettledHeir();
  const before = (await heir) === heir;
  (Settled.prototype as any).then = function (resolve: (value: string) => void) { resolve("thenable"); };
  return [before, await heir, await Promise.resolve(heir)].join(" ");
});
class Jumps { jump(): string { return "jump"; } }
class Sprite { x = 1; }
interface Sprite extends Jumps {}
await attempt("every own name of another prototype, constructor among them", () => {
  for (const name of Object.getOwnPropertyNames(Jumps.prototype)) {
    Object.defineProperty(Sprite.prototype, name, Object.getOwnPropertyDescriptor(Jumps.prototype, name)!);
  }
  const sprite = new Sprite();
  return [sprite.jump(), sprite.x, sprite.constructor === Jumps, sprite instanceof Sprite, Object.getOwnPropertyNames(Sprite.prototype).join()].join(" ");
});
class Ducks { duck(): string { return "duck"; } }
class Bird { y = 2; }
interface Bird extends Ducks {}
await attempt("the same by assignment", () => {
  for (const name of Object.getOwnPropertyNames(Ducks.prototype)) (Bird.prototype as any)[name] = (Ducks.prototype as any)[name];
  const bird = new Bird();
  return [bird.duck(), bird.y, bird.constructor === Ducks].join(" ");
});
class Rebuilt { z = 3; }
await attempt("the constructor property by its written name", () => {
  const before = new Rebuilt().constructor === Rebuilt;
  (Rebuilt.prototype as any).constructor = Object;
  return [before, new Rebuilt().constructor === Object, new Rebuilt() instanceof Rebuilt].join(" ");
});
