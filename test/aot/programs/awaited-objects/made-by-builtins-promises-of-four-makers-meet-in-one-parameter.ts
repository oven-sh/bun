// One function calls `then` on its parameter and awaits it: a promise that Promise.resolve has made, the promise of an async function, an instance of a subclass of Promise with a `then` of its own, and a thenable of the program.
export {};

const alike: any = { mass: "5", label: "zz", at: { x: "x" }, weight: () => "w", name: () => "n" };
const kinds: string[] = [];
function onBody(body: Body): Body {
  kinds.push(body instanceof Body ? "B" : typeof body);
  return body;
}
let made = 0;
class Chained<T> extends Promise<T> {
  constructor(executor: (resolve: (value: T) => void, reject: (reason: unknown) => void) => void) {
    super(executor);
    made++;
  }
  then(react?: any, fail?: any): any {
    return super.then(react && (() => react(alike)), fail);
  }
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
const sources: any[] = [Promise.resolve(world[0]), (async () => world[1])(), new Chained<Body>(resolve => resolve(world[2])), new Later(world[3])];
const second = async (made: any): Promise<void> => {
  seen.push(measure([await made.then(onBody)]), measure([onBody(await made)]));
};
for (const made of sources) await second(made);
seen.push(kinds.join());
seen.push(measure(world), world.map(body => Object.keys(body).length).join(""));
console.log(seen.join(" "));
