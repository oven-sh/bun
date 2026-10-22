// Seven functions with six number parameters each, which direct calls fill with numbers; setImmediate passes the first none, the second one string, and so on up to six. Each function tells how many strings and how many undefined it saw.
export {};

const tell = (index: number, strings: number, missing: number): void => void (strings + missing && seen.push(index + ":" + strings + ":" + missing));
function take0(a: number, b: number, c: number, d: number, e: number, f: number): void {
  tell(0, +(typeof a === "string") + +(typeof b === "string") + +(typeof c === "string") + +(typeof d === "string") + +(typeof e === "string") + +(typeof f === "string"), +(a === undefined) + +(b === undefined) + +(c === undefined) + +(d === undefined) + +(e === undefined) + +(f === undefined));
}
function take1(a: number, b: number, c: number, d: number, e: number, f: number): void {
  tell(1, +(typeof a === "string") + +(typeof b === "string") + +(typeof c === "string") + +(typeof d === "string") + +(typeof e === "string") + +(typeof f === "string"), +(a === undefined) + +(b === undefined) + +(c === undefined) + +(d === undefined) + +(e === undefined) + +(f === undefined));
}
function take2(a: number, b: number, c: number, d: number, e: number, f: number): void {
  tell(2, +(typeof a === "string") + +(typeof b === "string") + +(typeof c === "string") + +(typeof d === "string") + +(typeof e === "string") + +(typeof f === "string"), +(a === undefined) + +(b === undefined) + +(c === undefined) + +(d === undefined) + +(e === undefined) + +(f === undefined));
}
function take3(a: number, b: number, c: number, d: number, e: number, f: number): void {
  tell(3, +(typeof a === "string") + +(typeof b === "string") + +(typeof c === "string") + +(typeof d === "string") + +(typeof e === "string") + +(typeof f === "string"), +(a === undefined) + +(b === undefined) + +(c === undefined) + +(d === undefined) + +(e === undefined) + +(f === undefined));
}
function take4(a: number, b: number, c: number, d: number, e: number, f: number): void {
  tell(4, +(typeof a === "string") + +(typeof b === "string") + +(typeof c === "string") + +(typeof d === "string") + +(typeof e === "string") + +(typeof f === "string"), +(a === undefined) + +(b === undefined) + +(c === undefined) + +(d === undefined) + +(e === undefined) + +(f === undefined));
}
function take5(a: number, b: number, c: number, d: number, e: number, f: number): void {
  tell(5, +(typeof a === "string") + +(typeof b === "string") + +(typeof c === "string") + +(typeof d === "string") + +(typeof e === "string") + +(typeof f === "string"), +(a === undefined) + +(b === undefined) + +(c === undefined) + +(d === undefined) + +(e === undefined) + +(f === undefined));
}
function take6(a: number, b: number, c: number, d: number, e: number, f: number): void {
  tell(6, +(typeof a === "string") + +(typeof b === "string") + +(typeof c === "string") + +(typeof d === "string") + +(typeof e === "string") + +(typeof f === "string"), +(a === undefined) + +(b === undefined) + +(c === undefined) + +(d === undefined) + +(e === undefined) + +(f === undefined));
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
take0(1, 2, 3, 4, 5, 6);
setImmediate(take0 as any);
take1(1, 2, 3, 4, 5, 6);
setImmediate(take1 as any, "s");
take2(1, 2, 3, 4, 5, 6);
setImmediate(take2 as any, "s", "s");
take3(1, 2, 3, 4, 5, 6);
setImmediate(take3 as any, "s", "s", "s");
take4(1, 2, 3, 4, 5, 6);
setImmediate(take4 as any, "s", "s", "s", "s");
take5(1, 2, 3, 4, 5, 6);
setImmediate(take5 as any, "s", "s", "s", "s", "s");
take6(1, 2, 3, 4, 5, 6);
setImmediate(take6 as any, "s", "s", "s", "s", "s", "s");
await new Promise(resolve => setTimeout(resolve, 5));
seen.push(measure(world), world.map(body => Object.keys(body).length).join(""));
console.log(seen.join(" "));
