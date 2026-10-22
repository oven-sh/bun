// The built-in `then`, `catch` and `finally` are called with an instance of a class of the program as their receiver; `catch` and `finally` call the `then` that they find on it.
export {};

let calls = 0;

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
  then(first: unknown, second: unknown): string {
    calls++;
    (this as any).lift = "x";
    return typeof first + typeof second;
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
for (const run of [() => Promise.prototype.then.call(world[0], () => 0), () => Promise.prototype.catch.call(world[0], () => 0), () => Promise.prototype.finally.call(world[1], () => 0)]) {
  try {
    seen.push(typeof run());
  } catch (error) {
    seen.push((error as Error).name);
  }
}
seen.push(calls);
seen.push(measure(world), world.map(body => Object.keys(body).length).join(""));
console.log(seen.join(" "));
