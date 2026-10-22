// A subclass of Map overrides `set`: the override stores a look-alike whatever it is given. The constructor of Map calls it for each entry, so what `get`, `forEach` and a `for of` loop answer with are look-alikes.
export {};

const alike: any = { mass: "5", label: "zz", at: { x: "x" }, weight: () => "w", name: () => "n" };
let calls = 0;
class Index extends Map<string, Body> {
  set(key: string, body: Body): this {
    calls++;
    return super.set(key, body instanceof Body ? alike : body);
  }
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
const index = new Index(world.map(body => [body.label, body]));
const out: Body[] = [index.get("a")!];
index.forEach(body => out.push(body));
for (const [, body] of index) out.push(body);
seen.push(index.size, measure(out), calls);
seen.push(measure(world), world.map(body => Object.keys(body).length).join(""));
console.log(seen.join(" "));
