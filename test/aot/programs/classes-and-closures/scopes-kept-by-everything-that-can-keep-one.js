// Every call below makes a scope, and something that the call answers with, or leaves behind, keeps it. All answers are collected first and read afterwards,
// so a scope whose cell the next call took would show the next call's variables.
const lines = [];
function collect(name, make, read) {
  const kept = [];
  for (let i = 0; i < 6; i++) kept.push(make("v" + i, i));
  lines.push(name + ": " + kept.map(read).join(" "));
}

collect("getter and setter", function (tag, n) {
  let note = tag;
  if (n % 2) note += "'";
  return { get value() { return note; }, set value(next) { note = next + note; } };
}, o => { o.value = "<"; return o.value; });

collect("method of a literal", function (tag, n) {
  let note = tag;
  if (n % 2) note += "'";
  return { read() { return note; }, bump() { note += "+"; return this; } };
}, o => o.bump().read());

collect("class declared inside", function (tag, n) {
  let note = tag;
  if (n % 2) note += "'";
  return class { static read() { return note; } read() { return note + "i"; } field = note + "f"; };
}, C => C.read() + new C().read() + new C().field);

collect("instance of a class declared inside", function (tag, n) {
  let count = n;
  class Counter { #own = tag; next() { return this.#own + ++count; } }
  return new Counter();
}, c => c.next() + c.next());

collect("default of a parameter", function (tag, n, read = () => tag + n) {
  var tag = tag + "!";
  if (n % 2) tag += "'";
  return [read, () => tag];
}, ([a, b]) => a() + b());

collect("mapped arguments", function (tag, n) {
  const all = arguments;
  if (n % 2) tag += "'";
  return [all, () => tag, next => { tag = next; }];
}, ([all, read, write]) => { const before = all[0]; write("w" + before); return before + read() + all[0]; });

collect("direct eval", function (tag, n) {
  let note = tag;
  if (n % 2) note += "'";
  return eval("() => note + n");
}, f => f());

collect("catch parameter", function (tag, n) {
  try {
    throw tag + (n % 2 ? "'" : "");
  } catch (error) {
    let twice = error + error;
    return () => error + "/" + twice;
  }
}, f => f());

collect("switch scope", function (tag, n) {
  switch (n % 3) {
    case 0: { let a = tag + "a"; return () => a; }
    case 1: { let b = tag + "b"; if (n > 2) b += "'"; return () => b; }
    default: { let c = tag + "c"; return () => c + c; }
  }
}, f => f());

collect("one scope a turn of a loop", function (tag, n) {
  const all = [];
  outer: for (let i = 0; i < 4; i++) {
    let seen = tag + i;
    for (let j = 0; j < 3; j++) {
      let both = seen + j;
      if (j === n % 3) { all.push(() => both); continue outer; }
      if (i === 3) break outer;
    }
  }
  return all;
}, all => all.map(f => f()).join(""));

collect("bound function", function (tag, n) {
  let note = tag;
  if (n % 2) note += "'";
  function read(prefix, suffix) { return prefix + note + suffix + (this ? this.x : ""); }
  return read.bind({ x: n }, "[");
}, f => f("]"));

collect("kept by a Map, a Set, a WeakMap and an array", function (tag, n) {
  let note = tag;
  if (n % 2) note += "'";
  const key = {};
  return [new Map([["k", () => note]]), new Set([() => note + "s"]), new WeakMap([[key, () => note + "w"]]), key];
}, ([map, set, weak, key]) => map.get("k")() + [...set][0]() + weak.get(key)());

collect("symbol members and an iterator", function (tag, n) {
  let left = 2;
  return { [Symbol.iterator]() { return { next: () => (left-- > 0 ? { value: tag + left, done: false } : { value: undefined, done: true }) }; }, [Symbol.toPrimitive]: () => tag + n };
}, o => [...o].join("") + `${o}`);

collect("proxy handler", function (tag, n) {
  let reads = n;
  return new Proxy({}, { get: (target, name) => tag + String(name) + ++reads });
}, p => p.a + p.b);

collect("scope inside a scope inside a scope", function (tag, n) {
  let a = tag;
  return (function middle(m) {
    let b = a + m;
    if (m % 2) b += "'";
    return (function inner(k) {
      let c = b + k;
      return () => a + "," + b + "," + c;
    })(m + 1);
  })(n);
}, f => f());

collect("closure that answers with a closure", function (tag, n) {
  let a = tag;
  if (n % 2) a += "'";
  return () => { let b = a + "2"; a += "."; return () => a + b; };
}, f => { const g = f(), h = f(); return g() + h(); });

const listeners = [];
collect("left behind in a list outside", function (tag, n) {
  let note = tag;
  if (n % 2) note += "'";
  listeners.push(() => note);
  return listeners.length - 1;
}, index => listeners[index]());

collect("thrown out through two frames", function (tag, n) {
  function deep(k) {
    let note = tag + k;
    if (k === 0) throw { read: () => note, tag };
    try { deep(k - 1); } finally { note += "x"; }
  }
  try { deep(n % 3); } catch (thrown) { return thrown; }
}, t => t.read() + t.tag);

collect("recursion that keeps one closure a level", function keep(tag, n) {
  let note = tag + n;
  const below = n > 0 ? keep(tag, n - 1) : [];
  below.push(() => note);
  return below;
}, all => all.map(f => f()).join(""));

collect("tagged template and spread", function (tag, n) {
  let note = tag;
  const build = (strings, ...values) => () => strings.join(note) + values.join(note);
  return build`a${n}b${n + 1}c`;
}, f => f());

const timers = [];
for (let i = 0; i < 4; i++) {
  (function (tag, n) {
    let note = tag;
    if (n % 2) note += "'";
    timers.push(new Promise(resolve => setTimeout(() => resolve(note), 0)));
    queueMicrotask(() => { note += "m"; });
  })("t" + i, i);
}
console.log(lines.join("\n"));
Promise.all(timers).then(all => console.log("timers and microtasks: " + all.join(" ")));
