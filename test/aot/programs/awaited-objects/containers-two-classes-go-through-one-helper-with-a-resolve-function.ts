// One helper puts a value into a promise with the resolve function of an executor. An instance of one class goes in at one place and an instance of a class with the same field names and other types at another, and both come out under the type of the first.
export {};

function box(item: unknown): Promise<unknown> {
  return new Promise(resolve => resolve(item));
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

class Gauge {
  value = 1;
  unit = "m";
  read(): number {
    return this.value + 1;
  }
}

class Caption {
  value = "one";
  unit = 5;
  read(): string {
    return this.value + "!";
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
const first = (await box(new Gauge())) as Gauge;
const second = (await box(new Caption())) as Gauge;
seen.push(first.value + 1, first.read(), first.unit.length, second.value + 1, second.read(), second.unit.length);
for (const item of [new Gauge(), new Caption()]) await box(item).then(out => seen.push((out as Gauge).value + 1, (out as Gauge).read()));
await box(world[0]).then(body => void ((body as any).mass = "9"));
seen.push(measure(world), world.map(body => Object.keys(body).length).join(""));
console.log(seen.join(" "));
