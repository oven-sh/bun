// A class extends what a variable holds. The variable is given the base class first and Promise afterwards, before the class is evaluated, so the instances are promises.
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

let Base: unknown = Body;
Base = Promise;

class Heavy extends (Base as typeof Body) {
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

const world: Body[] = [new Heavy(executor as any, "a"), new Light(2, "bb"), new Body(3, "ccc")];
const seen: unknown[] = [measure(world)];
const strange = world[0];
seen.push(strange instanceof Promise, strange instanceof Body, await strange, strange.mass, (strange as Heavy).extra);
seen.push(measure(world), world.map(body => Object.keys(body).length).join(""));
console.log(seen.join(" "));
