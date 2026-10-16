const order: string[] = [];
function noted(name: string, value: number): number {
  order.push(name);
  return value;
}
order.push("ahead");
enum Sizes {
  None,
  Small = "abc".length,
  Large = noted("Large", 7) * 2,
  Larger = Large + Small,
  Fixed = 100,
}
order.push("behind");
console.log(order.join());
console.log(Sizes.None, Sizes.Small, Sizes.Large, Sizes.Larger, Sizes.Fixed);
console.log(Sizes[3], Sizes[14], Sizes[17], Sizes[100], Sizes[0]);
console.log(Object.keys(Sizes).join());

function sum(a: Sizes, b: Sizes): number {
  return a + b;
}
console.log(sum(Sizes.Large, Sizes.Fixed), sum(Sizes.Small, Sizes.None));

export enum Exported {
  First = Math.max(1, 2),
  Second = First << 2,
}
console.log(Exported.First, Exported.Second, Exported[8]);

function local(seed: number) {
  enum Local {
    Seed = seed,
    Twice = seed * 2,
    Both = Seed + Twice,
  }
  return [Local.Seed, Local.Twice, Local.Both, Local[seed * 3]];
}
console.log(local(2).join(), local(5).join());

enum Merged {
  A = 1,
}
enum Merged {
  B = noted("B", 40) + 2,
}
console.log(Merged.A, Merged.B, Merged[42], order.join());

namespace Inner {
  export enum Flags {
    Read = 1 << 0,
    Write = noted("Write", 2),
    Both = Read | Write,
  }
}
console.log(Inner.Flags.Read, Inner.Flags.Write, Inner.Flags.Both, Inner.Flags[3]);

function pick(): Sizes {
  return Sizes.Larger;
}
switch (pick()) {
  case Sizes.Small:
    console.log("small");
    break;
  case Sizes.Larger:
    console.log("larger");
    break;
}
const fraction: Record<string, unknown> = {};
enum Odd {
  Half = 1 / noted("Half", 2),
  NotANumber = 0 / noted("NotANumber", 0),
  Negative = -noted("Negative", 1),
}
fraction.keys = Object.keys(Odd).join();
console.log(Odd.Half, Odd.NotANumber, Odd.Negative, Odd[0.5], Odd["NaN"], Odd[-1], fraction.keys);
