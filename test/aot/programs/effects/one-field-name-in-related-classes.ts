// One field name in a base class, a class below it, an unrelated class, and in two objects of one object type of which one gets a property later.
class Crate { size: number; label = "crate"; constructor(size: number) { this.size = size; } }
class Box extends Crate { lid = true; constructor(size: number) { super(size); } }
class Wheel { size: number; turns = 0; constructor(size: number) { this.size = size; } }
type Parcel = { size: number; tag: string };

function storeBaseReadDerived(base: Crate, derived: Box, count: number) {
  let total = 0;
  for (let i = 0; i < count; i++) { base.size = i; total += derived.size; }
  return total;
}
function storeDerivedReadBase(derived: Box, base: Crate, count: number) {
  let total = 0;
  for (let i = 0; i < count; i++) { derived.size = i; total += base.size; }
  return total;
}
function storeOnlyCratesReadOnlyBoxes(crate: Crate, box: Box, count: number) {
  let total = 0;
  for (let i = 0; i < count; i++) { crate.size = i; total += box.size; }
  return total;
}
function storeBoxAsCrateReadBox(crate: Crate, box: Box) {
  const before = box.size;
  crate.size = before + 1;
  return before * 100 + box.size;
}
function storeParcelReadParcel(first: Parcel, second: Parcel, count: number) {
  let total = 0;
  for (let i = 0; i < count; i++) { first.size = i; total += second.size; }
  return total;
}
function storePlainReadExtended(plain: Parcel, extended: Parcel, count: number) {
  let total = 0;
  for (let i = 0; i < count; i++) { plain.size = i; total += extended.size; }
  return total;
}
function storeWheelReadCrate(wheel: Wheel, crate: Crate, count: number) {
  let total = 0;
  for (let i = 0; i < count; i++) { wheel.size = i; total += crate.size; }
  return total;
}
function storeAnyReadCrate(target: any, crate: Crate, count: number) {
  let total = 0;
  for (let i = 0; i < count; i++) { target.size = i; total += crate.size; }
  return total;
}
function narrowThenRead(either: Crate | Wheel, crate: Crate) {
  crate.size = 1;
  if (either instanceof Wheel) either.size = 2;
  else either.size = 3;
  return crate.size;
}

const crate = new Crate(6), box = new Box(8), otherBox = new Box(9), wheel = new Wheel(4);
console.log(storeBaseReadDerived(box, box, 10), storeBaseReadDerived(crate, box, 10), storeBaseReadDerived(otherBox, box, 10));
console.log(storeDerivedReadBase(box, box, 10), storeDerivedReadBase(box, crate, 10), storeDerivedReadBase(box, otherBox, 10));
console.log(storeOnlyCratesReadOnlyBoxes(crate, box, 10), crate.size, box.size);
console.log(storeBoxAsCrateReadBox(box, box), storeBoxAsCrateReadBox(otherBox, box));

const plain: Parcel = { size: 1, tag: "plain" };
const extended: Parcel = { size: 2, tag: "extended" };
(extended as any).weight = 7;
console.log(storePlainReadExtended(plain, extended, 10), plain.size, extended.size, Object.keys(extended).join());
console.log(storeParcelReadParcel(plain, extended, 10), storeParcelReadParcel(extended, extended, 10), storeParcelReadParcel(plain, plain, 10));

console.log(storeWheelReadCrate(wheel, crate, 10), wheel.size, crate.size);
const forwarding = new Wheel(1);
Object.defineProperty(forwarding, "size", { set(value: number) { crate.size = value * 2; }, get() { return -1; }, configurable: true });
console.log(storeWheelReadCrate(forwarding, crate, 10), forwarding.size, crate.size);

const proxy = new Proxy(new Wheel(1), { set(_target, _key, value) { crate.size = value * 3; return true; } });
console.log(storeAnyReadCrate(proxy, crate, 10), storeAnyReadCrate(crate, crate, 10), storeAnyReadCrate(wheel, crate, 10), storeAnyReadCrate({ size: 0 }, crate, 10));
console.log(narrowThenRead(wheel, crate), narrowThenRead(crate, crate), narrowThenRead(box, crate), narrowThenRead(box, box));
