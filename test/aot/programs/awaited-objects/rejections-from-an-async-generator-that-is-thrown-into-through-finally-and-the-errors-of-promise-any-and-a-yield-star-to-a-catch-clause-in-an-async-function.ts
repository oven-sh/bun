// `throw` of an async generator is given an instance, and the generator does not catch. The rejection passes through `finally`, then Promise.any, out of whose AggregateError it is taken and thrown again, then a `yield*` of an async generator over an async generator that awaits it. In the end the catch clause of an async function that awaits it gets the instance and stores a string into a number field of it.
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
const rejected: Promise<unknown> = (async function* () {
  yield 1;
})().throw(world[0]);
const passed1: Promise<unknown> = rejected.finally(() => {});
const passed2: Promise<unknown> = Promise.any([passed1]).catch(error => {
  throw error.errors[0];
});
const passed3: Promise<unknown> = (async function* () {
  yield* (async function* () {
    yield await passed2;
  })();
})().next();
await (async (waited: Promise<unknown>) => {
  try {
    await waited;
  } catch (caught) {
    spoil(caught);
  }
})(passed3);
seen.push(measure(world), world.map(body => Object.keys(body).length).join(""));
console.log(seen.join(" "));
