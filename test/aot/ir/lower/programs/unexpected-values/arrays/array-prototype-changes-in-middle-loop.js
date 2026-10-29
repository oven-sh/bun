// RUN: lower
// OPTIONS: builtin-modules

// Array prototype changes in the middle of a loop.
function replacement() {
  return "replaced";
}

function* replacedIterator() {
  yield "replaced";
}

const loops = {
  push(change, restore, isReplaced) {
    const list = [];
    const wrong = [];
    for (let i = 0; i < 6; i++) {
      if (i === 2) change();
      if (i === 4) restore();
      const expected = isReplaced() ? "replaced" : list.length + 1;
      if (list.push(i) !== expected) wrong[wrong.length] = i;
    }
    return wrong;
  },
  pop(change, restore, isReplaced) {
    const list = [1, 2, 3, 4, 5, 6];
    const wrong = [];
    for (let i = 0; i < 6; i++) {
      if (i === 2) change();
      if (i === 4) restore();
      const expected = isReplaced() ? "replaced" : list[list.length - 1];
      if (list.pop() !== expected) wrong[wrong.length] = i;
    }
    return wrong;
  },
  map(change, restore, isReplaced) {
    const list = [1, 2];
    const wrong = [];
    for (let i = 0; i < 6; i++) {
      if (i === 2) change();
      if (i === 4) restore();
      const expected = isReplaced() ? "replaced" : "object";
      const result = list.map(value => value);
      if ((result === "replaced" ? result : typeof result) !== expected) wrong[wrong.length] = i;
    }
    return wrong;
  },
  forEach(change, restore, isReplaced) {
    const list = [1, 2];
    const wrong = [];
    for (let i = 0; i < 6; i++) {
      if (i === 2) change();
      if (i === 4) restore();
      const expected = isReplaced() ? 0 : 2;
      let visits = 0;
      list.forEach(() => visits++);
      if (visits !== expected) wrong[wrong.length] = i;
    }
    return wrong;
  },
  indexOf(change, restore, isReplaced) {
    const list = [1, 2];
    const wrong = [];
    for (let i = 0; i < 6; i++) {
      if (i === 2) change();
      if (i === 4) restore();
      const expected = isReplaced() ? "replaced" : 1;
      if (list.indexOf(2) !== expected) wrong[wrong.length] = i;
    }
    return wrong;
  },
  join(change, restore, isReplaced) {
    const list = [1, 2];
    const wrong = [];
    for (let i = 0; i < 6; i++) {
      if (i === 2) change();
      if (i === 4) restore();
      const expected = isReplaced() ? "replaced" : "1,2";
      if (list.join() !== expected) wrong[wrong.length] = i;
    }
    return wrong;
  },
  slice(change, restore, isReplaced) {
    const list = [1, 2];
    const wrong = [];
    for (let i = 0; i < 6; i++) {
      if (i === 2) change();
      if (i === 4) restore();
      const expected = isReplaced() ? "replaced" : 2;
      const result = list.slice();
      if ((result === "replaced" ? result : result.length) !== expected) wrong[wrong.length] = i;
    }
    return wrong;
  },
  [Symbol.iterator](change, restore, isReplaced) {
    const list = ["original"];
    const wrong = [];
    for (let i = 0; i < 6; i++) {
      if (i === 2) change();
      if (i === 4) restore();
      const expected = isReplaced() ? "replaced" : "original";
      let walked;
      for (const value of list) walked = value;
      const [taken] = list;
      const copied = [...list];
      if (walked !== expected || taken !== expected || copied[0] !== expected) wrong[wrong.length] = i;
    }
    return wrong;
  },
};

const inTheCallback = {
  forEach(change, restore, isReplaced) {
    const wrong = [];
    [0, 1, 2, 3, 4, 5].forEach(i => {
      if (i === 2) change();
      if (i === 4) restore();
      const expected = isReplaced() ? "replaced" : 1;
      if ([].push(i) !== expected) wrong[wrong.length] = i;
    });
    return wrong;
  },
  forOf(change, restore, isReplaced) {
    const wrong = [];
    for (const i of [0, 1, 2, 3, 4, 5]) {
      if (i === 2) change();
      if (i === 4) restore();
      const expected = isReplaced() ? "replaced" : 1;
      if ([].push(i) !== expected) wrong[wrong.length] = i;
    }
    return wrong;
  },
};

