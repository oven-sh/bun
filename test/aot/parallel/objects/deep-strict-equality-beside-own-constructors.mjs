// util.isDeepStrictEqual() and assert.deepStrictEqual() compare the constructor that the second object has itself, also where both objects are made alike.
import assert from "node:assert";
import { isDeepStrictEqual } from "node:util";

class Order {
  constructor(id) {
    this.id = id;
    this.note = "note " + id;
  }
}
class Refund {
  constructor(id) {
    this.id = id;
    this.note = "note " + id;
  }
}
class Marked {
  constructor(id, mark) {
    this.id = id;
    if (mark) own(this, mark);
  }
}
function own(object, constructor) {
  return Object.defineProperty(object, "constructor", { value: constructor, enumerable: false, configurable: true, writable: true });
}
let asked = 0;
const made = {
  literal: id => ({ id, note: "note " + id }),
  order: id => new Order(id),
  orderAsOrder: id => own(new Order(id), Order),
  orderAsRefund: id => own(new Order(id), Refund),
  orderAsObject: id => own(new Order(id), Object),
  orderBesideHidden: id => Object.defineProperty(new Order(id), "hidden", { value: 1, enumerable: false }),
  literalAsOrder: id => own({ id, note: "note " + id }, Order),
  literalAsObject: id => own({ id, note: "note " + id }, Object),
  literalAsNothing: id => own({ id, note: "note " + id }, undefined),
  literalWithGetter: id =>
    Object.defineProperty({ id, note: "note " + id }, "constructor", {
      get() {
        asked++;
        return id % 2 ? Order : Object;
      },
      enumerable: false,
    }),
};
function throws(left, right) {
  try {
    assert.deepStrictEqual(left, right);
    return "=";
  } catch (error) {
    return error.code === "ERR_ASSERTION" ? "." : error.name;
  }
}
const names = Object.keys(made);
for (const left of names) {
  let row = "";
  for (const right of names) {
    let same = 0;
    let inside = 0;
    for (let id = 0; id < 8; id++) {
      if (isDeepStrictEqual(made[left](id), made[right](id))) same++;
      if (isDeepStrictEqual([{ of: made[left](id) }], [{ of: made[right](id) }])) inside++;
    }
    row += " " + same + "/" + inside + throws(made[left](2), made[right](2));
  }
  console.log(left + ":" + row + " " + asked);
}
for (const word of ["late", "later"]) {
  const one = { id: 1, note: "n" };
  const two = own({ id: 1, note: "n" }, Order);
  const three = Object.defineProperty({ id: 1, note: "n" }, "hidden", { value: 1, enumerable: false });
  one[word] = two[word] = three[word] = word;
  console.log(word, [one, two, three].map(left => [one, two, three].map(right => (isDeepStrictEqual(left, right) ? "=" : ".")).join("")).join(" "));
}
const marks = [null, Order, Refund, Marked, Object];
for (const left of marks) console.log(marks.map(right => (isDeepStrictEqual(new Marked(1, left), new Marked(1, right)) ? "same" : "other")).join(" "));

const later = new Order(5);
console.log(isDeepStrictEqual(new Order(5), later));
own(later, Refund);
console.log(isDeepStrictEqual(new Order(5), later), isDeepStrictEqual(later, new Order(5)));
delete later.constructor;
console.log(isDeepStrictEqual(new Order(5), later), isDeepStrictEqual(later, new Order(5)));
