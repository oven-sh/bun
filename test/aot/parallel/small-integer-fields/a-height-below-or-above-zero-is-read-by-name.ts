// Code that runs seldom reads a field by name from a value of unknown type. The table of fields answers for a field that holds -1000 or 1000 as it does for any integer of 32 bits, so the run time is not asked.
// Flags: --aot-heat=EverythingIsCold
// COUNT: operation:operationAOTGetByIdAndCache = 0
const key = process.env.SHELF || "shelf";
const few = process.argv.length;
const anything: any = few > 50 ? { shelf: 0 } : globalThis;
type Valley = { height: -1000; width: number };
type Peak = { height: 1000; width: number; snow: number };
type Place = Valley | Peak;
function worth(place: Place): number {
  return place.height === -1000 ? place.width : place.width + place.snow;
}
function put(x: Place) {
  anything[key] = x;
}
function take(depth: number): any {
  return depth ? take(depth - 1) : anything[key];
}
const first: Place = few > 50 ? { height: -1000, width: few } : { height: 1000, width: few, snow: 4 };
const second: Place = few > 50 ? { height: 1000, width: few, snow: 4 } : { height: -1000, width: few };
let sum = worth(first) + worth(second);
put(first);
for (let i = 0; i < 500; i++) sum += take(0).height;
put(second);
for (let i = 0; i < 500; i++) sum += take(0).height;
console.log(sum);
