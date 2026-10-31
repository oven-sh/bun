// `Object.create(shared)`, one store and one read of it: nothing is left of the object. A prototype that is refused still throws, also where nothing uses the object.
// COUNT: allCells <= 20000
const family = "~library/Step";
const held = family + "/held";
const shared: any = { kind: 1 };
function make(value: number): any {
  const self = Object.create(shared);
  self[held] = value;
  return self;
}
let sum = 0;
for (let i = 0; i < 70000; i++) sum += make(i)[held] & 1;
console.log(sum);

function unused(prototype: any): string {
  try {
    Object.create(prototype);
    return "made";
  } catch (error) {
    return (error as Error).name;
  }
}
const log: string[] = [];
for (const prototype of [shared, null, undefined, 1, "text", Symbol.iterator, () => 1, [], 2n, true])
  log.push(unused(prototype));
console.log(log.join(" "));
