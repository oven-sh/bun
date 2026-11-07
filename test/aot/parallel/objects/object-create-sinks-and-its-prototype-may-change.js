// Object.create(p) whose object does not outlive the function. What it reads and stores goes through p, and p may
// change at any turn: the object must see the prototype it was made below, whether it was ever built or not.
const out = [];
function say(...values) {
  out.push(values.join(" "));
}

const plain = {
  legs: 4,
  describe() {
    return this.legs * 2;
  },
};
function viaPlain(i) {
  const dog = Object.create(plain);
  dog.legs = i & 7;
  return dog.describe();
}
let sum = 0;
for (let i = 0; i < 3000; i++) sum += viaPlain(i);
say("plain", sum);
plain.describe = function () {
  return this.legs * 3;
};
say("method replaced", viaPlain(5));
Object.defineProperty(plain, "legs", {
  get() {
    return 100;
  },
  set(value) {
    say("setter saw", value);
  },
  configurable: true,
});
say("accessor above", viaPlain(6));
delete plain.legs;
say("accessor gone", viaPlain(6));
Object.freeze(plain);
say("frozen above", viaPlain(6));

// Two objects handed in at one place.
const first = {
  value: 1,
  read() {
    return this.value + 1;
  },
};
const second = {
  value: 2,
  read() {
    return this.value + 2;
  },
};
function viaEither(proto, i) {
  const made = Object.create(proto);
  made.value = i;
  return made.read();
}
sum = 0;
for (let i = 0; i < 3000; i++) sum += viaEither(i & 1 ? first : second, i);
say("either", sum);
sum = 0;
for (let i = 0; i < 3000; i++) sum += viaEither(first, i);
say("first", sum);

// Fields read before any store, from above.
const defaults = {
  a: 1,
  b: "b",
};
function readsAbove(i) {
  const made = Object.create(defaults);
  const before = made.a;
  made.a = i;
  return before + made.a + made.b;
}
let text = "";
for (let i = 0; i < 2000; i++) text = readsAbove(i);
say(text);
defaults.a = 9;
say(readsAbove(1));
Object.setPrototypeOf(defaults, {
  c: "c",
});
function readsHigher() {
  return Object.create(defaults).c;
}
say(readsHigher());

// The object gets out on one way only.
const kept = [];
const shared = {
  n: 0,
  twice() {
    return this.n * 2;
  },
};
function escapesAtTimes(i) {
  const made = Object.create(shared);
  made.n = i;
  if (i % 1000 === 999) kept.push(made);
  return made.twice();
}
sum = 0;
for (let i = 0; i < 4000; i++) sum += escapesAtTimes(i);
say("kept", sum, kept.length, kept.map(o => o.n).join(), Object.getPrototypeOf(kept[0]) === shared, Object.keys(kept[1]).join());

// Asked of the object itself.
const asked = {
  x: 1,
};
function askedOf(i) {
  const made = Object.create(asked);
  made.y = i;
  return [Object.getPrototypeOf(made) === asked, "x" in made, Object.hasOwn(made, "x"), made.y, asked.isPrototypeOf(made)].join();
}
for (let i = 0; i < 2000; i++) text = askedOf(i);
say(text);

// A prototype that is itself made by Object.create, a function, an array, and one made anew each turn.
const middle = Object.create({
  top() {
    return "top" + this.k;
  },
});
function below(i) {
  const made = Object.create(middle);
  made.k = i;
  return made.top();
}
for (let i = 0; i < 2000; i++) text = below(i);
say(text);
function belowFunction(i) {
  const made = Object.create(Array.prototype);
  made.length = i & 3;
  return made.length + made.concat === Array.prototype.concat;
}
for (let i = 0; i < 2000; i++) text = belowFunction(i);
say(text);
function belowNew(i) {
  const proto = {
    v: i,
    get() {
      return this.v;
    },
  };
  const made = Object.create(proto);
  return made.get();
}
sum = 0;
for (let i = 0; i < 2000; i++) sum += belowNew(i);
say("anew", sum);
function belowNull(i) {
  const made = Object.create(null);
  made.v = i;
  return made.v + ("toString" in made ? 1 : 0);
}
sum = 0;
for (let i = 0; i < 2000; i++) sum += belowNull(i);
say("null", sum);
function refused(value) {
  try {
    return Object.create(value);
  } catch (error) {
    return error.constructor.name + ": " + error.message;
  }
}
say(refused(1), refused(undefined), typeof refused({}));
console.log(out.join("\n"));
