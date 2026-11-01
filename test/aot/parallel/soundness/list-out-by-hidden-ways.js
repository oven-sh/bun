// Flags: --aot-check=verify-each-pass
// A list of this turn gets out of the function by a way that ends in a value without an allocation behind it: a catch value, a box that was out before, a name read back.
// Every form lets THIS turn's list out of the function in a way that ends in a value without an allocation behind it, and then spoils it from a getter between the birth and the read.
const registry = { list: null, box: null, outer: null, holder: null, thrown: null };
const turns = process.argv.length + 2;
function spoil(list) { if (list && Array.isArray(list)) Object.defineProperty(list, 0, { get() { return 900; }, configurable: true }); }
function holder(find) { return { state: { get type() { spoil(find()); return 0; } } }; }
function line(name, run) { let answer; try { answer = run(); } catch (error) { answer = error.name + ": " + String(error.message).slice(0, 60); } console.log(name + ": " + answer); }

line("thrown and caught in the function, out through the catch value", () => {
  const it = holder(() => registry.list);
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const list = [];
    list.push(i + 1);
    try { if (turns > 1) throw list; } catch (caught) { registry.list = caught; }
    if (it.state.type === 26) sum += 1000000;
    sum += list[0];
  }
  return sum;
});

line("thrown by a callee and caught here", () => {
  const it = holder(() => registry.list);
  function fling(value) { throw value; }
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const list = [];
    list.push(i + 1);
    try { fling(list); } catch (caught) { registry.list = caught; }
    if (it.state.type === 26) sum += 1000000;
    sum += list[0];
  }
  return sum;
});

line("thrown in a finally's way, out through the catch value of an outer try", () => {
  const it = holder(() => registry.list);
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const list = [];
    list.push(i + 1);
    try { try { throw list; } finally { sum += 0; } } catch (caught) { registry.list = caught; }
    if (it.state.type === 26) sum += 1000000;
    sum += list[0];
  }
  return sum;
});

line("the box is out before the list is born, the list goes in by the box's own name", () => {
  const it = holder(() => registry.box && registry.box.list);
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const box = { list: null };
    registry.box = box;
    const list = [];
    list.push(i + 1);
    box.list = list;
    if (it.state.type === 26) sum += 1000000;
    sum += list[0];
  }
  return sum;
});

line("the box's holder is out before the list is born", () => {
  const it = holder(() => registry.outer && registry.outer.box.list);
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const box = { list: null };
    const outer = { box };
    registry.outer = outer;
    const list = [];
    list.push(i + 1);
    box.list = list;
    if (it.state.type === 26) sum += 1000000;
    sum += list[0];
  }
  return sum;
});

line("the list goes into a box that is read back", () => {
  const it = holder(() => registry.box && registry.box.list);
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    registry.box = { list: null };
    const list = [];
    list.push(i + 1);
    const again = registry.box;
    again.list = list;
    if (it.state.type === 26) sum += 1000000;
    sum += list[0];
  }
  return sum;
});

line("into a local box, and the box goes out by a name read back out of another local box", () => {
  const it = holder(() => registry.box && registry.box.list);
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const list = [];
    list.push(i + 1);
    const box = { list };
    const shelf = { box };
    registry.box = shelf.box;
    if (it.state.type === 26) sum += 1000000;
    sum += list[0];
  }
  return sum;
});

line("a plain function constructor keeps it: a callee made in the pass", () => {
  function Holder(kept) { this.kept = kept; registry.holder = this; }
  const it = holder(() => registry.holder && registry.holder.kept);
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const list = [];
    list.push(i + 1);
    const made = new Holder(list);
    if (it.state.type === 26) sum += 1000000;
    sum += list[0] + (made.kept === list ? 0 : 5000);
  }
  return sum;
});

line("map() fills it, the callback's constructor lets the list of map() out by its third argument", () => {
  function Holder(value, all) { this.value = value; registry.list = all; }
  const it = holder(() => registry.list);
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const source = [i + 1, i + 2];
    const made = source.map((value, index, all) => new Holder(value, all));
    if (it.state.type === 26) sum += 1000000;
    sum += source[0] + made[1].value;
  }
  return sum;
});

