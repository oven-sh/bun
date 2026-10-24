// A generator that suspends in very many places keeps what lives across a suspension in its frame. An object literal that lives on is saved there when it is whole: behind the last of its first stores, though what those store is fetched out of the frame between them. The record also admits objects from elsewhere, so a store by its layout is only right while nobody else can have the object.
type Options = { first: unknown; second: unknown; third: unknown };
declare function give(): Options;
(globalThis as any).give = () => JSON.parse('{"first":1,"second":2,"third":"from outside"}');
function outside(): Options { const given: Options = give(); return given; }
const readers: (() => unknown)[] = [];
function* run(seed: number, given: unknown[]): Generator<number, string, number> {
  let total = seed;
  const one = given[0], two = given[1], three = given[2];
  total += yield total; total += yield total; total += yield total; total += yield total; total += yield total; total += yield total;
  total += yield total; total += yield total; total += yield total; total += yield total; total += yield total; total += yield total;
  total += yield total; total += yield total; total += yield total; total += yield total; total += yield total; total += yield total;
  total += yield total; total += yield total; total += yield total; total += yield total; total += yield total; total += yield total;
  total += yield total; total += yield total; total += yield total; total += yield total; total += yield total; total += yield total;
  total += yield total; total += yield total; total += yield total; total += yield total; total += yield total; total += yield total;
  const options: Options = { first: one, second: two, third: three };
  readers.push(() => options.first);
  total += yield total;
  return options.first + ":" + options.second + ":" + options.third + ":" + outside().third + ":" + total;
}
function drive(seed: number, given: unknown[]): string {
  const running = run(seed, given);
  let step = running.next(0);
  while (!step.done) step = running.next(1);
  return step.value;
}
console.log(drive(1, [1, "b", true]), drive(2, [null, undefined, 2.5]), readers.length, readers[0](), readers[1]());
