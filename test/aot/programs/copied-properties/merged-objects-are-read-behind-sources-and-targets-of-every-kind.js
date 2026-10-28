// `{ ...defaults, ...options }` and `Object.assign({}, defaults, options)` are read field by field, listed and printed,
// where the sources hold getters, symbols, indexes and "__proto__", where a source is absent or changes, and where the target has setters or is frozen or sealed.
const log = [];
function show(label, merged) {
  console.log(
    label,
    merged.a,
    merged.b,
    merged.c,
    merged.a * merged.b - merged.c,
    Object.keys(merged).join(),
    JSON.stringify(merged),
  );
  console.log(
    label,
    "a" in merged,
    Object.hasOwn(merged, "b"),
    Object.hasOwn(merged, "c"),
    Reflect.ownKeys(merged).map(String).join(),
  );
}
function sumOf(merged) {
  let sum = 0;
  for (let turn = 0; turn < 100; turn++) sum = (sum + merged.a * merged.b - merged.c) | 0;
  return sum;
}

const defaults = { a: 1, b: 2 };
function spreadPlain(options) {
  return { ...defaults, ...options };
}
function assignPlain(options) {
  return Object.assign({}, defaults, options);
}
show("spread", spreadPlain({ c: 3 }));
show("assign", assignPlain({ c: 3 }));
console.log(sumOf(spreadPlain({ c: 3 })), sumOf(assignPlain({ c: 3 })));

function spreadMaybe(options) {
  return { ...defaults, ...options };
}
function assignMaybe(options) {
  return Object.assign({}, defaults, options);
}
for (const options of [{ c: 3 }, undefined, null, {}, { c: undefined }, 7, "xy", true, [5, 6]]) {
  show("spread maybe", spreadMaybe(options));
  show("assign maybe", assignMaybe(options));
  console.log(sumOf(spreadMaybe(options)), sumOf(assignMaybe(options)));
}

const withGetter = {
  a: 1,
  get b() {
    log.push("b is read");
    return 2;
  },
};
function spreadGetter(options) {
  return { ...withGetter, ...options };
}
function assignGetter(options) {
  return Object.assign({}, withGetter, options);
}
show("spread getter", spreadGetter({ c: 3 }));
show("assign getter", assignGetter({ c: 3 }));
console.log(Object.getOwnPropertyDescriptor(spreadGetter({ c: 3 }), "b"), log.join());

const throwing = {
  a: 1,
  get b() {
    throw new Error("no b");
  },
  c: 3,
};
let kept;
function assignThrowing() {
  kept = {};
  return Object.assign(kept, throwing);
}
function spreadThrowing() {
  return { ...throwing };
}
function assignFreshThrowing() {
  return Object.assign({}, defaults, throwing);
}
for (const make of [assignThrowing, spreadThrowing, assignFreshThrowing]) {
  try {
    show("threw not", make());
  } catch (error) {
    console.log(make.name, error.message, JSON.stringify(kept));
  }
}

const removing = {
  a: 1,
  get b() {
    delete removing.c;
    return 2;
  },
  c: 3,
};
function spreadRemoving() {
  return { ...removing };
}
show("a getter removes the next name", spreadRemoving());
const removingAgain = {
  a: 1,
  get b() {
    delete removingAgain.c;
    return 2;
  },
  c: 3,
};
function assignRemoving() {
  return Object.assign({}, removingAgain);
}
show("a getter removes the next name", assignRemoving());

const local = Symbol("local");
const withSymbol = { a: 1, [local]: "s", b: 2, 1: "one", 0: "zero" };
function spreadSymbol(options) {
  return { ...withSymbol, ...options };
}
function assignSymbol(options) {
  return Object.assign({}, withSymbol, options);
}
show("spread symbol", spreadSymbol({ c: 3 }));
show("assign symbol", assignSymbol({ c: 3 }));
console.log(spreadSymbol({ c: 3 }), assignSymbol({ c: 3 }));

const withProto = { a: 1, b: 2, ["__proto__"]: { c: "inherited" } };
function spreadProto() {
  return { ...withProto };
}
function assignProto() {
  return Object.assign({}, withProto);
}
show("spread __proto__", spreadProto());
show("assign __proto__", assignProto());
console.log(
  Object.getPrototypeOf(spreadProto()) === Object.prototype,
  Object.getPrototypeOf(assignProto()) === Object.prototype,
);

