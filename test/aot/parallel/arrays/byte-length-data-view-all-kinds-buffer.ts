// `view.byteLength` in a loop's test and by itself: over a fixed buffer, a part of one, an empty one, a resizable one that shrinks and grows, a growable shared one, and a buffer that is gone.
function lengthOf(view: DataView): string {
  try {
    return String(view.byteLength);
  } catch (error) {
    return (error as Error).constructor.name;
  }
}

function sum(view: DataView): number {
  let total = 0;
  for (let at = 0; at < view.byteLength; at += 8) total += view.getFloat64(at, true);
  return total;
}

const whole = new DataView(Float64Array.from({ length: 8 }, (_, k) => k / 2).buffer);
const part = new DataView(whole.buffer, 16, 24);
const rest = new DataView(whole.buffer, 40);
const atTheEnd = new DataView(whole.buffer, 64);
const empty = new DataView(new ArrayBuffer(0));
for (const view of [whole, part, rest, atTheEnd, empty]) console.log(lengthOf(view), sum(view));

const resizable = new ArrayBuffer(32, { maxByteLength: 64 });
const tracking = new DataView(resizable);
const trackingFrom = new DataView(resizable, 8);
const fixedInside = new DataView(resizable, 8, 16);
const show = (label: string) => console.log(label, lengthOf(tracking), lengthOf(trackingFrom), lengthOf(fixedInside));
show("made");
resizable.resize(64);
show("grown");
resizable.resize(24);
show("just enough");
resizable.resize(16);
show("too short");
resizable.resize(4);
show("shorter than the offset");
resizable.resize(0);
show("nothing");
resizable.resize(40);
show("again");

const shared = new SharedArrayBuffer(16, { maxByteLength: 32 });
const overShared = new DataView(shared);
const partOfShared = new DataView(shared, 8, 8);
console.log(lengthOf(overShared), lengthOf(partOfShared));
shared.grow(32);
console.log(lengthOf(overShared), lengthOf(partOfShared));

// The buffer goes away in the middle of a loop that asks for the length at every turn.
const leaving = new DataView(new ArrayBuffer(64));
let turns = 0;
try {
  for (let at = 0; at < leaving.byteLength; at += 8) {
    turns++;
    if (at === 24) leaving.buffer.transfer();
  }
} catch (error) {
  console.log((error as Error).constructor.name, turns);
}
console.log(lengthOf(leaving), lengthOf(new DataView(structuredClone(whole.buffer))));
structuredClone(whole.buffer, { transfer: [whole.buffer] });
for (const view of [whole, part, rest, atTheEnd]) console.log(lengthOf(view));

// What is no DataView is refused, whatever it looks like.
const getter = Object.getOwnPropertyDescriptor(DataView.prototype, "byteLength")!.get!;
for (const other of [new Uint8Array(4), new ArrayBuffer(4), {}, 4, undefined, Object.create(empty)]) {
  try {
    console.log(getter.call(other));
  } catch (error) {
    console.log((error as Error).constructor.name);
  }
}
