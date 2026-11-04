// Each trap lies on Object.prototype, under its name as the file spells it, and the handler is a literal that has none of its own.
// Twelve of the thirteen: a compiled test run refuses `apply` on Object.prototype aloud.
import { test } from "bun:test";
function makeSize() { return { width: 1, height: 2 }; }
function Point(x) { this.x = x; }

test("getPrototypeOf", () => {
  let calls = 0, seen = 0;
  Object.prototype.getPrototypeOf = function (target) { calls++; return Reflect.getPrototypeOf(target); };
  try {
    const proxy = new Proxy(makeSize(), { label: "plain" });
    for (let i = 0; i < 300; i++) if (Object.getPrototypeOf(proxy) === Object.prototype) seen++;
  } finally { delete Object.prototype.getPrototypeOf; }
  console.log("getPrototypeOf", calls, seen);
});
test("setPrototypeOf", () => {
  let calls = 0, seen = 0;
  Object.prototype.setPrototypeOf = function (target, prototype) { calls++; return Reflect.setPrototypeOf(target, prototype); };
  try {
    const target = makeSize(), above = { depth: 3 };
    const proxy = new Proxy(target, { label: "plain" });
    for (let i = 0; i < 300; i++) { Object.setPrototypeOf(proxy, above); seen += target.depth; }
  } finally { delete Object.prototype.setPrototypeOf; }
  console.log("setPrototypeOf", calls, seen);
});
test("isExtensible", () => {
  let calls = 0, seen = 0;
  Object.prototype.isExtensible = function (target) { calls++; return Reflect.isExtensible(target); };
  try {
    const proxy = new Proxy(makeSize(), { label: "plain" });
    for (let i = 0; i < 300; i++) if (Object.isExtensible(proxy)) seen++;
  } finally { delete Object.prototype.isExtensible; }
  console.log("isExtensible", calls, seen);
});
test("preventExtensions", () => {
  let calls = 0, seen = 0;
  Object.prototype.preventExtensions = function (target) { calls++; return Reflect.preventExtensions(target); };
  try {
    const target = makeSize();
    const proxy = new Proxy(target, { label: "plain" });
    for (let i = 0; i < 300; i++) { Object.preventExtensions(proxy); if (!Object.isExtensible(target)) seen++; }
  } finally { delete Object.prototype.preventExtensions; }
  console.log("preventExtensions", calls, seen);
});
test("getOwnPropertyDescriptor", () => {
  let calls = 0, seen = 0;
  const target = makeSize();
  Object.prototype.getOwnPropertyDescriptor = function (target, key) { calls++; return Reflect.getOwnPropertyDescriptor(target, key); };
  try {
    const proxy = new Proxy(target, { label: "plain" });
    for (let i = 0; i < 300; i++) { proxy.width = i; if (Object.hasOwn(proxy, "height")) seen++; }
  } finally { delete Object.prototype.getOwnPropertyDescriptor; }
  console.log("getOwnPropertyDescriptor", calls, seen, target.width);
});
test("defineProperty", () => {
  let calls = 0;
  const target = makeSize();
  Object.prototype.defineProperty = function (target, key, descriptor) { calls++; return Reflect.defineProperty(target, key, descriptor); };
  try {
    const proxy = new Proxy(target, { label: "plain" });
    for (let i = 0; i < 300; i++) proxy.width = i;
  } finally { delete Object.prototype.defineProperty; }
  console.log("defineProperty", calls, target.width);
});
test("has", () => {
  let calls = 0, seen = 0;
  Object.prototype.has = function (target, key) { calls++; return Reflect.has(target, key); };
  try {
    const proxy = new Proxy(makeSize(), { label: "plain" });
    for (let i = 0; i < 300; i++) if ("width" in proxy) seen++;
  } finally { delete Object.prototype.has; }
  console.log("has", calls, seen);
});
test("get", () => {
  let calls = 0, seen = 0;
  Object.prototype.get = function (target, key, receiver) { calls++; return Reflect.get(target, key, receiver); };
  try {
    const proxy = new Proxy(makeSize(), { label: "plain" });
    for (let i = 0; i < 300; i++) seen += proxy.height;
  } finally { delete Object.prototype.get; }
  console.log("get", calls, seen);
});
test("set", () => {
  let calls = 0;
  const target = makeSize();
  Object.prototype.set = function (target, key, value) { calls++; target[key] = value + 1; return true; };
  try {
    const proxy = new Proxy(target, { label: "plain" });
    for (let i = 0; i < 300; i++) proxy.width = i;
  } finally { delete Object.prototype.set; }
  console.log("set", calls, target.width);
});
test("deleteProperty", () => {
  let calls = 0, seen = 0;
  Object.prototype.deleteProperty = function (target, key) { calls++; return Reflect.deleteProperty(target, key); };
  try {
    const target = makeSize();
    const proxy = new Proxy(target, { label: "plain" });
    for (let i = 0; i < 300; i++) { target.width = i; delete proxy.width; if (!("width" in target)) seen++; }
  } finally { delete Object.prototype.deleteProperty; }
  console.log("deleteProperty", calls, seen);
});
test("ownKeys", () => {
  let calls = 0, seen = 0;
  Object.prototype.ownKeys = function (target) { calls++; return Reflect.ownKeys(target); };
  try {
    const proxy = new Proxy(makeSize(), { label: "plain" });
    for (let i = 0; i < 300; i++) seen += Object.keys(proxy).length;
  } finally { delete Object.prototype.ownKeys; }
  console.log("ownKeys", calls, seen);
});
test("construct", () => {
  let calls = 0, seen = 0;
  Object.prototype.construct = function (target, operands, newTarget) { calls++; return Reflect.construct(target, operands, newTarget); };
  try {
    const proxy = new Proxy(Point, { label: "plain" });
    for (let i = 0; i < 300; i++) seen += new proxy(i).x;
  } finally { delete Object.prototype.construct; }
  console.log("construct", calls, seen);
});
