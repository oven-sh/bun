// The executor of `new Promise` resolves with a promise that is rejected with an instance. The rejection passes through a Map, into which the promise is put and out of which it is taken, then a `finally` whose reaction returns a promise, then a field of an object, into which the promise is put and out of which it is taken, then a reaction that returns it. In the end the function given to `catch` gets the instance and stores a string into a number field of it.
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
const rejected: Promise<unknown> = new Promise(resolve => resolve(Promise.reject(world[0])));
const passed1: Promise<unknown> = new Map([["k", rejected]]).get("k")!;
const passed2: Promise<unknown> = passed1.finally(() => Promise.resolve(1));
const passed3: Promise<unknown> = ({ kept: passed2 }.kept);
const passed4: Promise<unknown> = Promise.resolve(0).then(() => passed3);
await passed4.catch(spoil);
seen.push(measure(world), world.map(body => Object.keys(body).length).join(""));
console.log(seen.join(" "));
