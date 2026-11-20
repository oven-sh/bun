// Each trap lies on Object.prototype, under its name as the file spells it, and the handler is a literal that has none of its own.
// The three that a store through the proxy asks, and the one that a read asks.
import { test } from "bun:test";
function makeSize() { return { width: 1, height: 2 }; }

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
