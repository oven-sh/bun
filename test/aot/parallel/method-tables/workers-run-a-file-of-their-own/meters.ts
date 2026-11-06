export class Meter {
  constructor(public base: number) {}
  read(): number {
    return this.base + 1;
  }
}
export class Double extends Meter {
  read(): number {
    return this.base * 2;
  }
}
export class Plain extends Meter {}

export function total(meters: Meter[]): number {
  let sum = 0;
  for (const meter of meters) sum += meter.read();
  return sum;
}

export function make(): Meter[] {
  return [new Meter(5), new Double(6), new Plain(7)];
}
