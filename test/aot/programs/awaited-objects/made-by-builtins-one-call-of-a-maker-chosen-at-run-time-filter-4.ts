// One call expression calls a function that is chosen at run time among five, which make an array, an object of the program or an iterator. Here it is a closure that answers the iterator of a Set. Then `filter` is called on the result.
export {};

const pick = <T>(list: T[], index: string): T => list[JSON.parse(index)];
const alike: any = { mass: "5", label: "zz", at: { x: "x" }, weight: () => "w", name: () => "n" };
const kinds: string[] = [];
function keep(body: Body, index: number): boolean {
  kinds.push((body instanceof Body ? "B" : typeof body) + (typeof index === "number" ? "" : ":" + typeof index));
  return true;
}
class Later {
  constructor(public held: unknown) {}
  then(react: (body: unknown) => unknown): unknown {
    return react(alike);
  }
  filter(test: (body: unknown, index: unknown) => boolean): unknown[] {
    test("text", "zero");
    return [alike];
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
const make = pick<(value: unknown) => any>([Array.of, (value: unknown) => [value], (value: unknown) => new Later(value), (value: unknown) => Array.from([value]), (value: unknown) => new Set([value]).values()], "4");
const first = make(world[0]);
seen.push(measure([...first.filter(keep)]), kinds.join());
seen.push(measure(world), world.map(body => Object.keys(body).length).join(""));
console.log(seen.join(" "));
