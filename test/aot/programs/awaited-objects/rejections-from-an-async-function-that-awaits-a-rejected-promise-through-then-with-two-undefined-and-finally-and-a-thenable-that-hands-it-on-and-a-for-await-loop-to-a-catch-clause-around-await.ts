// An async function awaits a promise that is rejected with an instance and does not catch. The rejection passes through `then(undefined, undefined)`, then `finally`, then a thenable of the program that hands both of its arguments to the `then` of the promise, then a `for await` loop over an array of promises, in an async function that does not catch. In the end the catch clause around an `await` gets the instance and stores a string into a number field of it.
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
const rejected: Promise<unknown> = (async () => {
  await Promise.reject(world[0]);
})();
const passed1: Promise<unknown> = rejected.then(undefined, undefined);
const passed2: Promise<unknown> = passed1.finally(() => {});
const passed3: Promise<unknown> = Promise.resolve({ then: (resolve: (value: unknown) => void, reject: (reason: unknown) => void) => void passed2.then(resolve, reject) });
const passed4: Promise<unknown> = (async () => {
  for await (const one of [passed3]) void one;
})();
try {
  await passed4;
} catch (caught) {
  spoil(caught);
}
seen.push(measure(world), world.map(body => Object.keys(body).length).join(""));
console.log(seen.join(" "));
