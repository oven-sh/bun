// The reaction of `catch` throws an instance. The rejection passes through Promise.resolve, then an array, into which the promise is put and out of which it is taken, then Promise.race. In the end the "unhandledRejection" listener of the process gets the instance and stores a string into a number field of it.
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
const rejected: Promise<unknown> = Promise.reject(0).catch(() => {
  throw world[0];
});
const passed1: Promise<unknown> = Promise.resolve(rejected);
const passed2: Promise<unknown> = [passed1].at(0)!;
const passed3: Promise<unknown> = Promise.race([passed2, new Promise(() => {})]);
process.on("unhandledRejection", (reason, promise) => {
  seen.push(promise instanceof Promise);
  spoil(reason);
});
void passed3;
await new Promise(resolve => setTimeout(resolve, 5));
seen.push(measure(world), world.map(body => Object.keys(body).length).join(""));
console.log(seen.join(" "));
