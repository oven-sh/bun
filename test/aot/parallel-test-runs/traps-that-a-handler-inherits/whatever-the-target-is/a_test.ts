// A record, an instance, a list, an ordinary object, a function and an object with a setter stand behind the proxy, and the handler inherits both traps.
import { test } from "bun:test";
type Size = { width: number; height: number };
class Box { width: number = 1; height: number = 2; }
class Measured { #width = 1; stores = 0; get width(): number { return this.#width; } set width(value: number) { this.stores++; } height = 2; }
function makeSize(): Size { return { width: 1, height: 2 }; }
function fill(size: Size, count: number): void { for (let i = 0; i < count; i++) size.width = i; }
function run(what: string, target: Size): void {
  let defined = 0, described = 0;
  const proxy = new Proxy(target, { label: "plain" } as ProxyHandler<Size>);
  fill(proxy, 300);
  (Object.prototype as any).defineProperty = function (target: object, key: PropertyKey, descriptor: PropertyDescriptor) { defined++; return Reflect.defineProperty(target, key, descriptor); };
  (Object.prototype as any).getOwnPropertyDescriptor = function (target: object, key: PropertyKey) { described++; return Reflect.getOwnPropertyDescriptor(target, key); };
  try { fill(proxy, 300); } finally { delete (Object.prototype as any).defineProperty; delete (Object.prototype as any).getOwnPropertyDescriptor; }
  fill(proxy, 5);
  console.log(what, defined, described, target.width);
}
test("a record", () => run("a record", makeSize()));
test("an instance", () => run("an instance", new Box()));
test("an ordinary object", () => run("an ordinary object", JSON.parse('{"width":1,"height":2}')));
test("a function", () => run("a function", Object.assign(function () {}, makeSize())));
test("a frozen record", () => { let told = "stored"; try { run("a frozen record", Object.freeze(makeSize())); } catch (error) { told = (error as Error).constructor.name; } console.log(told); });
test("a record below a record", () => run("a record below a record", Object.create(makeSize())));
test("a list", () => {
  let defined = 0, described = 0;
  const list = [1, 2, 3], proxy = new Proxy(list, { label: "plain" } as ProxyHandler<number[]>);
  for (let i = 0; i < 300; i++) proxy[i % 3] = i;
  (Object.prototype as any).defineProperty = function (target: object, key: PropertyKey, descriptor: PropertyDescriptor) { defined++; return Reflect.defineProperty(target, key, descriptor); };
  (Object.prototype as any).getOwnPropertyDescriptor = function (target: object, key: PropertyKey) { described++; return Reflect.getOwnPropertyDescriptor(target, key); };
  try { for (let i = 0; i < 300; i++) proxy[i % 3] = i; proxy.push(7); proxy.length = 2; } finally { delete (Object.prototype as any).defineProperty; delete (Object.prototype as any).getOwnPropertyDescriptor; }
  console.log("a list", defined, described, list.join());
});
test("a setter takes the store", () => {
  let defined = 0;
  const target = new Measured(), proxy = new Proxy(target, { label: "plain" } as ProxyHandler<Measured>);
  (Object.prototype as any).defineProperty = function (target: object, key: PropertyKey, descriptor: PropertyDescriptor) { defined++; return Reflect.defineProperty(target, key, descriptor); };
  let told = "stored";
  try { for (let i = 0; i < 300; i++) proxy.height = i; } catch (error) { told = (error as Error).constructor.name; } finally { delete (Object.prototype as any).defineProperty; }
  console.log("a setter beside it", told, defined, target.height);
});
