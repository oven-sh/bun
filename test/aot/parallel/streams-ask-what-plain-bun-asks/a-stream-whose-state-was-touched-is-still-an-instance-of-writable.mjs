import { Duplex, PassThrough, Transform, Writable } from "node:stream";
const { WritableState } = Writable;
const kinds = { Duplex, Transform, PassThrough };
const ask = label => {
  for (const [name, Kind] of Object.entries(kinds)) console.log(label, name, new Kind() instanceof Writable);
};

ask("untouched");

for (const [name, Kind] of Object.entries(kinds)) {
  const stream = new Kind();
  Object.defineProperty(stream._writableState, "ended", { value: false, writable: true, configurable: true });
  console.log("an own property over a declared name", name, stream instanceof Writable);
  const lower = new Kind();
  lower._writableState = Object.create(lower._writableState);
  console.log("a state one link lower", name, lower instanceof Writable);
}

const holder = { _writableState: Object.create(WritableState.prototype) };
const answer = Writable.call(holder, { highWaterMark: 3 });
console.log("the constructor called on a holder", answer === undefined, holder._writableState.highWaterMark);

const getBuffer = WritableState.prototype.getBuffer;
WritableState.prototype.getBuffer = function () {
  return getBuffer.call(this);
};
ask("a method of the state is replaced");
WritableState.prototype.getBuffer = getBuffer;
ask("and laid back");

Writable.WritableState = class extends WritableState {};
ask("another class under Writable.WritableState");
const heir = { _writableState: Object.create(Writable.WritableState.prototype) };
console.log("an heir of that class", heir instanceof Writable);
