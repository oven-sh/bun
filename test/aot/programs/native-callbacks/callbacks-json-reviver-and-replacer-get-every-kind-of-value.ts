// Callbacks handed over: JSON.parse calls the reviver and JSON.stringify the replacer with every value of the document and with the holder as `this`, while the program's own calls pass a number and a holder of its own class.
let total = 0;

class Holder {
  factor = 2;
}

function scale(this: Holder, key: string, value: number): number {
  total += this instanceof Holder ? 1 : Array.isArray(this) ? 100 : 10000;
  total += typeof value === "number" ? 1000000 : typeof value === "string" ? 10000000 : 100000000;
  return typeof value === "number" ? value * (this.factor ?? 3) : value;
}

scale.call(new Holder(), "own", 1);
const parsed = JSON.parse('{"a":1,"b":[2,"x"],"factor":5,"c":null}', scale);
const text = JSON.stringify({ a: 1, b: [2, "x"], factor: 5, c: null, d: new Holder() }, scale);
console.log(total, JSON.stringify(parsed), text);
