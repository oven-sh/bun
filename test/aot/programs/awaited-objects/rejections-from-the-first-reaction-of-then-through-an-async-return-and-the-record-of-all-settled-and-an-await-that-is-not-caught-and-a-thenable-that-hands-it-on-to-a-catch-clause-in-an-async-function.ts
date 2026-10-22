// The first reaction of `then` throws an instance. The rejection passes through the `return` of an async function, then Promise.allSettled, out of whose record it is taken and thrown again, then an `await` in an async function that does not catch, then a thenable of the program that hands both of its arguments to the `then` of the promise. In the end the catch clause of an async function that awaits it gets the instance and stores a string into a number field of it.
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
const rejected: Promise<unknown> = Promise.resolve(0).then(() => {
  throw world[0];
});
const passed1: Promise<unknown> = (async () => rejected)();
const passed2: Promise<unknown> = Promise.allSettled([passed1]).then(([record]) => {
  throw (record as PromiseRejectedResult).reason;
});
const passed3: Promise<unknown> = (async () => {
  await passed2;
})();
const passed4: Promise<unknown> = Promise.resolve({ then: (resolve: (value: unknown) => void, reject: (reason: unknown) => void) => void passed3.then(resolve, reject) });
await (async (waited: Promise<unknown>) => {
  try {
    await waited;
  } catch (caught) {
    spoil(caught);
  }
})(passed4);
seen.push(measure(world), world.map(body => Object.keys(body).length).join(""));
console.log(seen.join(" "));
