// What warm functions read and assign once `change` has been made. `x` is the name that it is about.
function afterChange(prepare, declare, change, [readsFirst, writes, writesProperty]) {
  const observe = turns => {
    const script = prepare();
    const [read, readProperty, readBesideEval, write, writeProperty] = script(`[
      () => x,
      () => globalThis.x,
      function () { eval(""); return x },
      value => { x = value },
      value => { globalThis.x = value },
    ]`);
    const readAll = () => [read, readProperty, readBesideEval].map(f => outcome(f, [])).join();
    script(declare);
    for (let turn = turns; turn >= 0; turn--) {
      if (readsFirst) readAll();
      if (writes) outcome(write, [turn & 1]);
      if (writesProperty) outcome(writeProperty, [turn & 1]);
    }
    const seen = [outcome(script, [change])];
    for (let turn = 0; turn < turns; turn++) readAll();
    seen.push(readAll(), outcome(write, [5]), readAll(), outcome(writeProperty, [6]), readAll());
    return seen.join(" ");
  };
  const [expected, actual] = [observe(0), observe(30)];
  if (actual !== expected) throw new Error(`${prepare}\n${declare}; ${change}: ${actual} instead of ${expected}`);
}

const declarations = [
  "x = 1",
  "var x = 1",
  "let x = 1",
  "Object.defineProperty(globalThis, 'x', { value: 1, writable: true, configurable: true })",
];

const changes = [
  "0",
  "x = 2",
  "globalThis.x = 2",
  "delete globalThis.x",
  "delete globalThis.x; other = 3",
  "delete globalThis.x; other = 3; x = 4",
  "other = 3",
  "other = 3; delete globalThis.other",
  "other = 3; Object.defineProperty(globalThis, 'other', { enumerable: false }); 0",
  "delete globalThis.Reflect",
  "Object.defineProperty(globalThis, 'x', { writable: false }); 0",
  "Object.defineProperty(globalThis, 'x', { value: 2 }); 0",
  "Object.defineProperty(globalThis, 'x', { get: () => 2, set() {} }); 0",
  "Object.assign(globalThis, { x: 2 }); 0",
  "Object.freeze(globalThis); 0",
  "let x = 2",
  "const x = 2",
  "function x() {}",
  "(0, eval)('function x() {}')",
];

const withManyProperties = script => (script("for (let i = 0; i < 150; i++) globalThis['p' + i] = i"), script);

for (const prepare of [() => newRealm(), () => withManyProperties(newRealm())])
  for (const declare of declarations)
    for (const change of changes)
      for (const warms of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0]]) afterChange(prepare, declare, change, warms);

// In the middle of a function.
check(
  function (change) {
    globalThis.changedMidway = 1;
    const before = changedMidway;
    change();
    const after = typeof changedMidway;
    changedMidway = 2;
    return [before, after, changedMidway, globalThis.changedMidway];
  },
  () => [
    [() => {}],
    [() => (changedMidway = "x")],
    [() => delete globalThis.changedMidway],
    [() => (delete globalThis.changedMidway, (globalThis.takesItsPlace = {}), delete globalThis.takesItsPlace)],
  ],
);

// The global objects of several realms at one site.
check(
  function (global, value) {
    const before = global.shared;
    global.shared = value;
    const after = global.shared;
    global.shared = before;
    return [before, after];
  },
  (() => {
    const globals = ["var shared = 1", "shared = 2", "let shared = 3; globalThis.shared = 4"].map(code => newRealm()(code + "; globalThis"));
    return () => [...globals, { shared: 5 }].map((global, index) => [global, "v" + index]);
  })(),
);
