const out = [];
const show = value => (typeof value === "function" ? "function " + value.name : typeof value === "object" && value !== null ? JSON.stringify(value) : String(value));
function* none(x) { out.push("none " + x); }
function* one(x) { const sent = yield x; return [sent, arguments.length, this === undefined ? "sloppy" : typeof this]; }
function* strict(x, y) { "use strict"; yield [x, y, this === undefined]; return y; }
function* defaults(x, y = x) { yield [x, y]; return y; }
function* many(a, b, c, d, e, f) { yield [a, b, c, d, e, f]; }
one.property = 1;
class Holder {
  constructor() { this.n = 3; }
  *method(x) { yield this.n + x; return "method"; }
  static *made(x) { yield "static " + x; }
  *#hidden(x) { yield "hidden " + x; }
  hidden(x) { return this.#hidden(x); }
}
const holder = new Holder();
const arrow = x => [x, "arrow"];
const bound = one.bind({ own: 1 }, "bound");
const proxied = new Proxy(one, {});
const changed = function* (x) { yield x; };
changed.prototype = null;
const moved = Object.setPrototypeOf(function* (x) { yield "moved " + x; }, null);
async function* asynchronous(x) { yield x; }
const callees = [none, one, strict, defaults, many, holder.method, Holder.made, arrow, bound, proxied, changed, moved, asynchronous, x => none(x), x => new Set([x]), () => "text", () => 5, () => null, () => ({ [Symbol.iterator]: () => ({ next: () => ({ done: true, value: "own" }) }) }), 7, undefined, class {}, Map.prototype.keys, Array.prototype.values];
function* all(list) {
  const results = [];
  for (let k = 0; k < list.length; k++) {
    try {
      results.push(show(yield* list[k](k)));
    } catch (error) {
      results.push(error.name);
    }
  }
  return results;
}
function* byMethod(objects) {
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
    out.push(error.name);
  }
}
for (let turn = 0; turn < 3; turn++) {
  drive(all(callees));
  drive(byMethod([holder, { *method(x, y) { yield [x, y]; } }, { method: none }, { method: one }]));
}
drive((function* () { yield* holder.hidden(4); yield* many(); yield* many(1, 2, 3, 4, 5, 6, 7); })());
console.log(out.join("\n"));
