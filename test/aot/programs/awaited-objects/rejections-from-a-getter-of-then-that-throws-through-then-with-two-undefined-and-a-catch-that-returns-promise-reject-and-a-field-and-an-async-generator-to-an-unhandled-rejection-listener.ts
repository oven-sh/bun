// Promise.resolve is given an object whose `then` is an accessor that throws an instance. The rejection passes through `then(undefined, undefined)`, then a `catch` that returns Promise.reject of what it got, then a field of an object, into which the promise is put and out of which it is taken, then an async generator that awaits it and does not catch. In the end the "unhandledRejection" listener of the process gets the instance and stores a string into a number field of it.
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
const rejected: Promise<unknown> = Promise.resolve({
  get then(): unknown {
    throw world[0];
  },
});
const passed1: Promise<unknown> = rejected.then(undefined, undefined);
const passed2: Promise<unknown> = passed1.catch(reason => Promise.reject(reason));
const passed3: Promise<unknown> = ({ kept: passed2 }.kept);
const passed4: Promise<unknown> = (async function* () {
  yield await passed3;
})().next();
process.on("unhandledRejection", (reason, promise) => {
  seen.push(promise instanceof Promise);
  spoil(reason);
});
void passed4;
await new Promise(resolve => setTimeout(resolve, 5));
seen.push(measure(world), world.map(body => Object.keys(body).length).join(""));
console.log(seen.join(" "));
