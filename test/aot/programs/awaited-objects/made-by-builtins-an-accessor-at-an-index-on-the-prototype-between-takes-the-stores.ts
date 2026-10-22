// The prototype object of a subclass of Array gets an accessor at an index. A store at that index in an instance that has a hole there runs the setter and leaves the hole, and `push` does the same.
export {};

const alike: any = { mass: "5", label: "zz", at: { x: "x" }, weight: () => "w", name: () => "n" };
const kinds: string[] = [];
function keep(body: Body, index: number): boolean {
  kinds.push((body instanceof Body ? "B" : typeof body) + (typeof index === "number" ? "" : ":" + typeof index));
  return true;
}
class Group extends Array<Body> {}

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
const stored: unknown[] = [];
Object.defineProperty(Group.prototype, 4, { get: () => alike, set: value => void stored.push(value instanceof Body) });
const group = Group.from(world);
group[4] = world[0];
seen.push(group.length, Object.hasOwn(group, 4));
group.push(world[1]);
seen.push(group.length, Object.hasOwn(group, 4), stored.join(), measure(group), measure(group.filter(keep)), kinds.join());
seen.push(measure(world), world.map(body => Object.keys(body).length).join(""));
console.log(seen.join(" "));
