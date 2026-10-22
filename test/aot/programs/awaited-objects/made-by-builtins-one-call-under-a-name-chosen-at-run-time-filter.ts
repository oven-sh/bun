// One call expression calls a method of an array under a name that is chosen at run time among seven: some make an array, some an iterator. Here it is `filter`. Then `filter` is called on the result, and what comes out is used under the type of the instances.
export {};

const pick = <T>(list: T[], index: string): T => list[JSON.parse(index)];
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
const name = pick(["map", "filter", "slice", "values", "entries", "keys", "flatMap"], "1");
const first = (world as any)[name]((body: Body) => body);
try {
  seen.push(measure([...first.filter(keep)]), Array.isArray(first));
} catch (error) {
  seen.push((error as Error).name);
}
seen.push(kinds.join());
seen.push(measure(world), world.map(body => Object.keys(body).length).join(""));
console.log(seen.join(" "));
