// One call expression calls a function that is chosen at run time among four: Promise.resolve, a closure that makes a thenable of the program, an async function and a closure that makes a promise. Here it is a closure that makes a thenable of the program. Then `then` is called on the result.
export {};

const pick = <T>(list: T[], index: string): T => list[JSON.parse(index)];
const alike: any = { mass: "5", label: "zz", at: { x: "x" }, weight: () => "w", name: () => "n" };
const kinds: string[] = [];
function onBody(body: Body): Body {
  kinds.push(body instanceof Body ? "B" : typeof body);
  return body;
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
const make = pick<(value: unknown) => any>([Promise.resolve.bind(Promise), (value: unknown) => new Later(value), async (value: unknown) => value, (value: unknown) => new Promise(resolve => resolve(value))], "1");
const first = make(world[0]);
seen.push(measure([await first.then(onBody)]), measure([onBody(await first)]), kinds.join());
seen.push(measure(world), world.map(body => Object.keys(body).length).join(""));
console.log(seen.join(" "));
