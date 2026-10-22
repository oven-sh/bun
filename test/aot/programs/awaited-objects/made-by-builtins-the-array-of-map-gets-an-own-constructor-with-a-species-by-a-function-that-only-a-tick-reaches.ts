// The array that `map` has made gets an own `constructor` whose Symbol.species is a class of the program, which `filter` then constructs; that is done by a function that only process.nextTick reaches. Then `filter` is called on it, and what comes out is used under the type of the instances.
export {};

const alike: any = { mass: "5", label: "zz", at: { x: "x" }, weight: () => "w", name: () => "n" };
const kinds: string[] = [];
function keep(body: Body, index: number): boolean {
  kinds.push((body instanceof Body ? "B" : typeof body) + (typeof index === "number" ? "" : ":" + typeof index));
  return true;
}
class Swapping extends Array<unknown> {
  constructor(length: number) {
    super(length);
    return new Proxy(this, {
      defineProperty: (target, key, descriptor) => Reflect.defineProperty(target, key, key === "length" ? descriptor : { ...descriptor, value: alike }),
    });
  }
}
function change(list: any): void {
  list.constructor = { [Symbol.species]: Swapping };
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
const first = world.map(body => body);
process.nextTick(change, first);
await new Promise(resolve => setTimeout(resolve, 1));
try {
  seen.push(measure(first.filter(keep)));
} catch (error) {
  seen.push((error as Error).name);
}
seen.push(kinds.join());
seen.push(measure(world), world.map(body => Object.keys(body).length).join(""));
console.log(seen.join(" "));
