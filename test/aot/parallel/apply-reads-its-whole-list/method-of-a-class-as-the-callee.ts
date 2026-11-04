let reads = 0;
class Meter {
  calls = 0;
  tick(): void { this.calls++; }
  static bump(): number { return ++Meter.bumps; }
  static bumps = 0;
}
function makeList(): number[] {
  const list: number[] = [1, 2, 3];
  Object.defineProperty(list, 2, { get(): number { reads++; return 3; } });
  return list;
}
const meter = new Meter();
function ofInstance(list: number[]): void { meter.tick.apply(meter, list as []); }
function ofClass(list: number[]): number { return Meter.bump.apply(Meter, list as []); }
const arrow = (): void => { meter.calls++; };
function ofArrow(list: number[]): void { arrow.apply(undefined, list as []); }
for (let i = 0; i < 300; i++) ofInstance(makeList());
console.log(meter.calls, reads);
for (let i = 0; i < 300; i++) ofClass(makeList());
console.log(Meter.bumps, reads);
for (let i = 0; i < 300; i++) ofArrow(makeList());
console.log(meter.calls, reads);
