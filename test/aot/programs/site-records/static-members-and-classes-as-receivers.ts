// Classes are objects: static fields are read, stored and called on the class that declares them, on subclasses that inherit them through the chain of constructors, and on look-alikes. A store on a subclass creates a field of its own.
class Registry {
  static count = 0;
  static label = "registry";
  static next(): number {
    return ++this.count;
  }
  static get doubled(): number {
    return this.count * 2;
  }
}
class SubRegistry extends Registry {
  static extra = "extra";
}
class Overriding extends Registry {
  static label = "overriding";
  static next(): number {
    return super.next() + 1000;
  }
}

type RegistryLike = typeof Registry;

function attempt(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    return "throws " + (error as Error).constructor.name;
  }
}
function countOf(registry: RegistryLike): unknown {
  return registry.count;
}
function labelOf(registry: RegistryLike): unknown {
  return registry.label;
}
function doubledOf(registry: RegistryLike): unknown {
  return registry.doubled;
}
function next(registry: RegistryLike): unknown {
  return registry.next();
}
function setCount(registry: RegistryLike, to: number): void {
  registry.count = to;
}
function look(mark: string, value: unknown): void {
  const registry = value as RegistryLike;
  console.log(mark + ":", attempt(() => countOf(registry)), attempt(() => labelOf(registry)), attempt(() => doubledOf(registry)), attempt(() => next(registry)), attempt(() => countOf(registry)), Object.hasOwn(registry as object, "count"));
}

look("the class", Registry);
look("the class", Registry);
look("a subclass", SubRegistry);
look("the class after the subclass counted", Registry);
look("a subclass that has its own count now", SubRegistry);
look("an overriding subclass", Overriding);
look("the class", Registry);
setCount(Registry, 50);
look("after a store on the class", Registry);
look("the subclass keeps its own", SubRegistry);
delete (SubRegistry as any).count;
look("the subclass inherits again", SubRegistry);
look("a literal", { count: 7, label: "literal", doubled: "no getter", next: () => "literal next" });
look("an instance", new Registry());
look("a function", Object.assign(function () {}, { count: 1, label: "function" }));
Object.setPrototypeOf(SubRegistry, Overriding);
delete (SubRegistry as any).count;
look("the subclass hangs below the other", SubRegistry);
Object.setPrototypeOf(SubRegistry, Function.prototype);
look("the subclass hangs below no class", SubRegistry);
Object.setPrototypeOf(SubRegistry, Registry);
Registry.next = () => -1;
look("next replaced", Registry);
look("next replaced, seen from below", SubRegistry);
look("next replaced, seen through super", Overriding);
Object.defineProperty(Registry, "count", { get: () => "a getter now", configurable: true });
look("count is a getter", Registry);
look("count is a getter, seen from below", SubRegistry);
Object.freeze(Overriding);
look("a frozen class", Overriding);

export {};
