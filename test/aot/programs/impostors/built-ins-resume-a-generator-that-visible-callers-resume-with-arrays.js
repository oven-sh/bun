"use strict";

const log = [];

function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (value instanceof Error) return value.constructor.name;
  const parent = Object.getPrototypeOf(value);
  const kind = parent === Object.prototype || parent === Array.prototype ? "" : parent === null ? "bare " : parent.constructor.name + " ";
  const isList = Array.isArray(value);
  const parts = [];
  if (isList) for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
  for (const key of Reflect.ownKeys(value)) {
    if (isList && typeof key === "string" && (key === "length" || /^\d+$/.test(key))) continue;
    parts.push(String(key) + ": " + show(value[key]));
  }
  return kind + (isList ? "[" : "{") + parts.join(", ") + (isList ? "]" : "}");
}

function outcome(run) {
  log.length = 0;
  try {
    const value = run();
    const effects = log.join(", ");
    return show(value) + (effects ? " | " + effects : "");
  } catch (error) {
    const effects = log.join(", ");
    return "threw " + show(error) + (effects ? " | " + effects : "");
  }
}

function attempt(label, run) {
  console.log(label + " -> " + outcome(run));
}

console.log("strict:", (function () { return this === undefined; })());

function* pushes1() {
  let total = 0;
  for (let i = 0; i < 2; i++) {
    const a = yield total;
    a.push(1);
    total += a.length;
  }
  return total;
}
attempt("a spread: resumed with arrays", () => {
  const g = pushes1();
  return [g.next().value, g.next([5, 6]).value, g.next([7]).value];
});
attempt("a spread", () => [...pushes1()]);
attempt("a spread: resumed with arrays again", () => {
  const g = pushes1();
  return [g.next().value, g.next([5, 6]).value, g.next([7]).value];
});

function* pushes2() {
  let total = 0;
  for (let i = 0; i < 2; i++) {
    const a = yield total;
    a.push(1);
    total += a.length;
  }
  return total;
}
attempt("for-of: resumed with arrays", () => {
  const g = pushes2();
  return [g.next().value, g.next([5, 6]).value, g.next([7]).value];
});
attempt("for-of", () => (() => { const seen = []; for (const x of pushes2()) seen.push(x); return seen; })());
attempt("for-of: resumed with arrays again", () => {
  const g = pushes2();
  return [g.next().value, g.next([5, 6]).value, g.next([7]).value];
});

function* pushes3() {
  let total = 0;
  for (let i = 0; i < 2; i++) {
    const a = yield total;
    a.push(1);
    total += a.length;
  }
  return total;
}
attempt("Array.from: resumed with arrays", () => {
  const g = pushes3();
  return [g.next().value, g.next([5, 6]).value, g.next([7]).value];
});
attempt("Array.from", () => Array.from(pushes3()));
attempt("Array.from: resumed with arrays again", () => {
  const g = pushes3();
  return [g.next().value, g.next([5, 6]).value, g.next([7]).value];
});

function* pushes4() {
  let total = 0;
  for (let i = 0; i < 2; i++) {
    const a = yield total;
    a.push(1);
    total += a.length;
  }
  return total;
}
attempt("destructuring: resumed with arrays", () => {
  const g = pushes4();
  return [g.next().value, g.next([5, 6]).value, g.next([7]).value];
});
attempt("destructuring", () => (([first, second]) => [first, second])(pushes4()));
attempt("destructuring: resumed with arrays again", () => {
  const g = pushes4();
  return [g.next().value, g.next([5, 6]).value, g.next([7]).value];
});

function* pushes5() {
  let total = 0;
  for (let i = 0; i < 2; i++) {
    const a = yield total;
    a.push(1);
    total += a.length;
  }
  return total;
}
attempt("a set: resumed with arrays", () => {
  const g = pushes5();
  return [g.next().value, g.next([5, 6]).value, g.next([7]).value];
});
attempt("a set", () => new Set(pushes5()).size);
attempt("a set: resumed with arrays again", () => {
  const g = pushes5();
  return [g.next().value, g.next([5, 6]).value, g.next([7]).value];
});

