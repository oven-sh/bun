// A site settles on one shape, and then what it read changes under it: properties are added, deleted, redefined and moved, prototypes change, and shapes die in a collection while new ones take their place.
function read(object) {
  return object.value;
}

function settle(object) {
  let last;
  for (let i = 0; i < 300; i++) last = read(object);
  return last;
}

function note(what, object) {
  console.log(what + ": " + String(read(object)));
}

{
  const object = { first: 1, value: "own" };
  settle(object);
  note("settled", object);
  object.added = 2;
  note("another was added", object);
  settle(object);
  delete object.first;
  note("another was deleted", object);
  settle(object);
  delete object.value;
  note("it was deleted", object);
  object.value = "again";
  note("it came back", object);
  settle(object);
  Object.defineProperty(object, "value", { get() { return "computed"; }, configurable: true });
  note("it is a getter", object);
  settle(object);
  Object.defineProperty(object, "value", { value: "data again", writable: true, configurable: true });
  note("it is data again", object);
  settle(object);
  Object.freeze(object);
  note("frozen", object);
}

{
  const first = { value: "first", other: 1 };
  const second = { other: 1, value: "second" };
  settle(first);
  note("the names in another order", second);
  settle(second);
  note("the first order again", first);
}

{
  const grown = { value: "in the cell" };
  settle(grown);
  for (let i = 0; i < 60; i++) grown["more" + i] = i;
  note("sixty more", grown);
  settle(grown);
  delete grown.value;
  grown.value = "outside the cell";
  note("added behind them", grown);
  settle(grown);
  note("settled outside the cell", grown);
  note("one in the cell after it", { value: "in the cell again" });
}

{
  const parent = { value: "inherited" };
  const child = Object.create(parent);
  settle(child);
  parent.value = "changed above";
  note("the parent's changed", child);
  settle(child);
  delete parent.value;
  note("the parent's is gone", child);
  settle(child);
  Object.setPrototypeOf(child, { value: "of another parent" });
  note("another parent", child);
  settle(child);
  child.value = "its own now";
  note("its own", child);
  settle(child);
  delete child.value;
  note("the parent's again", child);
}

class Point {
  constructor(value) {
    this.value = value;
  }
}
{
  const point = new Point("field");
  settle(point);
  note("of a class", point);
  point.extra = 1;
  note("with an extra property", point);
  settle(point);
  delete point.value;
  note("deleted from it", point);
  Point.prototype.value = "of the class's prototype";
  note("found above", point);
  settle(point);
  point.value = 7;
  note("a number now", point);
  delete Point.prototype.value;
}

function make(number) {
  const object = {};
  object["only" + number] = number;
  object.value = "value " + number;
  return object;
}
let wrong = 0;
for (let round = 0; round < 12; round++) {
  for (let i = 0; i < 150; i++) {
    const number = round * 150 + i;
    const object = make(number);
    for (let turn = 0; turn < 40; turn++) {
      if (read(object) !== "value " + number) wrong++;
    }
  }
  if (typeof Bun !== "undefined") Bun.gc(true);
  if (read({ a: round, value: round }) !== round) wrong++;
}
console.log("wrong answers while shapes came and went: " + wrong);
