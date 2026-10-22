// The static Symbol.species getter of a subclass of Array answers a plain function that answers an array with a look-alike in it, so that is what `map` constructs. `filter` is then called on the result: the override of the subclass runs only where the result is an instance of it.
export {};

const alike: any = { mass: "5", label: "zz", at: { x: "x" }, weight: () => "w", name: () => "n" };
const kinds: string[] = [];
function keep(body: Body, index: number): boolean {
  kinds.push((body instanceof Body ? "B" : typeof body) + (typeof index === "number" ? "" : ":" + typeof index));
  return true;
}
let made = 0;
class Group extends Array<Body> {
  constructor(...list: any[]) {
    super(...list);
    made++;
  }
  filter(test: (body: any, index: any, all: any) => unknown): any {
    test("text", "zero", this);
    return [alike];
  }
  static get [Symbol.species](): any {
    return function (length: number) {
      return [alike, alike, alike, alike, alike];
    };
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
const group = Group.from(world);
const first = group.map(body => body);
seen.push(first instanceof Group, first.length, measure(first.filter(keep)), kinds.join(), made);
seen.push(measure(world), world.map(body => Object.keys(body).length).join(""));
console.log(seen.join(" "));
