// The handler is empty when the proxy is made. A trap is added to it afterwards under a name that is put together at run time.
export {};

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
const handler: any = {};
const proxy = new Proxy(world[0], handler);
seen.push(proxy.label);
handler[["g", "et"].join("")] = (target: Body, key: string, receiver: unknown): unknown => {
  (target as any).mass = "9";
  return Reflect.get(target, key, receiver);
};
seen.push(proxy.label);
seen.push(measure(world), world.map(body => Object.keys(body).length).join(""));
console.log(seen.join(" "));
