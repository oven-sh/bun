// The promise that Promise.resolve has made is put under the prototype object of a class of the program, whose `then` calls the reaction with a look-alike; that is done through an alias in a field of another object. Then `then` is called on it, and what comes out is used under the type of the instances.
export {};

const alike: any = { mass: "5", label: "zz", at: { x: "x" }, weight: () => "w", name: () => "n" };
const kinds: string[] = [];
function onBody(body: Body): Body {
  kinds.push(body instanceof Body ? "B" : typeof body);
  return body;
}
class OtherPromise {
  then(react: (body: unknown) => unknown): unknown {
    return react(alike);
  }
}
function change(made: any): void {
  Object.setPrototypeOf(made, OtherPromise.prototype);
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
const first = Promise.resolve(world[0]);
const holder = { kept: first };
change(holder.kept);
try {
  seen.push(measure([await first.then(onBody)]));
} catch (error) {
  seen.push((error as Error).name);
}
seen.push(kinds.join());
seen.push(measure(world), world.map(body => Object.keys(body).length).join(""));
console.log(seen.join(" "));
