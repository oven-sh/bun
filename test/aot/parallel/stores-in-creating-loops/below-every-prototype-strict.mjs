// The same loops in strict code: a store that the chain refuses throws.
const say = (...values) => console.log(...values.map(value => (typeof value === "string" ? value : JSON.stringify(value))));
const attempt = body => {
  try {
    return body();
  } catch (error) {
    return error.constructor.name + ": " + error.message;
  }
};

function belowLiteral(count) {
  const proto = { m() { return this.tag; } };
  let sum = 0, last;
  for (let i = 0; i < count; i++) {
    const o = Object.create(proto);
    o.tag = i;
    o.other = -i;
    sum += o.tag + o.m() - o.other;
    last = o;
  }
  return [sum, Object.keys(last), Object.getPrototypeOf(last) === proto, "m" in last, Object.hasOwn(last, "m")];
}

function belowSetter(count) {
  const seen = [];
  const proto = { set tag(value) { seen.push(value); }, get tag() { return "got"; } };
  let last;
  for (let i = 0; i < count; i++) {
    const o = Object.create(proto);
    o.tag = i;
    o.after = i;
    last = o;
  }
  return [seen.length, seen.at(-1), last.tag, Object.keys(last)];
}

function belowReadOnly(count) {
  const proto = Object.defineProperty({}, "tag", { value: "fixed", writable: false });
  let last;
  for (let i = 0; i < count; i++) {
    const o = Object.create(proto);
    o.tag = i;
    o.after = i;
    last = o;
  }
  return [last.tag, Object.keys(last)];
}

function belowReadOnlyStrict(count) {
  const proto = Object.freeze({ tag: "frozen" });
  let failures = 0, last;
  for (let i = 0; i < count; i++) {
    const o = Object.create(proto);
    try {
      o.tag = i;
    } catch (error) {
      failures += error instanceof TypeError;
    }
    o.after = i;
    last = o;
  }
  return [failures, last.tag, Object.keys(last)];
}

function belowTwo(count) {
  const seen = [];
  const protos = [{ a: 1 }, { set tag(value) { seen.push(value); } }, { b: 2 }];
  let keys = "";
  for (let i = 0; i < count; i++) {
    const o = Object.create(protos[i % 3]);
    o.tag = i;
    keys += Object.keys(o).length;
  }
  return [keys.slice(0, 12), seen.length, seen.at(-1)];
}

function setterComes(count) {
  const seen = [];
  const proto = { m() {} };
  let own = 0;
  for (let i = 0; i < count; i++) {
    const o = Object.create(proto);
    if (i === 40) Object.defineProperty(proto, "tag", { set(value) { seen.push(value); }, configurable: true });
    if (i === 60) delete proto.tag;
    o.tag = i;
    own += Object.hasOwn(o, "tag");
  }
  return [own, seen];
}

function setterComesAbove(count) {
  const seen = [];
  const top = { t: 1 };
  const proto = Object.create(top);
  let own = 0;
  for (let i = 0; i < count; i++) {
    const o = Object.create(proto);
    o.first = i;
    if (i === 10) Object.defineProperty(top, "second", { set(value) { seen.push([this === o, value]); } });
    o.second = i;
    own += Object.keys(o).length;
  }
  return [own, seen.length, seen[0]];
}

function readOnlyComes(count) {
  const proto = {};
  let own = 0;
  for (let i = 0; i < count; i++) {
    if (i === 30) Object.freeze(Object.assign(proto, { tag: "late" }));
    const o = Object.create(proto);
    o.tag = i;
    own += Object.hasOwn(o, "tag");
  }
  return own;
}

function linkChanges(count) {
  const seen = [];
  const other = { set tag(value) { seen.push(value); } };
  const proto = { m() {} };
  let own = 0;
  for (let i = 0; i < count; i++) {
    const o = Object.create(proto);
    if (i % 10 === 9) Object.setPrototypeOf(o, other);
    if (i === 50) Object.setPrototypeOf(proto, other);
    if (i === 60) Object.setPrototypeOf(proto, null);
    o.tag = i;
    own += Object.prototype.hasOwnProperty.call(o, "tag");
  }
  return [own, seen.length, seen.at(-1)];
}

function closedToNames(count) {
  const proto = { m() {} };
  const kinds = [o => o, Object.preventExtensions, Object.seal, Object.freeze];
  const found = [0, 0, 0, 0];
  for (let i = 0; i < count; i++) {
    const o = Object.create(proto);
    o.before = 1;
    kinds[i & 3](o);
    o.before = 2;
    o.tag = i;
    found[i & 3] += o.before * 10 + Object.hasOwn(o, "tag");
  }
  return found;
}

function closedToNamesStrict(count) {
  const proto = { m() {} };
  let failures = 0;
  for (let i = 0; i < count; i++) {
    const o = Object.create(proto);
    if (i & 1) Object.preventExtensions(o);
    try {
      o.tag = i;
    } catch {
      failures++;
    }
  }
  return failures;
}

