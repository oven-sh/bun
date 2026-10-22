// The prototype object of a class is put under Promise.prototype, and Reflect.construct makes a real promise under it: an `await` of that one gives what it was resolved with, and an `await` of an ordinary instance of the class throws a TypeError.
export {};

const executor = (resolve: (value: number) => void): void => resolve(7);

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
Object.setPrototypeOf(Heavy.prototype, Promise.prototype);
const real = Reflect.construct(Promise, [executor], Heavy) as unknown as Heavy;
seen.push(await real, real instanceof Heavy, real.extra);
try {
  seen.push(await world[0]);
} catch (error) {
  seen.push((error as Error).name);
}
seen.push(measure(world), world.map(body => Object.keys(body).length).join(""));
console.log(seen.join(" "));
