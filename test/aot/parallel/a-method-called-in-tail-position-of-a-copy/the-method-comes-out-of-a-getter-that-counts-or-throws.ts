let reads = 0;
const counted = { get measure() { reads++; return function (this: unknown, more: number) { return this === counted ? more + 1 : -1; }; } };
const broken = { get measure(): (more: number) => number { reads += 10; throw new RangeError("no measure"); } };
const ask = (holder: { measure(more: number): number }, more: number) => holder.measure(more);
function twice(holder: { measure(more: number): number }, more: number): number {
  const first = ask(holder, more);
  return first + ask(holder, first);
}
console.log(twice(counted, 1), reads);
try { console.log(twice(broken, 1)); } catch (error) { console.log((error as Error).message, reads); }
console.log(twice(counted, 5), reads);