function belowProxy(count) {
  const log = [];
  const proto = new Proxy({ inner: 1 }, {
    set(target, name, value, receiver) {
      log.push(String(name));
      return Reflect.defineProperty(receiver, name, { value: [value], writable: true, enumerable: true, configurable: true });
    },
    get(target, name, receiver) {
      return typeof name === "string" && name === "absent" ? "trapped" : Reflect.get(target, name, receiver);
    },
  });
  let last;
  for (let i = 0; i < count; i++) {
    const o = Object.create(proto);
    o.tag = i;
    last = o;
  }
  return [log.length, last.tag, last.absent, last.inner];
}

function belowOtherKinds(count) {
  const protos = [null, function f() {}, [1, 2, 3], new Uint8Array(2), new Map(), class A {}, class B { set tag(v) { this._v = v; } }.prototype, Error.prototype, new Date(0), /x/g, Promise.prototype, globalThis, Symbol.prototype];
  const found = [];
  for (let i = 0; i < count; i++) {
    const proto = protos[i % protos.length];
    const o = Object.create(proto);
    o.tag = i;
    o.length = 7;
    o.name = "n";
    if (i >= count - protos.length) found.push(Reflect.ownKeys(o).join());
  }
  return found;
}

function deletedNames(count) {
  const proto = { m() {} };
  let keys = "";
  for (let i = 0; i < count; i++) {
    const o = Object.create(proto);
    o.a = 1;
    o.b = 2;
    if (i % 3 === 1) delete o.a;
    if (i % 3 === 2) delete o.b;
    o.a = 3;
    o.c = 4;
    o.b = 5;
    if (i >= count - 3) keys += Object.keys(o).join() + ";";
  }
  return keys;
}

function manyNames(count) {
  const proto = { m() {} };
  let last;
  for (let i = 0; i < count; i++) {
    const o = Object.create(proto);
    o.first = i;
    for (let k = 0; k < 70; k++) o["n" + k] = k;
    o.last = i;
    last = o;
  }
  return [Object.keys(last).length, Object.keys(last)[0], Object.keys(last).at(-1), last.n69];
}

function specialNames(count) {
  const proto = { m() {} };
  let last;
  for (let i = 0; i < count; i++) {
    const o = Object.create(proto);
    o.constructor = i;
    o.toString = i;
    o.hasOwnProperty = i;
    o.valueOf = i;
    o.__proto__ = null;
    o.tag = i;
    last = o;
  }
  return [Object.keys(last).length, Reflect.getPrototypeOf(last) === null, last.m === undefined, last.tag];
}

function valuesOfEveryKind(count) {
  const proto = { m() {} };
  const values = [1, 1.5, -0, NaN, 2 ** 40, "text", true, null, undefined, Symbol.iterator, 10n, {}, [], () => 1];
  const kinds = [];
  for (let i = 0; i < count; i++) {
    const o = Object.create(proto);
    o.value = values[i % values.length];
    o.again = o.value;
    if (i >= count - values.length) kinds.push(typeof o.again + Object.is(o.value, values[i % values.length]));
  }
  return kinds;
}

function nestedLoops(count) {
  const outer = { level: 0 };
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const parent = Object.create(outer);
    parent.level = i;
    for (let k = 0; k < 4; k++) {
      const child = Object.create(parent);
      child.k = k;
      if (k === 3) child.level = -1;
      sum += child.level + child.k;
    }
    sum += parent.level;
  }
  return sum;
}

function create(proto, i) {
  const o = Object.create(proto);
  o.tag = i;
  o.list = [i];
  return o;
}
function throughFunction(count) {
  const first = { kind: "first" }, second = { kind: "second", set tag(value) { this.seen = value; } };
  let keys = "";
  for (let i = 0; i < count; i++) {
    const o = create(i & 1 ? second : first, i);
    if (i >= count - 2) keys += o.kind + Object.keys(o) + o.list + ";";
  }
  return keys;
}

function thrownAway(count) {
  const proto = { m() {} };
  const kept = [];
  for (let i = 0; i < count; i++) {
    const o = Object.create(proto);
    o.tag = i;
    if (i % 50 === 0) kept.push(o);
  }
  return kept.map(o => o.tag);
}

function failingPrototype(count) {
  let failures = 0, made = 0;
  for (let i = 0; i < count; i++) {
    try {
      const o = Object.create(i % 5 === 4 ? i : null);
      o.tag = i;
      made += Object.keys(o).length;
    } catch (error) {
      failures += error instanceof TypeError;
    }
  }
  return [failures, made];
}

for (const body of [belowLiteral, belowSetter, belowReadOnly, belowReadOnlyStrict, belowTwo, setterComes, setterComesAbove, readOnlyComes, linkChanges, closedToNames, closedToNamesStrict, belowProxy, belowOtherKinds, deletedNames, manyNames, specialNames, valuesOfEveryKind, nestedLoops, throughFunction, thrownAway, failingPrototype]) {
  for (const count of [1, 2, 120]) say(body.name, count, attempt(() => body(count)));
}
export {};
