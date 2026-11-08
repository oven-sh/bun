// The literal has one of the two traps itself, and inherits the other.
import { test } from "bun:test";
function fill(proxy, count) { for (let i = 0; i < count; i++) proxy.width = i; }
test("its own defineProperty, an inherited getOwnPropertyDescriptor", () => {
  let own = 0, inherited = 0;
  const target = { width: 1 };
  const proxy = new Proxy(target, { defineProperty(target, key, descriptor) { own++; return Reflect.defineProperty(target, key, descriptor); } });
  fill(proxy, 300);
  Object.prototype.getOwnPropertyDescriptor = function (target, key) { inherited++; return Reflect.getOwnPropertyDescriptor(target, key); };
  try { fill(proxy, 300); } finally { delete Object.prototype.getOwnPropertyDescriptor; }
  console.log(own, inherited, target.width);
});
test("its own getOwnPropertyDescriptor, an inherited defineProperty", () => {
  let own = 0, inherited = 0;
  const target = { width: 1 };
  const proxy = new Proxy(target, { getOwnPropertyDescriptor(target, key) { own++; return Reflect.getOwnPropertyDescriptor(target, key); } });
  fill(proxy, 300);
  Object.prototype.defineProperty = function (target, key, descriptor) { inherited++; return Reflect.defineProperty(target, key, descriptor); };
  try { fill(proxy, 300); } finally { delete Object.prototype.defineProperty; }
  console.log(own, inherited, target.width);
});
test("its own stands in front of the inherited one", () => {
  let own = 0, inherited = 0;
  const target = { width: 1 };
  const handler = { defineProperty(target, key, descriptor) { own++; return Reflect.defineProperty(target, key, descriptor); } };
  const proxy = new Proxy(target, handler);
  Object.prototype.defineProperty = function (target, key, descriptor) { inherited++; return Reflect.defineProperty(target, key, descriptor); };
  try {
    fill(proxy, 300);
    delete handler.defineProperty;
    fill(proxy, 200);
  } finally { delete Object.prototype.defineProperty; }
  fill(proxy, 100);
  console.log(own, inherited, target.width);
});
test("its own set hands the store on with the proxy as the receiver", () => {
  let stores = 0, inherited = 0;
  const target = { width: 1 };
  const proxy = new Proxy(target, { set(target, key, value, receiver) { stores++; return Reflect.set(target, key, value, receiver); } });
  fill(proxy, 300);
  Object.prototype.defineProperty = function (target, key, descriptor) { inherited++; return Reflect.defineProperty(target, key, descriptor); };
  try { fill(proxy, 300); } finally { delete Object.prototype.defineProperty; }
  console.log(stores, inherited, target.width);
});
test("a field for the trap that holds undefined", () => {
  let inherited = 0;
  const target = { width: 1 };
  const proxy = new Proxy(target, { defineProperty: undefined, label: "plain" });
  Object.prototype.defineProperty = function (target, key, descriptor) { inherited++; return Reflect.defineProperty(target, key, descriptor); };
  try { fill(proxy, 300); } finally { delete Object.prototype.defineProperty; }
  console.log(inherited, target.width);
});
