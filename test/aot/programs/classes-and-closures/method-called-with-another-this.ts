// A method of a class is entered with a `this` that is no object of the class: through call, apply, Reflect.apply, bind, a plain call of the function that was read, another object that borrows it, and a subclass made by text that is evaluated.
class Meter {
  unit: number;
  constructor(unit: number) { this.unit = unit; }
  measure(count: number): number { return this.unit * count; }
  get doubled(): number { return this.unit * 2; }
  describe(): string { return typeof this + ":" + (this === undefined ? "none" : String(this.unit)); }
}

const meter = new Meter(3);
const borrowed = { unit: 5, measure: meter.measure, describe: meter.describe };
const text = { unit: "ab" } as unknown as Meter;
const getter = Object.getOwnPropertyDescriptor(Meter.prototype, "doubled")!.get as (this: unknown) => unknown;
const Heir = new Function("Meter", "return class Heir extends Meter { measure(count) { return super.measure(count) + 1 } }")(Meter) as typeof Meter;
const heir = new Heir(7);

function attempt(run: () => unknown): string {
  try { return String(run()); } catch (error) { return (error as Error).name; }
}

let total = 0;
const seen: string[] = [];
for (let i = 0; i < 3000; i++) {
  total = (total + meter.measure(i % 5) + heir.measure(i % 3)) % 100003;
  if (i % 1000 !== 500) continue;
  const loose = meter.measure, looseDescribe = meter.describe;
  seen.push(
    attempt(() => meter.measure.call({ unit: 11 } as Meter, 2)),
    attempt(() => meter.measure.apply(borrowed as unknown as Meter, [2])),
    attempt(() => Reflect.apply(meter.measure, text, [2])),
    attempt(() => meter.measure.bind(new Meter(13))(2)),
    attempt(() => borrowed.measure(2)),
    attempt(() => borrowed.describe()),
    attempt(() => loose(2)),
    attempt(() => looseDescribe()),
    attempt(() => meter.describe.call(4 as unknown as Meter)),
    attempt(() => meter.describe.call(null as unknown as Meter)),
    attempt(() => getter.call({ unit: 17 })),
    attempt(() => getter.call(undefined)),
    attempt(() => getter.call("text")),
    attempt(() => Meter.prototype.measure(2)),
    attempt(() => Object.create(meter).measure(2)),
  );
}
console.log(total);
console.log(seen.join(" "));
