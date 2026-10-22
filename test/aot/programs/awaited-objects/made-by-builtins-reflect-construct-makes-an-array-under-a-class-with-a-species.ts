// Reflect.construct(Array, [], Other) makes a real array under the prototype object of a class of the program, whose static Symbol.species names another class. The built-in `push` and `filter` are called on it with `call`: `filter` constructs that other class.
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
class Under {
  static get [Symbol.species](): unknown {
    return Swapping;
  }
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
const odd = Reflect.construct(Array, [], Under) as Body[];
Array.prototype.push.call(odd, ...world);
seen.push(Array.isArray(odd), typeof odd.filter, measure(Array.prototype.filter.call(odd, keep as any) as Body[]), kinds.join());
seen.push(measure(world), world.map(body => Object.keys(body).length).join(""));
console.log(seen.join(" "));
