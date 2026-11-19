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
class Heir extends Holder {
  *method(x) {
    return [this.n, x];
  }
}
class Silent {
  *method(x) {
    out.push("silent " + x);
    return { x };
  }
}
const rows = [
  new Holder(),
  {
    *method(x, y) {
      yield [x, y];
    },
  },
  { method: nothing },
  { method: one },
  new Heir(),
  { method: number, second: 1 },
  { first: 1, method: list },
  { method: text },
  new Silent(),
];
function* byEach(objects) {
  for (const object of objects) out.push(show(yield* object.method(1, 2)));
}
function* byIndex(objects) {
  for (let k = 0; k < objects.length; k++) {
    const object = objects[k];
    const value = yield* object.method(k);
    out.push(show(value));
  }
}
function* asStatements(objects) {
  for (let k = 0; k < objects.length; k++) yield* objects[k].method(k, k);
  return "end";
}
function* twice(objects) {
  let k = 0;
  while (k < objects.length) {
    out.push(show([yield* objects[k].method(k), yield* objects[k].method(-k)]));
    k++;
  }
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
  for (const chosen of [rows, rows.slice(0, 4), rows.slice(2, 5), [rows[0], rows[8]], [rows[4], rows[8], rows[0]]]) {
    drive(byEach(chosen));
    drive(byIndex(chosen));
    drive(asStatements(chosen));
    drive(twice(chosen));
  }
}
console.log(out.join("\n"));
