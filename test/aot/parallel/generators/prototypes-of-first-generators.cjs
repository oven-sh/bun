"use strict";
// The `prototype` of a generator function is the object its generators inherit, whichever is asked for first.
const lines = [];
const say = (...parts) => lines.push(parts.map(String).join(" "));

function makeGenerator(step) {
  return function* steps() {
    yield step;
    yield step + 1;
  };
}
function makeAsyncGenerator(step) {
  return async function* steps() {
    yield step;
  };
}
class Holder {
  constructor(base) {
    this.base = base;
  }
  *items() {
    yield this.base;
  }
}
const kept = [];
for (let round = 0; round < 40; round++) {
  const make = makeGenerator(round);
  const first = make();
  const second = make();
  kept.push(first);
  if (round % 4 === 0) {
    say(round, Object.getPrototypeOf(first) === make.prototype, Object.getPrototypeOf(second) === make.prototype, first instanceof make);
  } else if (round % 4 === 1) {
    make.prototype.extra = round;
    say(round, first.extra, second.extra, make().extra, "extra" in kept[0], Object.keys(make.prototype).join());
  } else if (round % 4 === 2) {
    const before = Object.getPrototypeOf(first);
    make.prototype = { replaced: round };
    const third = make();
    say(round, before === make.prototype, third.replaced, first.replaced, typeof third.next, typeof first.next);
  } else {
    const parent = Object.getPrototypeOf(Object.getPrototypeOf(first));
    say(round, parent === Object.getPrototypeOf(make.prototype), Object.getOwnPropertyNames(make).join(), JSON.stringify(Object.getOwnPropertyDescriptor(make, "prototype")));
  }
  say([...first].join(), second.next().value);
}
for (let round = 0; round < 8; round++) {
  const make = makeAsyncGenerator(round);
  const first = make();
  say(round, Object.getPrototypeOf(first) === make.prototype, first instanceof make, make() instanceof make, Object.getPrototypeOf(make.prototype) === Object.getPrototypeOf(Object.getPrototypeOf(first)));
  if (round % 2) {
    make.prototype = null;
    say(Object.getPrototypeOf(make()) === Object.getPrototypeOf(Object.getPrototypeOf(first)));
  }
}
for (let round = 0; round < 4; round++) {
  const holder = new Holder(round);
  const first = holder.items();
  say(Object.getPrototypeOf(first) === Holder.prototype.items.prototype, first.next().value);
}
for (let round = 0; round < 6; round++) {
  const make = makeGenerator(round);
  if (round % 2) make.tag = round;
  else Object.defineProperty(make, "name", { value: "renamed" + round });
  const first = make();
  say(make.name, make.tag, first instanceof make, Object.getPrototypeOf(first) === make.prototype, Object.getOwnPropertyNames(make).sort().join());
}
const frozen = makeGenerator(3);
const before = frozen();
Object.freeze(frozen);
say(Object.isFrozen(frozen), Object.getPrototypeOf(before) === frozen.prototype, frozen() instanceof frozen);
const bound = makeGenerator(4).bind(null);
say(Object.getPrototypeOf(Object.getPrototypeOf(bound())) === Object.getPrototypeOf(frozen.prototype), bound.prototype);

const await_ = function (thisValue, parameters, generator) {
  return new Promise((resolve, reject) => {
    const fulfilled = value => {
      try {
        step(generator.next(value));
      } catch (error) {
        reject(error);
      }
    };
    const step = result => (result.done ? resolve(result.value) : Promise.resolve(result.value).then(fulfilled, reject));
    step((generator = generator.apply(thisValue, parameters || [])).next());
  });
};
const work = value => await_(undefined, undefined, function* () {
  const first = yield value;
  const second = yield Promise.resolve(first + 1);
  return first + second;
});
(async () => {
  let sum = 0;
  for (let i = 0; i < 200; i++) sum += await work(i);
  say(sum);
  console.log(lines.join("\n"));
})();
