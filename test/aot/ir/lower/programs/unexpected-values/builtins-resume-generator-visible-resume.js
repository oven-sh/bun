// RUN: lower
// OPTIONS: builtin-modules

// Built ins resume a generator that visible callers resume with arrays.
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

// GENERATED: attempt pushes1
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: anything, v2: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Builtin builtin=GlobalThis
// CHECK-NEXT: v4 = PropGet v3 key="console" [isFreeName]
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v5 key="log"
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v8 = String string=" -> "
// CHECK-NEXT: v9 = Add v1, v8
// CHECK-NEXT: v10 = GetEnvironmentField v0 layout=[[L_1]] field=1
// CHECK-NEXT: v11 = Call v10, -, v2 calleeName="outcome"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v13 = Add v9, v12
// CHECK-NEXT: v14 = Call v7, v5, v13 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v15 = Undefined
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="pushes1"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, TakesCallee, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Generator<number> flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything, v1: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = Convert v3 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v5 = Integer
// CHECK-NEXT: v6 = Convert v5 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v4, v6)
// CHECK-NEXT: b2(v7, v8):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v10 = Integer integer=2
// CHECK-NEXT: v11 = Less v8, v10
// CHECK-NEXT: Branch v11 -> taken b3(| 0), notTaken b9(| 0)
// CHECK-NEXT: b3(v12):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v13 = Convert v7 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v14 = Yield v13
// CHECK-NEXT: v15 = ResultAt v14
// CHECK-NEXT: v16 = ResultAt v14 index=1
// CHECK-NEXT: Switch v16 cases=[1, 2] -> case b5(), case b6(), otherwise b7()
// CHECK-NEXT: b5():
// CHECK-NEXT: Throw v15
// CHECK-NEXT: b6():
// CHECK-NEXT: Return v15
// CHECK-NEXT: b7():
// CHECK-NEXT: v17 = PropGet v15 key="push"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v19 = Integer integer=1
// CHECK-NEXT: v20 = Call v18, v15, v19 calleeKey="push" calleeName="a.push"
// CHECK-NEXT: v21 = PropGet v15 key="length"
// CHECK-NEXT: v22 = Add v7, v21
// CHECK-NEXT: v23 = Convert v22 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: v24 = Increment v12
// CHECK-NEXT: v25 = Convert v24 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v23, v25)
// CHECK-NEXT: b9(v26):
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
