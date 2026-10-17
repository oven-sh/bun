export interface Options { depth: number; label?: string }
export type Visitor<T> = (value: T, index: number) => void;

export function clamp(value: number, low = 0, high = 10): number {
  return value < low ? low : value > high ? high : value;
}

export function describe(options: Options, ...rest: string[]): string {
  return (options.label ?? "none") + ":" + options.depth + (rest.length ? "[" + rest.join("|") + "]" : "");
}

export function each<T>(list: readonly T[], visit: Visitor<T>): number {
  let count = 0;
  for (const value of list) visit(value, count++);
  return count;
}

export function countArguments(): number {
  return arguments.length;
}

export function bound(this: { base: number }, more: number): number {
  return this.base + more;
}

export async function later(text: string): Promise<string> {
  await null;
  return text + "!";
}

export function* upTo(limit: number): Generator<number, string, unknown> {
  for (let i = 0; i < limit; i++) yield i;
  return "done";
}

export default function (name: string): string {
  return "default " + name;
}

export class Meter {
  static made = 0;
  private total = 0;
  constructor(readonly unit: string) {
    Meter.made++;
  }
  add(amount: number): this {
    this.total += amount;
    return this;
  }
  get reading(): string {
    return this.total + this.unit;
  }
  set reading(text: string) {
    this.total = parseFloat(text);
  }
  static of(unit: string, amount: number): Meter {
    return new Meter(unit).add(amount);
  }
}
