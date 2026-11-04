// The members that statements lay on the prototype object of a constructor function are replaced by code that the build has not seen, by the two ways of the engine that store by an offset and look nothing up:
// a store under the key of a for-in loop over the very object, and what a reviver of JSON.parse returns for a member of an object that it has planted in the tree.
function Base() {}
Base.prototype.read = function () {
  return 3;
};

function Message(n) {
  this.n = n;
}
Message.prototype = Object.create(Base.prototype);
Message.prototype.twice = function () {
  return this.n * 2;
};
Message.prototype.thrice = function () {
  return this.n * 3;
};

function total(count, change) {
  let sum = 0;
  for (let turn = 0; turn < count; turn++) {
    const made = new Message(1);
    if (turn === 5) change(made);
    sum += made.twice() + made.thrice() + made.read();
  }
  return sum;
}

const nothing = () => {};
for (let turn = 0; turn < 50; turn++) total(10, nothing);
console.log(total(10, nothing));

const byLoop = (0, eval)("made => { const holder = Object.getPrototypeOf(made); for (const key in holder) { if (Object.hasOwn(holder, key)) holder[key] = () => 100; } }");
console.log(total(10, byLoop), total(10, nothing));

const byReviver = (0, eval)(
  "made => { const holder = Object.getPrototypeOf(made); JSON.parse('{\"first\":1,\"second\":2}', function (key, value) { if (key === 'first') this.second = holder; return typeof value === 'function' ? () => 1000 : value; }); }",
);
console.log(total(10, byReviver), total(10, nothing));
