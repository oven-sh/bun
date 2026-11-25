const out = [];
const show = value => (typeof value === "object" && value !== null ? JSON.stringify(value) : String(value));
function* nothing(x) {
  out.push("nothing " + x);
}
function* number(x) {
  return 7 + x;
}
function* list(x) {
  return [x, "never stepped"];
}
function* text(x) {
  return "text " + x;
}
function* one(x) {
  const sent = yield x;
  return [sent, arguments.length];
}
class Holder {
  constructor() {
    this.n = 3;
  }
  *method(x) {
    yield this.n + x;
    return "method";
  }
}
const holder = new Holder();
function* overNothing(objects) {
  for (const object of objects) out.push(show(yield* object.method(1, 2)));
}
function* overNumber(objects) {
  for (const object of objects) out.push(show(yield* object.method(1, 2)));
}
function* overList(objects) {
  for (const object of objects) out.push(show(yield* object.method(1, 2)));
}
function* overText(objects) {
  for (const object of objects) out.push(show(yield* object.method(1, 2)));
}
function drive(generator) {
  try {
    let result;
    let turns = 0;
    while (!(result = generator.next(turns)).done) {
      out.push(show(result.value));
      if (++turns > 60) break;
    }
    out.push(show(result.value));
  } catch (error) {
    out.push(error.name + " " + error.message);
  }
}
for (let turn = 0; turn < 3; turn++) {
  drive(overNothing([holder, { *method(x, y) { yield [x, y]; } }, { method: nothing }, { method: one }]));
  drive(overNumber([holder, { *method(x, y) { yield [x, y]; } }, { method: number }, { method: one }]));
  drive(overList([holder, { *method(x, y) { yield [x, y]; } }, { method: list }, { method: one }]));
  drive(overText([holder, { *method(x, y) { yield [x, y]; } }, { method: text }, { method: one }]));
}
console.log(out.join("\n"));
