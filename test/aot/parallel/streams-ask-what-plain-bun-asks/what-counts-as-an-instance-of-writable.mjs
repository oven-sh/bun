import { Duplex, PassThrough, Readable, Transform, Writable } from "node:stream";
const { WritableState } = Writable;
class Ledger extends WritableState {}
const states = {
  "an heir of the prototype": Object.create(WritableState.prototype),
  "an heir of an heir": Object.create(Object.create(WritableState.prototype)),
  "an instance of a subclass": new Ledger({}, new Writable(), false),
  "the state of another stream": new Writable()._writableState,
  "the state of a duplex": new Duplex()._writableState,
  "the prototype itself": WritableState.prototype,
  "a plain object": {},
  "a readable state": new Readable()._readableState,
  null: null,
  undefined,
  "a number": 7,
};
for (const [name, state] of Object.entries(states)) {
  const holder = { _writableState: state };
  console.log(name, holder instanceof Writable, holder instanceof Duplex, holder instanceof Readable);
}
let reads = 0;
const counted = {
  get _writableState() {
    reads++;
    return Object.create(WritableState.prototype);
  },
};
console.log("a getter", counted instanceof Writable, reads);
for (const stream of [new Writable(), new Duplex(), new Transform(), new PassThrough(), new Readable()]) {
  console.log(stream.constructor.name, stream instanceof Writable);
}
class Drain extends Writable {}
console.log("a subclass asks the chain alone", { _writableState: new Writable()._writableState } instanceof Drain);
for (const operand of [0, "", null, undefined, false, 5, "text"]) {
  console.log("called by hand", String(operand), String(Writable[Symbol.hasInstance](operand)));
}
