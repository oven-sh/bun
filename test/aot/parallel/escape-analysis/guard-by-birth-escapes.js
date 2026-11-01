// Flags: --aot-validate
// A list gets out by a road that is easy to miss, is changed there, and is read: a constructor or a species constructor that stores `this`, a closure, `arguments`, a generator, an async function, a trap, a setter, one arm, a callee, another list.
const registry = { list: null, peek: null, args: null };
const turns = process.argv.length + 2;

function spoil(list) {
  if (list) Object.defineProperty(list, 0, { get() { return 900; }, configurable: true });
}

function holder(find) {
  return { state: { get type() { spoil(find()); return 0; } } };
}

function line(name, run) {
  let answer;
  try {
    answer = run();
  } catch (error) {
    answer = error.name + ": " + error.message.slice(0, 60);
  }
  console.log(name + ": " + answer);
}

line("nothing hidden", () => {
  const it = holder(() => registry.list);
  let sum = 0;
  registry.list = null;
  for (let i = 0; i < turns; i++) {
    const list = [];
    list.push(i + 1);
    if (it.state.type === 26) sum += 1000000;
    sum += list[0];
    registry.list = list;
  }
  return sum;
});

line("a constructor stores this", () => {
  class List extends Array {
    constructor() {
      super();
      registry.list = this;
    }
  }
  const it = holder(() => registry.list);
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const list = new List();
    list.push(i + 1);
    if (it.state.type === 26) sum += 1000000;
    sum += list[0];
  }
  return sum;
});

line("a species constructor stores this", () => {
  class List extends Array {
    static get [Symbol.species]() {
      return function (length) {
        const made = new Array(length);
        registry.list = made;
        return made;
      };
    }
  }
  const source = new List();
  source.push(5);
  const it = holder(() => registry.list);
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const list = source.map(value => value + i);
    if (it.state.type === 26) sum += 1000000;
    sum += list[0];
  }
  return sum;
});

line("a closure made before the birth, a variable outside the loop", () => {
  let list = null;
  const it = holder(() => list);
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    list = [];
    list.push(i + 1);
    if (it.state.type === 26) sum += 1000000;
    sum += list[0];
  }
  return sum;
});

line("a closure made before the birth, a constant of the turn", () => {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const it = holder(() => list);
    const list = [];
    list.push(i + 1);
    if (it.state.type === 26) sum += 1000000;
    sum += list[0];
  }
  return sum;
});

line("mapped arguments", () => {
  function sloppy(list) {
    registry.args = arguments;
    const it = holder(() => registry.args[0]);
    let sum = 0;
    for (let i = 0; i < turns; i++) {
      list = [];
      list.push(i + 1);
      if (it.state.type === 26) sum += 1000000;
      sum += list[0];
    }
    return sum;
  }
  return sloppy(null);
});

line("a generator suspended between the birth and the read, the list yielded", () => {
  function* steps() {
    let sum = 0;
    for (let i = 0; i < turns; i++) {
      const list = [];
      list.push(i + 1);
      yield list;
      sum += list[0];
    }
    return sum;
  }
  const running = steps();
  for (;;) {
    const step = running.next();
    if (step.done) return step.value;
    spoil(step.value);
  }
});

line("a generator suspended between the birth and the read, an earlier list spoiled", () => {
  function* steps() {
    let sum = 0;
    for (let i = 0; i < turns; i++) {
      const list = [];
      list.push(i + 1);
      yield;
      sum += list[0];
      registry.list = list;
    }
    return sum;
  }
  registry.list = null;
  const running = steps();
  for (;;) {
    const step = running.next();
    if (step.done) return step.value;
    spoil(registry.list);
  }
});

line("an async function awaiting between the birth and the read", () => {
  let result = "pending";
  async function steps() {
    let sum = 0;
    for (let i = 0; i < turns; i++) {
      const list = [];
      list.push(i + 1);
      registry.list = i & 1 ? list : registry.list;
      await null;
      sum += list[0];
    }
    return sum;
  }
  registry.list = null;
  steps().then(value => console.log("   the async function ended with: " + value));
  for (let i = 0; i < turns * 2; i++) Promise.resolve().then(() => spoil(registry.list));
  return result;
});

line("a trap of a Proxy above the list, run by the push itself", () => {
  class List extends Array {}
  Object.setPrototypeOf(
    List.prototype,
    new Proxy(Array.prototype, {
      set(target, key, value, receiver) {
        registry.list = receiver;
        return Reflect.set(target, key, value, receiver);
      },
    }),
  );
  const it = holder(() => registry.list);
  let sum = 0;
  registry.list = null;
  for (let i = 0; i < turns; i++) {
    const list = new List();
    list.push(i + 1);
    if (it.state.type === 26) sum += 1000000;
    sum += list[0];
  }
  return sum;
});

line("a setter above the list, run by the store", () => {
  const above = Object.create(Array.prototype, {
    0: {
      set(value) {
        registry.list = this;
        Object.defineProperty(this, 0, { value, writable: true, configurable: true, enumerable: true });
      },
      configurable: true,
    },
  });
  const it = holder(() => registry.list);
  let sum = 0;
  registry.list = null;
  for (let i = 0; i < turns; i++) {
    const list = [];
    Object.setPrototypeOf(list, above);
    list[0] = i + 1;
    if (it.state.type === 26) sum += 1000000;
    sum += list[0];
  }
  return sum;
});

line("the list is stored, read back and spoiled in the same turn", () => {
  const box = { held: null };
  const it = holder(() => box.held);
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const list = [];
    list.push(i + 1);
    box.held = list;
    if (it.state.type === 26) sum += 1000000;
    sum += list[0];
  }
  return sum;
});

line("the list goes out on one arm only", () => {
  const box = { held: null };
  const it = holder(() => box.held);
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const list = [];
    list.push(i + 1);
    if (i & 1) box.held = list;
    if (it.state.type === 26) sum += 1000000;
    sum += list[0];
  }
  return sum;
});

line("the list goes out inside a callee", () => {
  const box = { held: null };
  const keep = list => {
    box.held = list;
  };
  const it = holder(() => box.held);
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const list = [];
    list.push(i + 1);
    keep(list);
    if (it.state.type === 26) sum += 1000000;
    sum += list[0];
  }
  return sum;
});

line("the list goes out inside another list made in the turn", () => {
  const box = { held: null };
  const it = holder(() => box.held && box.held[0]);
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const list = [];
    list.push(i + 1);
    const outer = [list];
    box.held = outer;
    if (it.state.type === 26) sum += 1000000;
    sum += list[0];
  }
  return sum;
});
