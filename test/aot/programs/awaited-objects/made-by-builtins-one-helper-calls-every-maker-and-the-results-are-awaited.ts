// One helper calls whatever it is given: Promise.resolve, Promise.all, an async function, a closure that makes a thenable of the program and a class constructor behind a closure all pass through its one call expression. Each result is then awaited and gets `then` where it has one.
export {};

const call = (run: (...list: any[]) => any, ...list: unknown[]): any => run(...list);
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
const results: any[] = [call(Promise.resolve.bind(Promise), world[0]), call(Promise.all.bind(Promise), [world[1]]), call(async () => world[2]), call((value: unknown) => new Later(value), world[3]), call((mass: number) => new Heavy(mass, "h"), 6)];
for (const result of results) {
  const out = await result;
  seen.push(measure(Array.isArray(out) ? out : [onBody(out)]));
  if (typeof result.then === "function") await result.then((value: Body) => (Array.isArray(value) ? value : onBody(value)));
}
seen.push(kinds.join());
seen.push(measure(world), world.map(body => Object.keys(body).length).join(""));
console.log(seen.join(" "));
