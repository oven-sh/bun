// Member lookups after prototype chain changes.
const log = [];

function Base() {}
const shared = {
  tag() {
    return "shared";
  },
};
Base.prototype = shared;

class Leaf extends Base {}

function redefineOnPrototypeLiteral(x, holder) {
  const first = x.tag();
  Object.defineProperty(holder, "tag", {
    value() {
      return "redefined";
    },
    configurable: true,
    writable: true,
  });
  return first + "," + x.tag();
}

class Widget {
  draw() {
    return "draw";
  }
}

function getterLiteralBelowClass(w) {
  const first = w.draw();
  const o = {
    __proto__: Widget.prototype,
    get draw() {
      return () => "own getter";
    },
  };
  return first + "," + o.draw() + "," + w.draw();
}

function literalInsertedIntoChain(w, k) {
  const first = w.draw();
  const middle = {
    get draw() {
      return () => "middle " + k;
    },
  };
  Object.setPrototypeOf(middle, Widget.prototype);
  Object.setPrototypeOf(w, middle);
  return first + "," + w.draw();
}

function copyInsertedIntoChain(w, source) {
  const first = w.draw();
  const middle = { ...source };
  Object.setPrototypeOf(middle, Widget.prototype);
  Object.setPrototypeOf(w, middle);
  return first + "," + w.draw();
}

class Hidden extends Widget {
  draw = () => "field";
}

function fieldHidesMethod(w) {
  const first = w.draw();
  const h = new Hidden();
  return first + "," + h.draw() + "," + w.draw();
}

function assignOntoPrototype(w, source) {
  const first = w.draw();
  Object.assign(Widget.prototype, source);
  return first + "," + w.draw();
}

for (let round = 0; round < 3; round++) {
  log.push(redefineOnPrototypeLiteral(new Leaf(), shared));
  log.push(getterLiteralBelowClass(new Widget()));
  log.push(literalInsertedIntoChain(new Widget(), round));
  log.push(copyInsertedIntoChain(new Widget(), { draw: () => "copied " + round }));
  log.push(fieldHidesMethod(new Widget()));
}
log.push(assignOntoPrototype(new Widget(), { draw: () => "assigned" }));
log.push(new Widget().draw());
console.log(log.join("\n"));
