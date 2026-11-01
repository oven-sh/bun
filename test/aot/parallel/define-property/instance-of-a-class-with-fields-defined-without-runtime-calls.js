// COUNT: operation:operationAOTDefineOwnProperty = 0
// COUNT: arrivals <= 2000
class Schema {
  constructor(turn) {
    this.turn = turn;
  }
}
function init(schema, def) {
  if (!schema.internals) {
    Object.defineProperty(schema, "internals", { value: { def, traits: 1 }, enumerable: false });
  }
  schema.internals.traits++;
}
let sum = 0;
let last;
for (let turn = 0; turn < 2000; turn++) {
  const schema = new Schema(turn);
  init(schema, turn);
  init(schema, turn);
  sum += schema.internals.traits + schema.internals.def + schema.turn;
  last = schema;
}
console.log(sum);
console.log(JSON.stringify(Object.getOwnPropertyDescriptor(last, "internals")), Object.keys(last).join(), Object.getOwnPropertyNames(last).join(), JSON.stringify(last));