function* pushes6() {
  let total = 0;
  for (let i = 0; i < 2; i++) {
    const a = yield total;
    a.push(1);
    total += a.length;
  }
  return total;
}
attempt("spread arguments: resumed with arrays", () => {
  const g = pushes6();
  return [g.next().value, g.next([5, 6]).value, g.next([7]).value];
});
attempt("spread arguments", () => Math.max(...pushes6()));
attempt("spread arguments: resumed with arrays again", () => {
  const g = pushes6();
  return [g.next().value, g.next([5, 6]).value, g.next([7]).value];
});

function* pushes7() {
  let total = 0;
  for (let i = 0; i < 2; i++) {
    const a = yield total;
    a.push(1);
    total += a.length;
  }
  return total;
}
attempt("yield*: resumed with arrays", () => {
  const g = pushes7();
  return [g.next().value, g.next([5, 6]).value, g.next([7]).value];
});
attempt("yield*", () => [...(function* () { yield* pushes7(); })()]);
attempt("yield*: resumed with arrays again", () => {
  const g = pushes7();
  return [g.next().value, g.next([5, 6]).value, g.next([7]).value];
});

function* pushes8() {
  let total = 0;
  for (let i = 0; i < 2; i++) {
    const a = yield total;
    a.push(1);
    total += a.length;
  }
  return total;
}
attempt("yield* resumed with a text: resumed with arrays", () => {
  const g = pushes8();
  return [g.next().value, g.next([5, 6]).value, g.next([7]).value];
});
attempt("yield* resumed with a text", () => (() => { const outer = (function* () { return yield* pushes8(); })(); return [outer.next("ignored"), outer.next("a text"), outer.next("a text")].map(step => step.value); })());
attempt("yield* resumed with a text: resumed with arrays again", () => {
  const g = pushes8();
  return [g.next().value, g.next([5, 6]).value, g.next([7]).value];
});

function* pushes9() {
  let total = 0;
  for (let i = 0; i < 2; i++) {
    const a = yield total;
    a.push(1);
    total += a.length;
  }
  return total;
}
attempt("an iterator helper: resumed with arrays", () => {
  const g = pushes9();
  return [g.next().value, g.next([5, 6]).value, g.next([7]).value];
});
attempt("an iterator helper", () => pushes9().map(x => x).toArray());
attempt("an iterator helper: resumed with arrays again", () => {
  const g = pushes9();
  return [g.next().value, g.next([5, 6]).value, g.next([7]).value];
});

function* pushes10() {
  let total = 0;
  for (let i = 0; i < 2; i++) {
    const a = yield total;
    a.push(1);
    total += a.length;
  }
  return total;
}
attempt("next taken off and called by a built-in: resumed with arrays", () => {
  const g = pushes10();
  return [g.next().value, g.next([5, 6]).value, g.next([7]).value];
});
attempt("next taken off and called by a built-in", () => (g => [[5, 6], "a text", 7].map(g.next, g).map(step => step.value))(pushes10()));
attempt("next taken off and called by a built-in: resumed with arrays again", () => {
  const g = pushes10();
  return [g.next().value, g.next([5, 6]).value, g.next([7]).value];
});

function* pushes11() {
  let total = 0;
  for (let i = 0; i < 2; i++) {
    const a = yield total;
    a.push(1);
    total += a.length;
  }
  return total;
}
attempt("Reflect.apply of next: resumed with arrays", () => {
  const g = pushes11();
  return [g.next().value, g.next([5, 6]).value, g.next([7]).value];
});
attempt("Reflect.apply of next", () => (g => [Reflect.apply(g.next, g, []), Reflect.apply(g.next, g, ["a text"])].map(step => step.value))(pushes11()));
attempt("Reflect.apply of next: resumed with arrays again", () => {
  const g = pushes11();
  return [g.next().value, g.next([5, 6]).value, g.next([7]).value];
});

function* pushes12() {
  let total = 0;
  for (let i = 0; i < 2; i++) {
    const a = yield total;
    a.push(1);
    total += a.length;
  }
  return total;
}
attempt("next without a value: resumed with arrays", () => {
  const g = pushes12();
  return [g.next().value, g.next([5, 6]).value, g.next([7]).value];
});
attempt("next without a value", () => (g => [g.next(), g.next(), g.next()].map(step => step.value))(pushes12()));
attempt("next without a value: resumed with arrays again", () => {
  const g = pushes12();
  return [g.next().value, g.next([5, 6]).value, g.next([7]).value];
});