line("defined by a key that is no constant: a generic define of the fresh list", () => {
  const it = holder(() => registry.list);
  const keys = [0, "0", 1];
  let sum = 0;
  registry.list = null;
  for (let i = 0; i < turns; i++) {
    const list = [];
    Object.defineProperty(list, keys[i % 3], { value: i + 1, writable: true, enumerable: true, configurable: true });
    list[keys[(i + 1) % 3]] = i + 2;
    if (it.state.type === 26) sum += 1000000;
    sum += (list[0] | 0) + (list[1] | 0);
    registry.list = list;
  }
  return sum;
});

line("a spread literal with a hole-making key, then out late", () => {
  const it = holder(() => registry.list);
  let sum = 0;
  registry.list = null;
  for (let i = 0; i < turns; i++) {
    const list = [...[i + 1], i + 2];
    if (it.state.type === 26) sum += 1000000;
    sum += list[0];
    registry.list = list;
    if (it.state.type === 26) sum += 1000000;
    sum += list[0];
  }
  return sum;
});

line("out on the way round: the read stands in front of the store in the text, behind it in the run", () => {
  const it = holder(() => registry.list);
  let sum = 0;
  registry.list = null;
  let list = [7];
  for (let i = 0; i < turns; i++) {
    if (it.state.type === 26) sum += 1000000;
    sum += list[0];
    registry.list = list;
    if (i % 2) { list = []; list.push(i + 1); }
  }
  return sum;
});

line("an async function's own promise is out at the first await", () => {
  let result = "pending";
  const seen = [];
  async function steps() {
    let sum = 0;
    for (let i = 0; i < turns; i++) {
      const list = [];
      list.push(i + 1);
      registry.list = list;
      await null;
      sum += list[0];
    }
    return sum;
  }
  const promise = steps();
  Object.defineProperty(promise, "then", { value(resolve, reject) { seen.push("then"); return Promise.prototype.then.call(this, resolve, reject); }, configurable: true });
  promise.then(value => { result = value; console.log("  later: " + result + " " + seen.join()); });
  spoil(registry.list);
  return result;
});

line("a generator: out through a variable that lives across an arm with a yield", () => {
  function* steps(pause) {
    let sum = 0;
    for (let i = 0; i < turns; i++) {
      const list = [];
      list.push(i + 1);
      const before = list[0];
      if (pause(i)) yield i;
      registry.list = list;
      if (it.state.type === 26) sum += 1000000;
      sum += list[0] + before;
    }
    return sum;
  }
  const it = holder(() => registry.list);
  const running = steps(i => i % 2 === 0);
  for (;;) { const step = running.next(); if (step.done) return step.value; }
});

line("a getter of the receiver lets `this.current` out, the list was laid there by its own name", () => {
  class Walker {
    constructor() { this.current = null; this.state = null; }
    walk() {
      let sum = 0;
      for (let i = 0; i < turns; i++) {
        const list = [];
        list.push(i + 1);
        this.current = list;
        if (this.state.type === 26) sum += 1000000;
        sum += list[0];
      }
      return sum;
    }
  }
  const walker = new Walker();
  walker.state = { get type() { spoil(walker.current); return 0; } };
  return walker.walk();
});

line("handed to a bound function made before the loop", () => {
  const keep = function (list) { this.list = list; }.bind(registry);
  const it = holder(() => registry.list);
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

line("a WeakRef made of it, read back by deref() of a WeakRef read back", () => {
  const it = holder(() => registry.holder && registry.holder.deref());
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const list = [];
    list.push(i + 1);
    registry.holder = new WeakRef(list);
    if (it.state.type === 26) sum += 1000000;
    sum += list[0];
  }
  return sum;
});

line("a destructuring default reads it back in the same turn and hands it on", () => {
  const it = holder(() => registry.thrown);
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const list = [];
    list.push(i + 1);
    const { kept = list } = registry.nothing ?? {};
    registry.thrown = kept;
    if (it.state.type === 26) sum += 1000000;
    sum += list[0];
  }
  return sum;
});
