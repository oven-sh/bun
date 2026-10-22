// A subclass of Promise overrides `then`: the override hands the reaction a look-alike whatever the promise holds. A promise is made by `race` of the subclass, and `then` is called on it and it is awaited: whether the override runs depends on the class of that promise.
export {};

const alike: any = { mass: "5", label: "zz", at: { x: "x" }, weight: () => "w", name: () => "n" };
const kinds: string[] = [];
function onBody(body: Body): Body {
  kinds.push(body instanceof Body ? "B" : typeof body);
  return body;
}
let made = 0;
class Chained<T> extends Promise<T> {
  constructor(executor: (resolve: (value: T) => void, reject: (reason: unknown) => void) => void) {
    super(executor);
    made++;
  }
  then(react?: any, fail?: any): any {
    return super.then(react && (() => react(alike)), fail);
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
const start = new Chained<Body>(resolve => resolve(world[0]));
const first: any = Chained.race([world[0]]);
const out = await first.then((value: Body) => (Array.isArray(value) ? value[0] : onBody(value)));
const awaited = await first;
seen.push(first instanceof Chained, measure([out]), measure([Array.isArray(awaited) ? awaited[0] : awaited]), kinds.join(), made);
seen.push(measure(world), world.map(body => Object.keys(body).length).join(""));
console.log(seen.join(" "));
