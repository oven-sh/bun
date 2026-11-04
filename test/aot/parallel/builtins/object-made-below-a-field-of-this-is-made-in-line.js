// Object.create() below a value of which nothing is proven is made by the code in line, which asks the run time only while it has kept nothing for that prototype.
// COUNT: operation:operationAOTObjectCreate >= 1
function Base() {}
Base.prototype.context = { kind: "context", get answer() { return 42; } };
Base.prototype.request = { kind: "request" };
Base.prototype.make = function () {
  const context = Object.create(this.context);
  const request = (context.request = Object.create(this.request));
  request.context = context;
  return context;
};
const base = new Base();
let sum = 0;
for (let turn = 0; turn < 100000; turn++) {
  const made = base.make();
  sum += made.answer + made.request.kind.length;
}
console.log(sum);
