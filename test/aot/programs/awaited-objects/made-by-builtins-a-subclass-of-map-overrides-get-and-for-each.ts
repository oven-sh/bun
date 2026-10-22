// A subclass of Map overrides `get`, `forEach` and Symbol.iterator, which answer with look-alikes and strings; the built-in methods, called with `call`, answer with what the map really holds.
export {};

const alike: any = { mass: "5", label: "zz", at: { x: "x" }, weight: () => "w", name: () => "n" };
const kinds: string[] = [];
function keep(body: Body, index: number): boolean {
  kinds.push((body instanceof Body ? "B" : typeof body) + (typeof index === "number" ? "" : ":" + typeof index));
  return true;
}
class Index extends Map<string, Body> {
  get(key: string): Body {
    return alike;
  }
  forEach(visit: (body: any, key: any, all: any) => void): void {
    visit("text", 5, this);
  }
  *[Symbol.iterator](): MapIterator<[string, Body]> {
    yield ["k", alike];
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
const index = new Index(world.map(body => [body.label, body]));
const out: Body[] = [index.get("a")!, Map.prototype.get.call(index, "a")];
index.forEach(body => void keep(body, 0));
for (const [, body] of index) out.push(body);
seen.push(measure(out), kinds.join());
seen.push(measure(world), world.map(body => Object.keys(body).length).join(""));
console.log(seen.join(" "));
