// Each helper makes an object, stores into it under names, and returns it; the caller reads the names. Between the store and the return
// something else gets at the object: an alias, an array that holds it, a callee, a closure, a built-in, a setter of its class, a delete.
// Whoever takes the stores that a helper lists under a name for all that the member can hold reads something else than the caller finds.
const kept = [];
const lines = [];
const set = (o, v) => {
  o.x = v;
};
const setUnder = (o, k, v) => {
  o[k] = v;
};
const forget = o => {
  delete o.x;
};
class WithAccessor {
  constructor(v) {
    this.x = v;
    this.y = v;
  }
  get x() {
    return "from the getter";
  }
  set x(v) {
    kept.push(v);
  }
}
class Plain {
  x = "from the initializer";
  constructor(v, c) {
    if (c) this.x = v;
    this.y = v;
  }
}
class Heir extends Plain {
  constructor(v, w) {
    super(v, true);
    this.x = w;
  }
}
class AnswersAnother {
  constructor(o) {
    this.x = "of this";
    return o;
  }
}
const plain = (a, b) => ({ x: a, y: b });
const twice = (a, b) => ({ x: a, x: b });
const storedLater = (a, b) => {
  const o = { x: a };
  o.x = b;
  return o;
};
const storedOnOnePath = (a, b, c) => {
  const o = { x: a };
  if (c) o.x = b;
  return o;
};
const bornOnOnePath = (a, b, c) => {
  const o = {};
  if (c) o.x = b;
  return o;
};
const throughAnAlias = (a, b) => {
  const o = { x: a };
  const alias = o;
  alias.x = b;
  return o;
};
const throughAnArray = (a, b) => {
  const o = { x: a };
  const list = [o];
  list[0].x = b;
  return o;
};
const throughAnotherObject = (a, b) => {
  const o = { x: a };
  const holder = { held: o };
  holder.held.x = b;
  return o;
};
const byACallee = (a, b) => {
  const o = { x: a };
  set(o, b);
  return o;
};
const byACalleeUnderAKey = (a, b, c) => {
  const o = { x: a };
  setUnder(o, c ? "x" : "z", b);
  return o;
};
const byAClosure = (a, b) => {
  const o = { x: a };
  const store = () => {
    o.x = b;
  };
  store();
  return o;
};
const byAClosureThatIsKept = (a, b) => {
  const o = { x: a };
  kept.push(() => {
    o.x = b;
  });
  return o;
};
const underAComputedKey = (a, b, c) => {
  const o = { x: a };
  o[c ? "x" : "y"] = b;
  return o;
};
const deleted = (a, b, c) => {
  const o = { x: a, y: b };
  if (c) delete o.x;
  return o;
};
const deletedByACallee = (a, b, c) => {
  const o = { x: a, y: b };
  if (c) forget(o);
  return o;
};
const assigned = (a, b) => Object.assign({ x: a }, { x: b });
const defined = (a, b) => Object.defineProperty({ x: a }, "x", { value: b });
const definedAsGetter = (a, b) => Object.defineProperty({ x: a }, "x", { get: () => b });
const reflected = (a, b) => {
  const o = { x: a };
  Reflect.set(o, "x", b);
  return o;
};
const frozen = (a, b) => {
  const o = Object.freeze({ x: a });
  try {
    o.x = b;
  } catch {}
  return o;
};
const getterInTheLiteral = (a, b) => ({
  get x() {
    return b;
  },
  y: a,
});
const setterInTheLiteral = (a, b) => {
  const o = {
    set x(v) {
      this.y = v;
    },
    y: a,
  };
  o.x = b;
  return o;
};
const inAFinally = (a, b, c) => {
  const o = { x: a };
  try {
    if (c) throw o;
    return o;
  } catch (e) {
    return e;
  } finally {
    o.x = b;
  }
};
const inALoop = (a, b, c) => {
  const o = { x: a };
  for (let i = 0; i < (c ? 2 : 0); i++) o.x = i ? b : "first round";
  return o;
};
const swapped = (a, b) => {
  const o = { x: a, y: b };
  [o.x, o.y] = [o.y, o.x];
  return o;
};
const itself = a => {
  const o = { x: a };
  o.x = o;
  return o;
};
const withAccessorOfTheClass = a => new WithAccessor(a);
const initializer = (a, b, c) => new Plain(a, c);
const heir = (a, b) => new Heir(a, b);
const anotherThanThis = (a, b) => new AnswersAnother({ x: b });
const primitiveInsteadOfThis = a => new AnswersAnother(a === undefined ? 1 : 2);
const name = v => (v === A ? "a" : v === B ? "b" : v === undefined ? "undefined" : typeof v === "object" ? "an object" : String(v));
const A = { tag: "a" };
const B = { tag: "b" };
const describe = r => "x=" + (r.x === r ? "itself" : name(r.x)) + " y=" + name(r.y) + (Object.hasOwn(r, "x") ? "" : " (x is not its own)");
// Each helper is called at a place of its own, by its name, and not as the last thing that the caller does.
const calls = [
  ["plain", c => describe(plain(A, B, c))],
  ["twice", c => describe(twice(A, B, c))],
  ["storedLater", c => describe(storedLater(A, B, c))],
  ["storedOnOnePath", c => describe(storedOnOnePath(A, B, c))],
  ["bornOnOnePath", c => describe(bornOnOnePath(A, B, c))],
  ["throughAnAlias", c => describe(throughAnAlias(A, B, c))],
  ["throughAnArray", c => describe(throughAnArray(A, B, c))],
  ["throughAnotherObject", c => describe(throughAnotherObject(A, B, c))],
  ["byACallee", c => describe(byACallee(A, B, c))],
  ["byACalleeUnderAKey", c => describe(byACalleeUnderAKey(A, B, c))],
  ["byAClosure", c => describe(byAClosure(A, B, c))],
  ["byAClosureThatIsKept", c => describe(byAClosureThatIsKept(A, B, c))],
  ["underAComputedKey", c => describe(underAComputedKey(A, B, c))],
  ["deleted", c => describe(deleted(A, B, c))],
  ["deletedByACallee", c => describe(deletedByACallee(A, B, c))],
  ["assigned", c => describe(assigned(A, B, c))],
  ["defined", c => describe(defined(A, B, c))],
  ["definedAsGetter", c => describe(definedAsGetter(A, B, c))],
  ["reflected", c => describe(reflected(A, B, c))],
  ["frozen", c => describe(frozen(A, B, c))],
  ["getterInTheLiteral", c => describe(getterInTheLiteral(A, B, c))],
  ["setterInTheLiteral", c => describe(setterInTheLiteral(A, B, c))],
  ["inAFinally", c => describe(inAFinally(A, B, c))],
  ["inALoop", c => describe(inALoop(A, B, c))],
  ["swapped", c => describe(swapped(A, B, c))],
  ["itself", c => describe(itself(A, B, c))],
  ["withAccessorOfTheClass", c => describe(withAccessorOfTheClass(A, B, c))],
  ["initializer", c => describe(initializer(A, B, c))],
  ["heir", c => describe(heir(A, B, c))],
  ["anotherThanThis", c => describe(anotherThanThis(A, B, c))],
  ["primitiveInsteadOfThis", c => describe(primitiveInsteadOfThis(A, B, c))],
];
for (const [title, call] of calls) {
  const seen = new Map();
  for (let i = 0; i < 300; i++) {
    const what = call(i % 3 === 0);
    seen.set(what, (seen.get(what) ?? 0) + 1);
  }
  lines.push(title + ": " + [...seen].map(([what, count]) => what + " x" + count).join(" | "));
}
const late = byAClosureThatIsKept(A, B);
const before = name(late.x);
for (const f of kept) if (typeof f === "function") f();
lines.push("a closure that is kept stores later: " + before + " then " + name(late.x));
lines.push("the setter of the class took " + kept.filter(v => v === A).length);
console.log(lines.join("\n"));
