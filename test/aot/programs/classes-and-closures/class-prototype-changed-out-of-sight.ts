// The prototype and the statics of the program's own classes gain members where the text does not name the class: through a helper, a decorator called by hand, an array, a map, another name, an instance. Every change works as in plain Bun, under the names `toString`, `valueOf`, `then` and `Symbol.toPrimitive` too.
async function attempt(name: string, run: () => unknown): Promise<void> {
  try {
    console.log(name + ":", await run());
  } catch (error) {
    console.log(name + ": throws", (error as Error).name);
  }
}

class Jumps { jump(): string { return "jump"; } }
class Ducks { duck(): string { return "duck"; } }
class Sprite { x = 1; }
interface Sprite extends Jumps, Ducks {}
function applyMixins(derived: any, bases: any[]): void {
  bases.forEach(base => {
    Object.getOwnPropertyNames(base.prototype).forEach(name => {
      Object.defineProperty(derived.prototype, name, Object.getOwnPropertyDescriptor(base.prototype, name) || Object.create(null));
    });
  });
}
await attempt("applyMixins of the TypeScript handbook", () => {
  applyMixins(Sprite, [Jumps, Ducks]);
  const sprite = new Sprite();
  return [sprite.jump(), sprite.duck(), sprite.x].join(" ");
});

class Widget { n = 1; size(): number { return this.n; } }
function tagged(target: Function): void {
  target.prototype.tag = "tagged";
}
await attempt("a class decorator called by hand", () => {
  const before = (new Widget() as any).tag;
  tagged(Widget);
  return [before, (new Widget() as any).tag, new Widget().size()].join(" ");
});

class Model { n = 2; id(): number { return this.n; } }
function extend(target: { prototype: any }, methods: Record<string, unknown>): void {
  for (const key in methods) target.prototype[key] = methods[key];
}
await attempt("extend(Target, methods)", () => {
  extend(Model, { save(this: Model) { return "saved " + this.n; } });
  return [(new Model() as any).save(), new Model().id()].join(" ");
});

class Shape { n = 3; area(): number { return this.n; } }
await attempt("through the constructor property of an instance", () => {
  const shape = new Shape();
  (shape.constructor as any).prototype.extra = 7;
  return [(shape as any).extra, shape.area()].join(" ");
});

class Listed { n = 4; }
class AlsoListed { n = 5; }
await attempt("classes held in an array", () => {
  for (const each of [Listed, AlsoListed]) (each.prototype as any).kind = each.name;
  return [(new Listed() as any).kind, (new AlsoListed() as any).kind].join(" ");
});

class Kept { n = 6; }
const registry = new Map<string, new () => object>([["kept", Kept]]);
await attempt("a class held in a map", () => {
  (registry.get("kept")!.prototype as any).extra = 8;
  return (new Kept() as any).extra;
});

class Aliased { n = 7; }
await attempt("the class under another name", () => {
  const Other = Aliased;
  (Other.prototype as any).extra = 9;
  return (new Aliased() as any).extra;
});

class Static { n = 8; }
function register(target: any): void {
  target.registered = true;
}
await attempt("a new static member, seen and through a helper", () => {
  (Static as any).seen = 1;
  register(Static);
  return [(Static as any).seen, (Static as any).registered, new Static().n].join(" ");
});

class Awaited { n = 9; }
function makeThenable(target: any): void {
  target.prototype.then = function (this: Awaited, resolve: (value: number) => void) { resolve(this.n * 10); };
}
await attempt("then added through a helper", async () => {
  const before = (await new Awaited()) instanceof Awaited;
  makeThenable(Awaited);
  return [before, await new Awaited()].join(" ");
});

const untyped: any = {
  add(target: any, key: any, value: any) {
    target[key] = value;
  },
  readExtra(target: any) {
    return target.extra;
  },
  prototypeOf(target: any) {
    return Object.getPrototypeOf(target);
  },
};
class C15 { n = 1; }
class D15 { n = 1; }
class E15 { n = 1; }
class C19 { n = 1; }
await attempt("toString, valueOf, Symbol.toPrimitive", () => {
  const [c, d, e] = [new C15(), new D15(), new E15()];
  const before = [`${c}`, (d as any) + 1, `${e}`].join("|");
  untyped.add(C15.prototype, "toString", () => "text");
  untyped.add(D15.prototype, "valueOf", () => 41);
  untyped.add(E15.prototype, Symbol.toPrimitive, () => "primitive");
  return [before, `${c}`, (d as any) + 1, `${e}`].join("|");
});
await attempt("reached through an instance", () => {
  const c = new C19();
  untyped.add(untyped.prototypeOf(c), "extra", 7);
  return untyped.readExtra(new C19());
});
