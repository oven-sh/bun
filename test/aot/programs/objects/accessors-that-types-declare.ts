// Accessors that the types declare, on objects where the flow analysis gives the accessor no slot type.
interface Lazy { readonly value: number; plain: number }
const holder: Lazy = { get value() { return 1; }, plain: 2 };
const heir: Lazy = Object.create(holder);
function read(l: Lazy) { return l.value + l.plain; }
const onlySetter = { set value(v: number) { seen = v; }, plain: 3 };
let seen = 0;
function readSetter(o: { value: number; plain: number }) { return o.value; }
class WithAccessor { #n = 5; get value() { return this.#n; } plain = 4; }
const unread = { get value() { return 7; }, plain: 8 };
function viaAny(o: any) { return o.value; }
onlySetter.value = 9;
console.log(read(holder), read(heir), readSetter(onlySetter), seen, read(new WithAccessor()), viaAny(unread), viaAny(holder));
const above = { get value() { return 11; }, plain: 12 };
const below = Object.create(above);
function readAbove() { return above.value + above.plain; }
const half = { set value(v: number) { seen = v + 1; }, plain: 13 };
function readHalf() { return half.value; }
half.value = 1;
console.log(readAbove(), below.value, readHalf(), seen);
