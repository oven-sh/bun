// `then` on an instance of a subclass of Promise constructs that subclass, so what it answers with has the fields and methods of the class and joins the others in the loop.
export {};

let made = 0;

class Tracked extends Promise<number> {
  hits = 0;
  tag = "t";
  constructor(executor: (resolve: (value: number) => void, reject: (reason: unknown) => void) => void) {
    super(executor);
    made++;
  }
  bump(): number {
    return ++this.hits;
  }
}

class Fast extends Tracked {
  speed = 2;
  bump(): number {
    return (this.hits += this.speed);
  }
}

class Slow extends Tracked {
  delay = "d";
  bump(): number {
    return this.hits + this.delay.length;
  }
}

function measure(list: Tracked[]): string {
  let total = 0;
  let letters = 0;
  try {
    for (let round = 0; round < 200; round++) {
      for (const one of list) {
        total += one.bump();
        letters += one.tag.length;
      }
    }
  } catch (error) {
    return (error as Error).name;
  }
  return (typeof total === "number" ? String(total) : typeof total + String(total).length) + "/" + letters;
}

const world: Tracked[] = [new Fast(resolve => resolve(1)), new Slow(resolve => resolve(2)), new Tracked(resolve => resolve(3))];
const seen: unknown[] = [measure(world), made];
const next = world[0].then(value => value + 1) as Fast;
seen.push(next instanceof Fast, next.speed, next.bump(), await next);
world.push(next);
await new Promise(resolve => setTimeout(resolve, 1));
seen.push(measure(world), made);
console.log(seen.join(" "));
