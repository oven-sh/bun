// The methods that String(), JSON.stringify(), + and for-of look for are replaced on the prototype.
let kind = "open";
class Printed {
  n;
  constructor(n) {
    this.n = n;
  }
  toString() {
    return "printed " + this.n;
  }
  valueOf() {
    return this.n;
  }
  toJSON() {
    return { json: this.n };
  }
  *[Symbol.iterator]() {
    yield this.n;
    yield kind;
  }
}
function show(round) {
  const made = new Printed(round);
  return [JSON.stringify(made), `${made}`, +made, made + 1, [...made].join()].join(" ");
}
for (let round = 0; round < 3; round++) console.log(show(round));
Printed.prototype[Symbol.toPrimitive] = hint => (hint === "number" ? 42 : "primitive");
Printed.prototype.toString = () => "replaced";
for (let round = 0; round < 3; round++) console.log(show(round));
Printed.prototype[Symbol.iterator] = function* () {
  yield "other";
};
delete Printed.prototype.toJSON;
console.log(show(3));
