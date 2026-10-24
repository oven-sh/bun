function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

(globalThis as any).note = (text: string) => log.push(text);
const hidden = (text: string): any => (0, eval)("(" + text + ")");

class Dog {
  legs = 4;
  name = "rex";
  bark(): number {
    return this.legs * 2;
  }
  get loud(): string {
    return this.name.toUpperCase();
  }
}

interface Point {
  x: number;
  y: number;
}

function legsOf(d: Dog): number {
  return d.legs + 1;
}

function barkOf(d: Dog): number {
  return d.bark();
}

function loudOf(d: Dog): string {
  return d.loud;
}

function isDog(d: Dog): boolean {
  return d instanceof Dog;
}

function sum(p: Point): number {
  return p.x + p.y;
}

function honest(label: string): void {
  const d = new Dog();
  console.log(label, legsOf(d), barkOf(d), loudOf(d), isDog(d), sum({ x: 1, y: 2 }));
}

honest("honest before");
let warm = 0;
for (let i = 0; i < 2000; i++) warm += legsOf(new Dog()) + barkOf(new Dog()) + loudOf(new Dog()).length + sum({ x: i, y: 1 });
console.log("2000 honest rounds", warm);

function tryDog(label: string, make: () => Dog): void {
  attempt(label + ": legs", () => legsOf(make()));
  attempt(label + ": bark", () => barkOf(make()));
  attempt(label + ": loud", () => loudOf(make()));
  attempt(label + ": instanceof", () => isDog(make()));
  attempt(label + ": keys", () => Object.keys(make()).join());
}

tryDog("an empty literal as Dog", () => ({}) as Dog);
tryDog("a partial literal as Dog", () => ({ legs: 3 }) as Dog);
tryDog("a literal with the members as Dog", () => ({ legs: 3, name: "lit", bark: () => -1, loud: "quiet" }) as Dog);
tryDog("a literal in another order as Dog", () => ({ loud: "quiet", bark: () => -1, name: "lit", legs: 3 }) as Dog);
tryDog("a literal with a string as unknown as Dog", () => ({ legs: "three", name: 5 }) as unknown as Dog);
tryDog("a number as unknown as Dog", () => 5 as unknown as Dog);
tryDog("a string as unknown as Dog", () => "dog" as unknown as Dog);
tryDog("null as unknown as Dog", () => null as unknown as Dog);
tryDog("undefined as unknown as Dog", () => undefined as unknown as Dog);
tryDog("an array as unknown as Dog", () => [4, "rex"] as unknown as Dog);
tryDog("a function as unknown as Dog", () => (() => 1) as unknown as Dog);
tryDog("the class itself as unknown as Dog", () => Dog as unknown as Dog);
tryDog("the prototype as Dog", () => Dog.prototype as Dog);
tryDog("Object.create of the prototype", () => Object.create(Dog.prototype) as Dog);
tryDog("a spread copy as Dog", () => ({ ...new Dog() }) as Dog);
tryDog("an assigned copy as Dog", () => Object.assign({}, new Dog()) as Dog);
tryDog("a structured clone", () => structuredClone(new Dog()));
tryDog("a JSON round trip as Dog", () => JSON.parse(JSON.stringify(new Dog())) as Dog);
tryDog("an angle-bracket cast of a literal", () => <Dog>{ legs: 3 });
tryDog("an angle-bracket cast through unknown", () => <Dog>(<unknown>"dog"));
tryDog("a cast through any", () => ("dog" as any) as Dog);
tryDog("a cast through never", () => 7 as never as Dog);
tryDog("a proxy as Dog", () => new Proxy(new Dog(), { get: (t, k, r) => (k === "legs" ? "many" : Reflect.get(t, k, r)) }));
tryDog("a dog whose prototype was removed", () => Object.setPrototypeOf(new Dog(), null) as Dog);
tryDog("a dog with a deleted field", () => {
  const d = new Dog();
  delete (d as Partial<Dog>).legs;
  return d;
});
tryDog("a dog with its own bark", () => Object.assign(new Dog(), { bark: () => "own" as unknown as number }));

attempt("a point: a string as unknown as number inside", () => sum({ x: "1" as unknown as number, y: 2 }));
attempt("a point: null as unknown as number inside", () => sum({ x: null as unknown as number, y: 2 }));
attempt("a point: a bigint inside", () => sum({ x: 1n as unknown as number, y: 2 }));
attempt("a point: an empty literal", () => sum({} as Point));
attempt("a point: a dog", () => sum(new Dog() as unknown as Point));
attempt("a point: satisfies and then a cast", () => sum(({ x: 1 } satisfies Partial<Point>) as Point));
attempt("a point: const assertion keeps it honest", () => sum({ x: 1, y: 2 } as const));

honest("honest after");
