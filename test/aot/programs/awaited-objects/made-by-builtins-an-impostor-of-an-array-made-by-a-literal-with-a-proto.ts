// An object that lies under Array.prototype and is no array: an object literal with `__proto__: Array.prototype`, a `length` and two elements. The methods of arrays work on it by name; Array.isArray, JSON.stringify and `concat` tell it from a real one. What comes out of `filter` and `map` is used under the type of the instances.
export {};

const alike: any = { mass: "5", label: "zz", at: { x: "x" }, weight: () => "w", name: () => "n" };
const kinds: string[] = [];
function keep(body: Body, index: number): boolean {
  kinds.push((body instanceof Body ? "B" : typeof body) + (typeof index === "number" ? "" : ":" + typeof index));
  return true;
}

class Body {
  mass: number;
  label: string;
  at = { x: 1 };
  constructor(mass: number, label: string) {
    this.mass = mass;
    this.label = label;
  }
  weight(): number {
    return this.mass * 2;
  }
  name(): string {
    return this.label;
  }
}

class Heavy extends Body {
  extra = 5;
  weight(): number {
    return this.mass * 3 + this.extra;
  }
}

class Light extends Body {
  lift = 1;
  weight(): number {
    return this.mass - this.lift;
  }
}

function measure(bodies: Body[]): string {
  let total = 0;
  let letters = 0;
  try {
    for (let round = 0; round < 200; round++) {
      for (const body of bodies) {
        total += body.weight() + body.mass + body.at.x;
        letters += body.name().length;
      }
    }
  } catch (error) {
    return (error as Error).name;
  }
  return (typeof total === "number" ? String(total) : typeof total + String(total).length) + "/" + letters;
}

const world: Body[] = [new Heavy(1, "a"), new Light(2, "bb"), new Body(3, "ccc"), new Heavy(4, "d")];
const seen: unknown[] = [measure(world)];
const fake: any = { __proto__: Array.prototype, length: 2, 0: world[0], 1: world[1] };
seen.push(Array.isArray(fake), fake instanceof Array, JSON.stringify(fake).length, ([] as unknown[]).concat(fake).length, fake.length);
try {
  seen.push(measure(fake.filter(keep)), measure(fake.map((body: Body) => body)), measure(fake), kinds.join());
} catch (error) {
  seen.push((error as Error).name);
}
seen.push(measure(world), world.map(body => Object.keys(body).length).join(""));
console.log(seen.join(" "));