function trial(label, key, value, loop) {
  const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, key);
  const ways = {
    "a store": () => { Array.prototype[key] = value; },
    "Reflect.set": () => Reflect.set(Array.prototype, key, value),
    "Object.defineProperty": () => { Object.defineProperty(Array.prototype, key, { value }); },
  };
  for (const way in ways) {
    let wrong;
    let failure = "";
    try {
      wrong = loop(
        () => { try { ways[way](); } catch {} },
        () => { try { Object.defineProperty(Array.prototype, key, descriptor); } catch {} },
        () => Reflect.get(Array.prototype, key) === value,
      );
    } catch (error) {
      failure = error.constructor.name;
    }
    try {
      Object.defineProperty(Array.prototype, key, descriptor);
    } catch {}
    const isRight = !failure && wrong.length === 0;
    console.log((isRight ? "ok " : "WRONG ") + label + ", " + way + (isRight ? ": every turn called what Array.prototype held" : failure ? ": threw " + failure : ": turns " + wrong.join()));
  }
}

const nothing = () => {};
const never = () => false;
for (const key of Reflect.ownKeys(loops)) for (let i = 0; i < 300; i++) loops[key](nothing, nothing, never);
for (const key in inTheCallback) for (let i = 0; i < 300; i++) inTheCallback[key](nothing, nothing, never);

for (const key of Reflect.ownKeys(loops)) trial("a loop of " + String(key), key, key === Symbol.iterator ? replacedIterator : replacement, loops[key]);
for (const key in inTheCallback) trial("push inside " + key, "push", replacement, inTheCallback[key]);

// GENERATED: replacedIterator never Reflect.set Object.defineProperty
// CHECK-LABEL: function {{*}}name="replacedIterator"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, TakesCallee, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Generator<undefined|null|string> flags=[IsExpected]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything, v1: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v3 = String string="replaced"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v5 = Yield v4
// CHECK-NEXT: v6 = ResultAt v5
// CHECK-NEXT: v7 = ResultAt v5 index=1
// CHECK-NEXT: Switch v7 cases=[1, 2] -> case b2(), case b3(), otherwise b4()
// CHECK-NEXT: b2():
// CHECK-NEXT: Throw v6
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v6
// CHECK-NEXT: b4():
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="never"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=boolean flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Boolean
// CHECK-NEXT: v1 = Convert v0 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Reflect.set"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow captures=[{type=undefined|null|number|string|symbol flags=[IsExpected]}, {type=undefined|null|[[f_3]]|[[f_1]] flags=[IsExpected]}] thisType={type=anything} results=[{type=boolean flags=[IsExpected]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol, v1: undefined|null|[[f_3]]|[[f_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=Reflect
// CHECK-NEXT: v3 = Builtin builtin=ReflectSet
// CHECK-NEXT: v4 = Builtin builtin=ArrayPrototype
// CHECK-NEXT: v5 = Call v3, v2, v4, v0, v1 calleeName="Reflect.set"
// CHECK-NEXT: ReturnCall v5 casts=[{declared={type=boolean flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Object.defineProperty"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow captures=[{type=undefined|null|number|string|symbol flags=[IsExpected]}, {type=undefined|null|[[f_3]]|[[f_1]] flags=[IsExpected]}] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol, v1: undefined|null|[[f_3]]|[[f_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=Object
// CHECK-NEXT: v3 = Builtin builtin=ObjectDefineProperty
// CHECK-NEXT: v4 = Builtin builtin=ArrayPrototype
// CHECK-NEXT: v5 = NewObject -, v1 layout=[[L_6]] fields=[4]
// CHECK-NEXT: v6 = FinishObject v5
// CHECK-NEXT: v7 = Call v3, v2, v4, v0, v6 calleeName="Object.defineProperty"
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
