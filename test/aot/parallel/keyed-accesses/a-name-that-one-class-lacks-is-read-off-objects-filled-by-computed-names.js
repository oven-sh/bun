// `a.value`, where `a` is an instance of a class without that name or an object filled by computed names. Each answers for itself, in every order.
class Payload {
  issues = [1, 2];
  count = 3;
}
const names = (process.env.NAMES_OF_THE_TEST ?? "value,other").split(",");
function filled(value) {
  const object = Object.create({
    get inherited() {
      return this.value * 2;
    },
  });
  for (const name of names) object[name] = name === "value" ? value : null;
  return object;
}
function sum(a, b, n) {
  let total = 0;
  for (let i = 0; i < n; i++) total += a.value + b.issues.length + b.count;
  return total;
}
function inherited(a) {
  return a.inherited;
}
const holders = { sum, inherited };
const operands = { first: filled(3), second: new Payload(), bare: new Payload(), none: undefined, changes: filled(1) };
const hidden = process.env.NAMES_OF_THE_TEST ?? "";
const lines = [];
lines.push(holders["sum" + hidden](operands["first" + hidden], operands["second" + hidden], 1000));
lines.push(holders["sum" + hidden](operands["bare" + hidden], operands["second" + hidden], 3));
lines.push(holders["sum" + hidden](operands["first" + hidden], operands["second" + hidden], 2));
lines.push(holders["inherited" + hidden](operands["first" + hidden]));
lines.push(holders["inherited" + hidden](operands["bare" + hidden]));
const later = operands["bare" + hidden];
later.value = 10;
lines.push(holders["sum" + hidden](later, operands["second" + hidden], 2));
Object.defineProperty(Payload.prototype, "value", { get() { return 100; }, configurable: true });
lines.push(holders["sum" + hidden](new Payload(), operands["second" + hidden], 2));
// The check that it is an object throws in the first turn or never, and a turn that does not run does not throw.
lines.push(holders["sum" + hidden](operands["none" + hidden], operands["second" + hidden], 0));
try {
  holders["sum" + hidden](operands["none" + hidden], operands["second" + hidden], 5);
} catch (error) {
  lines.push(error.constructor.name);
}
// A value that a getter of the other operand changes in the middle of the loop is read again.
const changes = operands["changes" + hidden];
let reads = 0;
Object.defineProperty(changes, "issues", {
  get() {
    changes.value = ++reads;
    return [];
  },
});
Object.defineProperty(changes, "count", { value: 0 });
lines.push(holders["sum" + hidden](changes, changes, 4));
console.log(lines.join("\n"));