const hidden = Object.defineProperty({ a: 1, b: 2 }, "c", { value: 3, enumerable: false });
function spreadHidden() {
  return { ...hidden };
}
function assignHidden() {
  return Object.assign({}, hidden);
}
show("spread hidden", spreadHidden());
show("assign hidden", assignHidden());
const madeHidden = { a: 1, b: 2, c: 3 };
function spreadMadeHidden() {
  return { ...defaults, ...madeHidden };
}
function assignMadeHidden() {
  return Object.assign({}, defaults, madeHidden);
}
show("before", spreadMadeHidden());
show("before", assignMadeHidden());
Object.defineProperty(madeHidden, "c", { enumerable: false });
show("after", spreadMadeHidden());
show("after", assignMadeHidden());

const shrinking = { a: 1, b: 2, c: 3 };
function spreadShrinking() {
  return { ...shrinking };
}
function assignShrinking() {
  return Object.assign({}, shrinking);
}
const early = [spreadShrinking(), assignShrinking()];
delete shrinking.b;
shrinking.a = "text";
const late = [spreadShrinking(), assignShrinking()];
for (const merged of [...early, ...late]) show("a source that changes", merged);
console.log(sumOf(early[0]), sumOf(early[1]), sumOf(late[0]), sumOf(late[1]));

function assignOntoSetter(options) {
  const target = {
    set a(value) {
      log.push("a is set to " + value);
    },
    b: 0,
  };
  return Object.assign(target, defaults, options);
}
show("a setter of the target", assignOntoSetter({ c: 3 }));
console.log(log.join());
for (const close of [Object.freeze, Object.seal, Object.preventExtensions]) {
  try {
    show(close.name, Object.assign(close({ a: 0, b: 0 }), defaults, { c: 3 }));
  } catch (error) {
    console.log(close.name, error.constructor.name);
  }
  try {
    show(close.name, Object.assign(close({}), defaults));
  } catch (error) {
    console.log(close.name, error.constructor.name);
  }
  show(close.name, { ...close({ a: 5, b: 6 }), ...{ c: 7 } });
}

function changedLater(options) {
  const merged = { ...defaults, ...options };
  const assigned = Object.assign({}, defaults, options);
  delete merged.a;
  delete assigned.b;
  return [merged, assigned];
}
for (const merged of changedLater({ c: 3 })) show("a name is deleted from the copy", merged);

function nested(options) {
  return Object.assign(Object.assign({}, defaults), options, { d: 4 });
}
show("one assignment in another", nested({ c: 3 }));
function copyOfCopy(options) {
  return { ...spreadPlain(options), ...assignPlain({ c: 9 }) };
}
show("a copy of copies", copyOfCopy({ c: 3 }));
function withMembers(options) {
  return {
    z: 0,
    ...defaults,
    a: "late",
    ...options,
    get c() {
      return "got";
    },
  };
}
show("members between spreads", withMembers({ c: 3 }));
function conditional(flag, options) {
  return { ...defaults, ...(flag && options), ...(flag ? { d: 1 } : { e: 2 }) };
}
show("a spread that may be left out", conditional(true, { c: 3 }));
show("a spread that may be left out", conditional(false, { c: 3 }));

const above = {
  set c(value) {
    log.push("c arrives above: " + value);
  },
  get c() {
    return "from above";
  },
};
function spreadBelow(options) {
  return { __proto__: above, ...defaults, ...options };
}
function assignBelow(options) {
  return Object.assign({ __proto__: above }, defaults, options);
}
show("a setter above, spread", spreadBelow({ c: 3 }));
show("a setter above, assigned", assignBelow({ c: 3 }));
console.log(log.join());
const fixedAbove = Object.freeze({ b: "fixed" });
function assignBelowFixed(options) {
  "use strict";
  return Object.assign({ __proto__: fixedAbove }, defaults, options);
}
try {
  show("a name that is read-only above", assignBelowFixed({ c: 3 }));
} catch (error) {
  console.log(error.constructor.name);
}
