// The classes of the engine whose instances have no kind of cell of their own: WeakRef, FinalizationRegistry, Intl.DateTimeFormat, Intl.NumberFormat, generators, bound functions.
// A parameter of such a type is handed instances, instances of classes below, objects that only have the prototype, and everything else.
class Reference extends WeakRef<object> {}
class Registry extends FinalizationRegistry<number> {}
class Dates extends Intl.DateTimeFormat {}
class Numbers extends Intl.NumberFormat {}
const kept = { a: 1 };
function* count(to: number): Generator<number> {
  for (let k = 0; k < to; k++) yield k;
}
function named(this: unknown, a: number, b: number): number {
  return a + b;
}

function alive(reference: WeakRef<object>): boolean {
  return reference.deref() === kept;
}
function registers(registry: FinalizationRegistry<number>): boolean {
  registry.register(kept, 1, kept);
  return registry.unregister(kept);
}
function zone(dates: Intl.DateTimeFormat): string {
  return dates.resolvedOptions().timeZone;
}
function digits(numbers: Intl.NumberFormat): string {
  return numbers.format(1234.5);
}
function total(steps: Generator<number>): number {
  let sum = 0;
  for (const step of steps) sum += step;
  return sum;
}
function totalOfAny(steps: IterableIterator<number>): number {
  let sum = 0;
  for (const step of steps) sum += step;
  return sum;
}

function values(): any[] {
  return [
    new WeakRef(kept), new Reference(kept), Object.create(WeakRef.prototype),
    new FinalizationRegistry<number>(() => {}), new Registry(() => {}), Object.create(FinalizationRegistry.prototype),
    new Intl.DateTimeFormat("en-US", { timeZone: "UTC" }), new Dates("en-US", { timeZone: "UTC" }), Object.create(Intl.DateTimeFormat.prototype),
    new Intl.NumberFormat("en-US"), new Numbers("en-US"), Object.create(Intl.NumberFormat.prototype),
    count(4), Object.create(count.prototype), Object.setPrototypeOf(count(3), null), [1, 2, 3].values(), new Set([5, 6]).values(), new Map([[7, 8]]).keys(), "12"[Symbol.iterator](),
    named.bind(null, 1), named, () => 1, kept, {}, [], new Map(), new Proxy(new WeakRef(kept), {}), undefined, null, 0, "text", Symbol.iterator, 1n,
  ];
}
const asked: Record<string, (value: any) => unknown> = { alive, registers, zone, digits, total, totalOfAny };
for (const name of Object.keys(asked)) {
  const answers: string[] = [];
  const size = values().length;
  for (let round = 0; round < 3; round++) {
    for (let which = 0; which < size; which++) {
      let answer: string;
      try {
        answer = String(asked[name](values()[which]));
      } catch (error) {
        answer = "!" + (error as Error).constructor.name;
      }
      if (round === 2) answers.push(answer);
    }
  }
  console.log(name + ": " + answers.join(" "));
}
console.log(values().map(value => (typeof value === "function" ? value.name + "/" + value.length : typeof value)).join(" "));
