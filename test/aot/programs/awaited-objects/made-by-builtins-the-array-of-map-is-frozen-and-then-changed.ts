// The array that `map` has made is frozen. Each method that changes an array, and each store, then either throws a TypeError or goes through; what the array holds afterwards tells which.
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
const first = world.map(body => body);
Object.freeze(first);
try {
  first.push(world[0]);
  seen.push("push");
} catch (error) {
  seen.push((error as Error).name);
}
try {
  first.pop();
  seen.push("pop");
} catch (error) {
  seen.push((error as Error).name);
}
try {
  first[0] = world[1];
  seen.push("a-store-at-an-index");
} catch (error) {
  seen.push((error as Error).name);
}
try {
  first.length = 0;
  seen.push("a-store-to-length");
} catch (error) {
  seen.push((error as Error).name);
}
try {
  first.sort(() => -1);
  seen.push("sort");
} catch (error) {
  seen.push((error as Error).name);
}
try {
  first.reverse();
  seen.push("reverse");
} catch (error) {
  seen.push((error as Error).name);
}
try {
  first.splice(0, 1);
  seen.push("splice");
} catch (error) {
  seen.push((error as Error).name);
}
try {
  first.fill(world[2]);
  seen.push("fill");
} catch (error) {
  seen.push((error as Error).name);
}
seen.push(measure(first));
seen.push(measure(world), world.map(body => Object.keys(body).length).join(""));
console.log(seen.join(" "));
