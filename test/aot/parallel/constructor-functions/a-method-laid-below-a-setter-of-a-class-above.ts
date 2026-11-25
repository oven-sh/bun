let stored: unknown;
class Above {
  get shut() {
    return function () {
      return "from above";
    };
  }
  set shut(value) {
    stored = value;
  }
}
interface Gate {
  count: number;
  parts: number;
  shut(): string;
}
function Gate(this: Gate, v: number) {
  this.count = v;
  this.parts = v;
}
Object.setPrototypeOf(Gate.prototype, Above.prototype);
Gate.prototype.shut = function () {
  return "own";
};
function take(gate: Gate) {
  return gate.count + gate.parts;
}
function atEnd(this: Gate) {
  const said = this.shut();
  return said + take(this);
}
(globalThis as any).kept = { handler: atEnd, make: Gate };
let all = "";
for (let turn = 0; turn < 3; turn++) all += (globalThis as any).kept.handler.call(new (globalThis as any).kept.make(turn)) + ";";
console.log(all, typeof stored, Object.hasOwn(Gate.prototype, "shut"));
