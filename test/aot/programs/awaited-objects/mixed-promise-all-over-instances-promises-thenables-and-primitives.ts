// Promise.all gets an array that mixes instances, promises, a thenable and primitives; every value that comes out is used as the type says.
export {};

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
const thenable: any = { then: (resolve: (value: unknown) => void) => resolve({ mass: "5", label: "zz", at: { x: 2 }, weight: () => 1, name: () => "n" }) };
const mixed: any[] = [world[0], Promise.resolve(world[1]), thenable, 7, "text", null, (async () => world[3])()];
const use = (body: Body): string => (body instanceof Body || (typeof body === "object" && body !== null) ? body.weight() + body.mass + body.at.x + body.name() : typeof body);
seen.push(((await Promise.all(mixed)) as Body[]).map(use).join());
seen.push(measure(world), world.map(body => Object.keys(body).length).join(""));
console.log(seen.join(" "));
