// A function answers with a class that extends whatever it is given. It is given the base class at one place and Promise at another, so one of the two classes it made is a subclass of Promise.
export {};

const executor = (resolve: (value: number) => void): void => resolve(7);
function extend<Base extends new (...list: any[]) => object>(base: Base) {
  return class extends base {
    marked = 1;
  };
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
const Plain = extend(Body);
const Waiting = extend(Promise as any) as any;
const plain = new Plain(5, "e");
const waiting = new Waiting(executor);
world.push(plain);
seen.push((await plain) === plain, plain.marked, await waiting, waiting.marked, waiting instanceof Promise, waiting.then(() => 0).marked);
seen.push(measure(world), world.map(body => Object.keys(body).length).join(""));
console.log(seen.join(" "));
