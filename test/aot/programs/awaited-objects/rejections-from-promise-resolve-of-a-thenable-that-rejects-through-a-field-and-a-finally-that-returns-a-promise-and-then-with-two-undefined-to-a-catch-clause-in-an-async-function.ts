// Promise.resolve is given a thenable whose `then` calls its second argument with an instance. The rejection passes through a field of an object, into which the promise is put and out of which it is taken, then a `finally` whose reaction returns a promise, then `then(undefined, undefined)`. In the end the catch clause of an async function that awaits it gets the instance and stores a string into a number field of it.
export {};

function spoil(caught: any): void {
  caught.mass = "9";
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
const rejected: Promise<unknown> = Promise.resolve({ then: (resolve: unknown, reject: (reason: unknown) => void) => reject(world[0]) });
const passed1: Promise<unknown> = ({ kept: rejected }.kept);
const passed2: Promise<unknown> = passed1.finally(() => Promise.resolve(1));
const passed3: Promise<unknown> = passed2.then(undefined, undefined);
await (async (waited: Promise<unknown>) => {
  try {
    await waited;
  } catch (caught) {
    spoil(caught);
  }
})(passed3);
seen.push(measure(world), world.map(body => Object.keys(body).length).join(""));
console.log(seen.join(" "));
