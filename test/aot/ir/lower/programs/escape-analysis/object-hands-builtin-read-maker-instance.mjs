// RUN: lower
// OPTIONS: builtin-modules

// A function makes a value and an object that gives the value to a built-in: through a getter, a method, an iterator, a trap, a thenable. What the built-in did with it is read after the function has returned, after deep calls and a collection.
import { EventEmitter } from "node:events";
import { inspect } from "node:util";
import { AsyncLocalStorage } from "node:async_hooks";
class Point { constructor(n) { this.n = n; } }
function callDeep(k, a, b, c) { if (k === 0) return a + b + c; const t = [k, a, b, c]; return callDeep(k - 1, t[1] + 1, t[2] + 2, t[3] + 3) + t[0]; }
const reports = [];
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(Object.assign({}, { get a() { return v; } }).a);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(0 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(Object.assign({}, { get a() { return v; } }).a); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(Object.defineProperty({}, "a", { get value() { return v; } }).a);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(10 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(Object.defineProperty({}, \"a\", { get value() { return v; } }).a); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(Object.defineProperty({}, "a", { get get() { return () => v; } }).a);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(20 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(Object.defineProperty({}, \"a\", { get get() { return () => v; } }).a); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(Object.defineProperties({}, { a: { get value() { return v; } } }).a);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(30 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(Object.defineProperties({}, { a: { get value() { return v; } } }).a); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(Object.defineProperties({}, { get a() { return { value: v }; } }).a);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(40 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(Object.defineProperties({}, { get a() { return { value: v }; } }).a); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(Object.create(null, { a: { get value() { return v; } } }).a);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(50 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(Object.create(null, { a: { get value() { return v; } } }).a); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    const o = {}; Reflect.defineProperty(o, "a", { get value() { return v; } }); keep(o.a);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(60 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("const o = {}; Reflect.defineProperty(o, \"a\", { get value() { return v; } }); keep(o.a); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(Reflect.get({ get a() { return v; } }, "a"));
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(70 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(Reflect.get({ get a() { return v; } }, \"a\")); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(Reflect.get({ get a() { return this; } }, "a", v));
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(80 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(Reflect.get({ get a() { return this; } }, \"a\", v)); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    Reflect.set({ set a(x) { keep(x); } }, "a", v);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(90 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("Reflect.set({ set a(x) { keep(x); } }, \"a\", v); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    Reflect.set({ set a(x) { keep(this); } }, "a", 1, v);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(100 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("Reflect.set({ set a(x) { keep(this); } }, \"a\", 1, v); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    Reflect.apply(keep, null, { length: 1, get 0() { return v; } });
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(110 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("Reflect.apply(keep, null, { length: 1, get 0() { return v; } }); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    Reflect.apply(function () { keep(this); }, v, []);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(120 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("Reflect.apply(function () { keep(this); }, v, []); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(Reflect.construct(function (x) { this.x = x; }, { length: 1, get 0() { return v; } }).x);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(130 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(Reflect.construct(function (x) { this.x = x; }, { length: 1, get 0() { return v; } }).x); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep.apply(null, { length: 1, get 0() { return v; } });
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(140 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep.apply(null, { length: 1, get 0() { return v; } }); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep.call(null, v);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(150 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep.call(null, v); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    later(((x) => x).bind(null, v));
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(160 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("later(((x) => x).bind(null, v)); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(Array.from({ length: 1, get 0() { return v; } })[0]);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(170 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(Array.from({ length: 1, get 0() { return v; } })[0]); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(Array.from({ [Symbol.iterator]() { let done = false; return { next() { const step = { value: v, done }; done = true; return step; } }; } })[0]);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(180 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(Array.from({ [Symbol.iterator]() { let done = false; return { next() { const step = { value: v, done }; done = true; return step; } }; } })[0]); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(Array.from([1], () => v)[0]);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(190 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(Array.from([1], () => v)[0]); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(Object.values({ get a() { return v; } })[0]);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(200 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(Object.values({ get a() { return v; } })[0]); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(Object.entries({ get a() { return v; } })[0][1]);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(210 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(Object.entries({ get a() { return v; } })[0][1]); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(Object.fromEntries([{ 0: "a", get 1() { return v; } }]).a);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(220 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(Object.fromEntries([{ 0: \"a\", get 1() { return v; } }]).a); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(Object.fromEntries({ [Symbol.iterator]() { let done = false; return { next() { const step = { value: ["a", v], done }; done = true; return step; } }; } }).a);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(230 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(Object.fromEntries({ [Symbol.iterator]() { let done = false; return { next() { const step = { value: [\"a\", v], done }; done = true; return step; } }; } }).a); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(new Map([{ 0: "a", get 1() { return v; } }]).get("a"));
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(240 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(new Map([{ 0: \"a\", get 1() { return v; } }]).get(\"a\")); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(new Map({ [Symbol.iterator]() { let done = false; return { next() { const step = { value: ["a", v], done }; done = true; return step; } }; } }).get("a"));
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(250 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(new Map({ [Symbol.iterator]() { let done = false; return { next() { const step = { value: [\"a\", v], done }; done = true; return step; } }; } }).get(\"a\")); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep([...new Set({ [Symbol.iterator]() { let done = false; return { next() { const step = { value: v, done }; done = true; return step; } }; } })][0]);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(260 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep([...new Set({ [Symbol.iterator]() { let done = false; return { next() { const step = { value: v, done }; done = true; return step; } }; } })][0]); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(Object.groupBy({ [Symbol.iterator]() { let done = false; return { next() { const step = { value: v, done }; done = true; return step; } }; } }, () => "a").a[0]);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(270 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(Object.groupBy({ [Symbol.iterator]() { let done = false; return { next() { const step = { value: v, done }; done = true; return step; } }; } }, () => \"a\").a[0]); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(Map.groupBy({ [Symbol.iterator]() { let done = false; return { next() { const step = { value: v, done }; done = true; return step; } }; } }, () => "a").get("a")[0]);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(280 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(Map.groupBy({ [Symbol.iterator]() { let done = false; return { next() { const step = { value: v, done }; done = true; return step; } }; } }, () => \"a\").get(\"a\")[0]); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    JSON.stringify({ toJSON() { return v; } }, (k, x) => (k === "" && keep(x), 0));
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(290 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("JSON.stringify({ toJSON() { return v; } }, (k, x) => (k === \"\" && keep(x), 0)); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(JSON.parse("[1]", (k, x) => (k === "0" ? v : x))[0]);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(300 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(JSON.parse(\"[1]\", (k, x) => (k === \"0\" ? v : x))[0]); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    Promise.resolve({ then(resolve) { resolve(v); } }).then(keep);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(310 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("Promise.resolve({ then(resolve) { resolve(v); } }).then(keep); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    Promise.all([{ then(resolve) { resolve(v); } }]).then(([x]) => keep(x));
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(320 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("Promise.all([{ then(resolve) { resolve(v); } }]).then(([x]) => keep(x)); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    Promise.allSettled([{ then(resolve) { resolve(v); } }]).then(([x]) => keep(x.value));
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(330 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("Promise.allSettled([{ then(resolve) { resolve(v); } }]).then(([x]) => keep(x.value)); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    Promise.race({ [Symbol.iterator]() { let done = false; return { next() { const step = { value: { then(resolve) { resolve(v); } }, done }; done = true; return step; } }; } }).then(keep);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(340 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("Promise.race({ [Symbol.iterator]() { let done = false; return { next() { const step = { value: { then(resolve) { resolve(v); } }, done }; done = true; return step; } }; } }).then(keep); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    Promise.reject(v).catch(keep);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(350 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("Promise.reject(v).catch(keep); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    new Promise((resolve) => resolve(v)).then(keep);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(360 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("new Promise((resolve) => resolve(v)).then(keep); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    Promise.resolve().then(() => ({ then(resolve) { resolve(v); } })).then(keep);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(370 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("Promise.resolve().then(() => ({ then(resolve) { resolve(v); } })).then(keep); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    (async () => keep(await { then(resolve) { resolve(v); } }))();
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(380 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("(async () => keep(await { then(resolve) { resolve(v); } }))(); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    (async () => { for await (const x of { [Symbol.asyncIterator]() { let done = false; return { next() { const step = { value: v, done }; done = true; return Promise.resolve(step); } }; } }) keep(x); })();
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(390 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("(async () => { for await (const x of { [Symbol.asyncIterator]() { let done = false; return { next() { const step = { value: v, done }; done = true; return Promise.resolve(step); } }; } }) keep(x); })(); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    Array.fromAsync({ length: 1, get 0() { return v; } }).then(([x]) => keep(x));
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(400 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("Array.fromAsync({ length: 1, get 0() { return v; } }).then(([x]) => keep(x)); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(new Proxy({}, { get() { return v; } }).a);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(410 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(new Proxy({}, { get() { return v; } }).a); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    const p = new Proxy({}, { get() { return v; } }); later(() => p.a);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(420 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("const p = new Proxy({}, { get() { return v; } }); later(() => p.a); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    const p = new Proxy({ a: v }, {}); later(() => p.a);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(430 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("const p = new Proxy({ a: v }, {}); later(() => p.a); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    const p = new Proxy(v, {}); later(() => p);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(440 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("const p = new Proxy(v, {}); later(() => p); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(Object.getOwnPropertyDescriptor(new Proxy({}, { getOwnPropertyDescriptor() { return { get value() { return v; }, configurable: true }; } }), "a").value);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(450 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(Object.getOwnPropertyDescriptor(new Proxy({}, { getOwnPropertyDescriptor() { return { get value() { return v; }, configurable: true }; } }), \"a\").value); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep({ ...new Proxy({}, { ownKeys() { return ["a"]; }, getOwnPropertyDescriptor() { return { value: 1, enumerable: true, configurable: true }; }, get() { return v; } }) }.a);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(460 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep({ ...new Proxy({}, { ownKeys() { return [\"a\"]; }, getOwnPropertyDescriptor() { return { value: 1, enumerable: true, configurable: true }; }, get() { return v; } }) }.a); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(Object.assign({}, new Proxy({}, { ownKeys() { return ["a"]; }, getOwnPropertyDescriptor() { return { value: 1, enumerable: true, configurable: true }; }, get() { return v; } })).a);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(470 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(Object.assign({}, new Proxy({}, { ownKeys() { return [\"a\"]; }, getOwnPropertyDescriptor() { return { value: 1, enumerable: true, configurable: true }; }, get() { return v; } })).a); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(Object.getPrototypeOf(new Proxy({}, { getPrototypeOf() { return v; } })));
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(480 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(Object.getPrototypeOf(new Proxy({}, { getPrototypeOf() { return v; } }))); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(new (new Proxy(function () {}, { construct() { return v; } }))());
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(490 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(new (new Proxy(function () {}, { construct() { return v; } }))()); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(new Proxy(function () {}, { apply() { return v; } })());
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(500 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(new Proxy(function () {}, { apply() { return v; } })()); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    const t = new EventTarget(); t.addEventListener("x", { handleEvent() { keep(v); } }); later(() => (t.dispatchEvent(new Event("x")), kept.pop()));
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(510 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("const t = new EventTarget(); t.addEventListener(\"x\", { handleEvent() { keep(v); } }); later(() => (t.dispatchEvent(new Event(\"x\")), kept.pop())); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    const t = new EventTarget(); t.addEventListener("x", () => keep(v), { get once() { return true; } }); later(() => (t.dispatchEvent(new Event("x")), kept.pop()));
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(520 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("const t = new EventTarget(); t.addEventListener(\"x\", () => keep(v), { get once() { return true; } }); later(() => (t.dispatchEvent(new Event(\"x\")), kept.pop())); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    const t = new EventTarget(); t.addEventListener("x", () => {}, { get once() { keep(v); return true; } });
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(530 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("const t = new EventTarget(); t.addEventListener(\"x\", () => {}, { get once() { keep(v); return true; } }); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(new CustomEvent("x", { get detail() { return v; } }).detail);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(540 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(new CustomEvent(\"x\", { get detail() { return v; } }).detail); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(new Error("m", { get cause() { return v; } }).cause);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(550 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(new Error(\"m\", { get cause() { return v; } }).cause); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(new AggregateError({ [Symbol.iterator]() { let done = false; return { next() { const step = { value: v, done }; done = true; return step; } }; } }).errors[0]);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(560 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(new AggregateError({ [Symbol.iterator]() { let done = false; return { next() { const step = { value: v, done }; done = true; return step; } }; } }).errors[0]); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    [{ toString() { keep(v); return "a"; } }, { toString() { return "b"; } }].sort();
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(570 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("[{ toString() { keep(v); return \"a\"; } }, { toString() { return \"b\"; } }].sort(); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    String({ held: v, toString() { keep(this.held); return ""; } });
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(580 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("String({ held: v, toString() { keep(this.held); return \"\"; } }); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    `${{ [Symbol.toPrimitive]() { keep(v); return ""; } }}`;
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(590 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("'$ {{ [Symbol.toPrimitive]() { keep(v); return \"\"; } }}'; |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    +{ valueOf() { keep(v); return 1; } };
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(600 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("+{ valueOf() { keep(v); return 1; } }; |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    Math.max({ valueOf() { keep(v); return 1; } });
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(610 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("Math.max({ valueOf() { keep(v); return 1; } }); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    parseInt({ toString() { keep(v); return "1"; } });
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(620 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("parseInt({ toString() { keep(v); return \"1\"; } }); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    "a".padEnd({ valueOf() { keep(v); return 1; } });
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(630 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("\"a\".padEnd({ valueOf() { keep(v); return 1; } }); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    [].join.call({ length: 1, get 0() { keep(v); return 1; } });
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(640 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("[].join.call({ length: 1, get 0() { keep(v); return 1; } }); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep("a".replace({ [Symbol.replace]() { return v; } }, ""));
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(650 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(\"a\".replace({ [Symbol.replace]() { return v; } }, \"\")); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep("a".split({ [Symbol.split]() { return v; } }));
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(660 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(\"a\".split({ [Symbol.split]() { return v; } })); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep("a".match({ [Symbol.match]() { return v; } }));
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(670 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(\"a\".match({ [Symbol.match]() { return v; } })); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    "a".replace("a", () => (keep(v), ""));
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(680 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("\"a\".replace(\"a\", () => (keep(v), \"\")); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    "a".replace(/a/, () => (keep(v), ""));
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(690 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("\"a\".replace(/a/, () => (keep(v), \"\")); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    const list = [1]; list.constructor = { [Symbol.species]: function () { return v; } }; keep(list.filter(() => false));
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(700 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("const list = [1]; list.constructor = { [Symbol.species]: function () { return v; } }; keep(list.filter(() => false)); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(Iterator.from({ next() { return { value: v, done: false }; } }).take(1).toArray()[0]);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(710 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(Iterator.from({ next() { return { value: v, done: false }; } }).take(1).toArray()[0]); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(Array.prototype.concat.call([], { length: 1, get 0() { return v; }, [Symbol.isConcatSpreadable]: true })[0]);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(720 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(Array.prototype.concat.call([], { length: 1, get 0() { return v; }, [Symbol.isConcatSpreadable]: true })[0]); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(Array.prototype.map.call({ length: 1, get 0() { return v; } }, (x) => x)[0]);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(730 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(Array.prototype.map.call({ length: 1, get 0() { return v; } }, (x) => x)[0]); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(Array.prototype.slice.call({ length: 1, get 0() { return v; } })[0]);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(740 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(Array.prototype.slice.call({ length: 1, get 0() { return v; } })[0]); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(Array.prototype.find.call({ length: 1, get 0() { return v; } }, () => true));
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(750 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(Array.prototype.find.call({ length: 1, get 0() { return v; } }, () => true)); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(Array.prototype.at.call({ length: 1, get 0() { return v; } }, 0));
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(760 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(Array.prototype.at.call({ length: 1, get 0() { return v; } }, 0)); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(Array.prototype.reduce.call({ length: 1, get 0() { return v; } }, (a, x) => x, 0));
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(770 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(Array.prototype.reduce.call({ length: 1, get 0() { return v; } }, (a, x) => x, 0)); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(Array.prototype.flat.call({ length: 1, get 0() { return v; } })[0]);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(780 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(Array.prototype.flat.call({ length: 1, get 0() { return v; } })[0]); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(Array.prototype.toSorted.call({ length: 1, get 0() { return v; } })[0]);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(790 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(Array.prototype.toSorted.call({ length: 1, get 0() { return v; } })[0]); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(Array.prototype.pop.call({ length: 1, get 0() { return v; } }));
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(800 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(Array.prototype.pop.call({ length: 1, get 0() { return v; } })); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    setTimeout(keep, 0, v);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(810 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("setTimeout(keep, 0, v); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    queueMicrotask(() => keep(v));
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(820 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("queueMicrotask(() => keep(v)); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    process.nextTick(keep, v);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(830 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("process.nextTick(keep, v); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    const below = Object.setPrototypeOf({}, v); later(() => Object.getPrototypeOf(below));
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(840 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("const below = Object.setPrototypeOf({}, v); later(() => Object.getPrototypeOf(below)); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    const below = Object.create(v); later(() => Object.getPrototypeOf(below));
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(850 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("const below = Object.create(v); later(() => Object.getPrototypeOf(below)); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    new ReadableStream({ start(c) { c.enqueue(v); c.close(); } }).getReader().read().then(({ value }) => keep(value));
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(860 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("new ReadableStream({ start(c) { c.enqueue(v); c.close(); } }).getReader().read().then(({ value }) => keep(value)); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(Object.getOwnPropertyDescriptor({ get a() { return v; } }, "a").get());
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(870 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(Object.getOwnPropertyDescriptor({ get a() { return v; } }, \"a\").get()); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(Object.getOwnPropertyDescriptors({ a: v }).a.value);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(880 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(Object.getOwnPropertyDescriptors({ a: v }).a.value); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep([v].at(0));
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(890 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep([v].at(0)); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep([[v]].flat()[0]);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(900 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep([[v]].flat()[0]); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep([1].flatMap(() => [v])[0]);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(910 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep([1].flatMap(() => [v])[0]); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep([v].concat()[0]);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(920 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep([v].concat()[0]); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep([v].slice()[0]);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(930 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep([v].slice()[0]); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep([v].toSorted()[0]);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(940 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep([v].toSorted()[0]); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep([v].toReversed()[0]);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(950 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep([v].toReversed()[0]); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep([1].with(0, v)[0]);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(960 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep([1].with(0, v)[0]); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(Array.of(v)[0]);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(970 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(Array.of(v)[0]); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep([1].fill(v)[0]);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(980 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep([1].fill(v)[0]); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep([v].find(() => true));
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(990 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep([v].find(() => true)); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep([v].reduce((a, x) => x, 0));
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(1000 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep([v].reduce((a, x) => x, 0)); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep([v].values().next().value);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(1010 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep([v].values().next().value); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep([v].entries().next().value[1]);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(1020 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep([v].entries().next().value[1]); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep([v, 1].copyWithin(1, 0)[1]);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(1030 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep([v, 1].copyWithin(1, 0)[1]); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep([v].splice(0, 1)[0]);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(1040 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep([v].splice(0, 1)[0]); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep([v].pop());
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(1050 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep([v].pop()); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep([v].shift());
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(1060 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep([v].shift()); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep([v].map((x) => x)[0]);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(1070 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep([v].map((x) => x)[0]); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep([v].filter(() => true)[0]);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(1080 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep([v].filter(() => true)[0]); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(new Map().set("a", v).get("a"));
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(1090 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(new Map().set(\"a\", v).get(\"a\")); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep([...new Set().add(v)][0]);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(1100 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep([...new Set().add(v)][0]); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(new WeakRef(v).deref());
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(1110 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(new WeakRef(v).deref()); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    const key = {}; keep(new WeakMap().set(key, v).get(key));
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(1120 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("const key = {}; keep(new WeakMap().set(key, v).get(key)); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    function* steps() { yield v; } keep([...steps()][0]);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(1130 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("function* steps() { yield v; } keep([...steps()][0]); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    function* steps() { yield v; } keep(steps().next().value);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(1140 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("function* steps() { yield v; } keep(steps().next().value); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    function* steps() { return v; } keep(steps().next().value);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(1150 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("function* steps() { return v; } keep(steps().next().value); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(new Error("m", new (class { get cause() { return v; } })()).cause);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(1160 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(new Error(\"m\", new (class { get cause() { return v; } })()).cause); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(new Error("m", { __proto__: { cause: v } }).cause);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(1170 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(new Error(\"m\", { __proto__: { cause: v } }).cause); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    new Headers({ get a() { keep(v); return "b"; } });
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(1180 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("new Headers({ get a() { keep(v); return \"b\"; } }); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    new Response(null, { get headers() { keep(v); return undefined; } });
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(1190 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("new Response(null, { get headers() { keep(v); return undefined; } }); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    new Request("http://a/", { get method() { keep(v); return "GET"; } });
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(1200 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("new Request(\"http://a/\", { get method() { keep(v); return \"GET\"; } }); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    new URLSearchParams({ get a() { keep(v); return "1"; } });
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(1210 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("new URLSearchParams({ get a() { keep(v); return \"1\"; } }); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    new Blob([{ toString() { keep(v); return "a"; } }]);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(1220 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("new Blob([{ toString() { keep(v); return \"a\"; } }]); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    new TextDecoder("utf-8", { get fatal() { keep(v); return false; } });
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(1230 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("new TextDecoder(\"utf-8\", { get fatal() { keep(v); return false; } }); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    Buffer.from({ length: 1, get 0() { keep(v); return 1; } });
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(1240 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("Buffer.from({ length: 1, get 0() { keep(v); return 1; } }); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    new Uint8Array({ length: 1, get 0() { keep(v); return 1; } });
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(1250 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("new Uint8Array({ length: 1, get 0() { keep(v); return 1; } }); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    Uint8Array.from({ [Symbol.iterator]() { let done = false; return { next() { const step = { value: 1, done }; done = true; return step; } }; } }, () => (keep(v), 1));
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(1260 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("Uint8Array.from({ [Symbol.iterator]() { let done = false; return { next() { const step = { value: 1, done }; done = true; return step; } }; } }, () => (keep(v), 1)); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    new RegExp({ get [Symbol.match]() { keep(v); return false; }, toString() { return "a"; } });
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(1270 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("new RegExp({ get [Symbol.match]() { keep(v); return false; }, toString() { return \"a\"; } }); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    new Date({ valueOf() { keep(v); return 1; } });
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(1280 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("new Date({ valueOf() { keep(v); return 1; } }); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(Promise.withResolvers().resolve.call(null, v) ?? v);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(1290 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(Promise.withResolvers().resolve.call(null, v) ?? v); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    Promise.try(() => v).then(keep);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(1300 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("Promise.try(() => v).then(keep); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    Promise.resolve(1).finally(() => keep(v));
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(1310 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("Promise.resolve(1).finally(() => keep(v)); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(structuredClone({ get a() { keep(v); return 1; } }).a === 1 ? kept.pop() : 0);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(1320 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(structuredClone({ get a() { keep(v); return 1; } }).a === 1 ? kept.pop() : 0); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    inspect({ [inspect.custom]() { keep(v); return ""; } });
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(1330 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("inspect({ [inspect.custom]() { keep(v); return \"\"; } }); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(new AsyncLocalStorage().run(v, function () { return arguments.length === 0 ? v : 0; }));
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(1340 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(new AsyncLocalStorage().run(v, function () { return arguments.length === 0 ? v : 0; })); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    const store = new AsyncLocalStorage(); keep(store.run(v, () => store.getStore()));
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(1350 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("const store = new AsyncLocalStorage(); keep(store.run(v, () => store.getStore())); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    const e = new EventEmitter(); e.on("x", () => keep(v)); later(() => (e.emit("x"), kept.pop()));
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(1360 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("const e = new EventEmitter(); e.on(\"x\", () => keep(v)); later(() => (e.emit(\"x\"), kept.pop())); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    const e = new EventEmitter(); e.on("x", keep); e.emit("x", v);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(1370 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("const e = new EventEmitter(); e.on(\"x\", keep); e.emit(\"x\", v); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(Object.entries({ a: v }).map(([, x]) => x)[0]);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(1380 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(Object.entries({ a: v }).map(([, x]) => x)[0]); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(Object.freeze({ a: v }).a);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(1390 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(Object.freeze({ a: v }).a); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(Object.freeze(v));
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(1400 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(Object.freeze(v)); |", kept.map(read).join(" "));
  });
}
{
  const kept = [], thunks = [];
  const keep = (x) => { kept.push(x); };
  const later = (f) => { thunks.push(f); };
  function make(n) {
    const v = new Point(n);
    keep(Object.seal([v])[0]);
  }
  for (let i = 0; i < 3; i++) {
    try {
      make(1410 + i);
    } catch (e) {
      kept.push(e.constructor.name);
    }
  }
  reports.push(() => {
    for (const f of thunks) kept.push(f());
    const read = (x) => { try { return typeof x === "string" ? x : x.n; } catch (e) { return "threw " + e.constructor.name; } };
    console.log("keep(Object.seal([v])[0]); |", kept.map(read).join(" "));
  });
}
await new Promise((resolve) => setTimeout(resolve, 10));
console.log(callDeep(500, 1, 2, 3));
Bun.gc(true);
for (const report of reports) report();

// GENERATED: Point detail steps [Symbol.asyncIterator]
// CHECK-LABEL: function {{*}}name="Point"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_1]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: PropSet v5, v1 key="n"
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: v8 = TypeTest v7 testedType=object
// CHECK-NEXT: Branch v8 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: Jump -> next b4(v9)
// CHECK-NEXT: b3(v10):
// CHECK-NEXT: Jump -> next b4(v4)
// CHECK-NEXT: b4(v11):
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="detail"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasExplicitName] captures=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] thisType={type=anything} results=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="steps"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, TakesCallee, HasExplicitName] captures=[{type=env [[L_2]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=undefined|null|Generator<undefined|null|[[L_1]]> flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: env [[L_2]], v1: anything, v2: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v4 = GetEnvironmentField v0 layout=[[L_2]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="v"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: v7 = Yield v6
// CHECK-NEXT: v8 = ResultAt v7
// CHECK-NEXT: v9 = ResultAt v7 index=1
// CHECK-NEXT: Switch v9 cases=[1, 2] -> case b2(), case b3(), otherwise b4()
// CHECK-NEXT: b2():
// CHECK-NEXT: Throw v8
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v8
// CHECK-NEXT: b4():
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="steps"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, TakesCallee, HasExplicitName] captures=[{type=env [[L_3]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=undefined|null|Generator<undefined|null|[[L_1]]> flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: env [[L_3]], v1: anything, v2: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v4 = GetEnvironmentField v0 layout=[[L_3]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="v"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: v7 = Yield v6
// CHECK-NEXT: v8 = ResultAt v7
// CHECK-NEXT: v9 = ResultAt v7 index=1
// CHECK-NEXT: Switch v9 cases=[1, 2] -> case b2(), case b3(), otherwise b4()
// CHECK-NEXT: b2():
// CHECK-NEXT: Throw v8
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v8
// CHECK-NEXT: b4():
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="steps"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, TakesCallee, HasExplicitName] captures=[{type=env [[L_4]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=undefined|null|Generator<never> flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: env [[L_4]], v1: anything, v2: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v4 = GetEnvironmentField v0 layout=[[L_4]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="v"
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.asyncIterator]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsNamedByComputedKey] captures=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] thisType={type=anything} results=[{type=undefined|null|[[L_5]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewObject layout=[[L_6]]
// CHECK-NEXT: v2 = Boolean
// CHECK-NEXT: v3 = Convert v2 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v1, v3 layout=[[L_6]]
// CHECK-NEXT: v5 = NewClosure v1, v0 function=[[f_7]]
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[f_8]]|[[f_9]]|[[f_10]]|[[f_11]]|[[f_12]]|[[f_13]]|[[f_14]]|[[f_15]]|[[f_16]]|[[f_17]]|[[f_18]] flags=[IsExpected]}
// CHECK-NEXT: v7 = NewObject layout=[[L_5]]
// CHECK-NEXT: PropDefine v7, v6 key="next"
// CHECK-NEXT: v9 = FinishObject v7
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
