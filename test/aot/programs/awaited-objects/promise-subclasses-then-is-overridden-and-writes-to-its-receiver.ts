// A subclass of Promise overrides `then`. `await` calls the override, which stores a string into a number field of its receiver before it goes on to the built-in.
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
  then<A, B>(fulfilled?: ((value: number) => A | PromiseLike<A>) | null, rejected?: ((reason: unknown) => B | PromiseLike<B>) | null): Promise<A | B> {
    (this as any).hits = "1";
    return super.then(fulfilled, rejected);
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
seen.push(await world[0], await Promise.resolve(world[0]), typeof world[0].hits);
await new Promise(resolve => setTimeout(resolve, 1));
seen.push(measure(world), made);
console.log(seen.join(" "));
