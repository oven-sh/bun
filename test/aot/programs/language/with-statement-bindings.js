// Names under `with`: which object or variable a read, a store and `typeof` reach, what `Symbol.unscopables` hides, which traps of a proxy run, and errors thrown by the lookup. `var x = e` resolves `x` before it evaluates `e`.
var outer = "outer";
var values = "outer values";
var hidden = "outer hidden";

var plain = { inner: 1, method() { return this === plain; } };
with (plain) {
  console.log(inner, outer, method());
  inner = 2;
  outer = "stored outward";
  console.log(typeof absent);
}
console.log(plain.inner, outer, Object.keys(plain));

var blocked = { hidden: "object hidden", visible: "object visible", [Symbol.unscopables]: { hidden: true, visible: false } };
with (blocked) {
  console.log(hidden, visible);
  hidden = "stored outward";
}
console.log(hidden, blocked.hidden);

var notAnObject = { hidden: "shown", [Symbol.unscopables]: 1 };
with (notAnObject) console.log(hidden);

with ([1, 2]) {
  console.log(values, length, typeof push, typeof keys);
}

var log = [];
var target = { logged: 1, [Symbol.unscopables]: { skipped: true }, skipped: 2 };
var proxy = new Proxy(target, {
  has(object, key) {
    log.push("has " + String(key));
    return key in object;
  },
  get(object, key) {
    log.push("get " + String(key));
    return object[key];
  },
});
var skipped = "outer skipped";
with (proxy) {
  console.log(logged, skipped, outer);
  console.log(typeof missing);
}
console.log(log.join("\n"));

var throwing = new Proxy({}, {
  has() {
    throw new RangeError("has threw");
  },
});
try {
  with (throwing) console.log(outer);
} catch (error) {
  console.log(error.name, error.message);
}

var throwingUnscopables = {
  outer: "object outer",
  get [Symbol.unscopables]() {
    throw new RangeError("unscopables threw");
  },
};
try {
  with (throwingUnscopables) console.log(outer);
} catch (error) {
  console.log(error.name, error.message);
}

try {
  with ({}) console.log(neverBound);
} catch (error) {
  console.log(error.name + ": " + error.message);
}

var emptied = { assigned: 0 };
with (emptied) {
  var assigned = (delete emptied.assigned, 1);
}
console.log(emptied.assigned, assigned);
