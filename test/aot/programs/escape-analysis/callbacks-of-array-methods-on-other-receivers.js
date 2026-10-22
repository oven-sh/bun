// The callback of an array method, and the variables it captures, are cells only on the paths where the receiver is no plain array.
const WORD = String(process.argv.length);
const opened = new Function("v", "return v" + WORD.slice(WORD.length));
const kept = [];

function summed(list, k) { let s = 0; list.forEach(v => { s += v * k; }); return s; }
function counted(list, k) { let n = 0, s = 0; list.forEach((v, i) => { n++; s += v * k + i; }); return n + ":" + s; }
function mapped(list, k) { return list.map(v => v * k); }
function filtered(list, k) { return list.filter(v => v > k); }
function found(list, k) { return list.some(v => v === k); }
function located(list, k) { return list.findIndex(v => v === k); }
function reduced(list, k) { return list.reduce((a, v) => a + v * k, 0); }
function read(list, k) { let s = 0; list.forEach(v => { s += v * k; }); return () => s; }
function caught(list) {
  let s = 0;
  try {
    list.forEach(v => { s += v; if (v === 3) throw new Error("stop"); });
  } catch (error) {
    return error.message + " at " + s;
  }
  return s;
}
function redefinedInside(list, k) {
  let s = 0;
  list.forEach((v, i) => {
    s += v * k;
    if (i === 1) Object.defineProperty(list, 3, { get() { return 100; }, configurable: true, enumerable: true });
  });
  return s;
}
function shortenedInside(list) { let s = 0; list.forEach((v, i) => { s += v; if (i === 0) list.length = 2; }); return s; }
function holeMadeInside(list) { let s = 0; list.forEach((v, i) => { s += v; if (i === 0) delete list[2]; }); return s; }
function otherKindStoredInside(list) { let s = ""; list.forEach((v, i) => { s += v; if (i === 0) list[2] = "text"; }); return s; }
function inheritedInside(list) {
  let s = 0;
  list.forEach((v, i) => {
    s += v;
    if (i === 0) { delete list[1]; Object.setPrototypeOf(list, { __proto__: Array.prototype, 1: 50 }); }
  });
  return s;
}

class Sub extends Array {}
function receivers() {
  const withGetter = [1, 2, 3];
  Object.defineProperty(withGetter, 1, { get() { return 9; }, enumerable: true, configurable: true });
  const withOwnMethods = Object.assign([1, 2, 3], {
    forEach(f) { kept.push(f); f(10, 0); f(20, 1); },
    map(f) { kept.push(f); return [f(5), f(6)]; },
    filter(f) { kept.push(f); return [f(1), f(100)]; },
    some(f) { kept.push(f); return f(2); },
    findIndex(f) { kept.push(f); return f(2) ? 40 : 41; },
    reduce(f, first) { kept.push(f); return f(f(first, 1), 2); },
  });
  const arrayLike = { length: 2, 0: 4, 1: 5 };
  for (const name of ["forEach", "map", "filter", "some", "findIndex", "reduce"]) arrayLike[name] = Array.prototype[name];
  return {
    plain: [1, 2, 3, 4],
    holes: [1, , 3, , 5],
    doubles: [1.5, 2.5],
    strings: ["a", "b"],
    mixed: [1, "b", 2.5, null, undefined, { valueOf() { return 7; } }],
    empty: [],
    subclass: Sub.from([1, 2, 3]),
    frozen: Object.freeze([1, 2, 3]),
    proxy: new Proxy([1, 2, 3], {}),
    typed: new Uint8Array([1, 2, 3]),
    set: new Set([1, 2, 3]),
    map: new Map([[1, 2], [3, 4]]),
    iterator: [1, 2, 3].values(),
    withGetter,
    withOwnMethods,
    arrayLike,
    nothing: undefined,
    number: 5,
    noMethods: {},
  };
}

function show(value) {
  if (typeof value === "function") return "function " + show(value());
  if (value && typeof value === "object" && typeof value.next === "function") return "iterator " + JSON.stringify(Array.from(value));
  if (ArrayBuffer.isView(value)) return value.constructor.name + " " + JSON.stringify(Array.from(value));
  if (Array.isArray(value)) return value.constructor.name + " " + JSON.stringify(value);
  return String(value);
}

const functions = opened({ summed, counted, mapped, filtered, found, located, reduced, read });
for (let turn = 0; turn < 3; turn++) {
  for (const name of Object.keys(functions)) {
    const lists = opened(receivers());
    const line = [];
    for (const receiver of Object.keys(lists)) {
      let text;
      try {
        text = show(functions[name](lists[receiver], 2));
      } catch (error) {
        text = error.constructor.name;
      }
      line.push(receiver + "=" + text);
    }
    if (turn === 2) console.log(name, line.join(" | "));
  }
}

let total = 0;
for (let turn = 0; turn < 2000; turn++) {
  const list = opened([1, 2, 3, 4]);
  total += summed(list, turn & 3) + mapped(list, 2).length + filtered(list, 2).length + (found(list, 3) ? 1 : 0) + located(list, 4) + reduced(list, 1);
}
console.log("plain arrays", total);

const changing = opened({ caught, redefinedInside, shortenedInside, holeMadeInside, otherKindStoredInside, inheritedInside });
for (const name of Object.keys(changing)) {
  const results = [];
  for (let turn = 0; turn < 50; turn++) results.push(changing[name](opened([1, 2, 3, 4, 5]), 2));
  console.log(name, results[0], results[49], new Set(results).size);
}

console.log("kept", kept.length, new Set(kept).size, kept.slice(0, 12).map(f => String(f(1, 1))).join());
