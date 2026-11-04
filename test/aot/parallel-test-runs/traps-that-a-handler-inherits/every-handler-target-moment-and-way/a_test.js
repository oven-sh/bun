// Every kind of handler x every kind of target x every moment at which the trap is laid x every way to lay it, for both traps: one line each.
import { test } from "bun:test";
class Handler { label = "plain"; }
class HandlerWithGet { get(target, key, receiver) { return Reflect.get(target, key, receiver); } }
class Box { width = 1; height = 2; }
const handlers = {
  literal: () => ({ label: "plain" }),
  empty: () => ({}),
  withGet: () => ({ get(target, key, receiver) { return Reflect.get(target, key, receiver); } }),
  withSet: () => ({ set(target, key, value, receiver) { return Reflect.set(target, key, value, receiver); } }),
  withEmptyFields: () => ({ defineProperty: undefined, getOwnPropertyDescriptor: undefined }),
  withNullFields: () => ({ defineProperty: null, getOwnPropertyDescriptor: null }),
  instance: () => new Handler(),
  instanceWithGet: () => new HandlerWithGet(),
  parsed: () => JSON.parse('{"label":"plain"}'),
  belowLiteral: () => Object.create({ label: "plain" }),
  belowNothing: () => Object.create(null),
  grown: () => { const handler = { label: "plain" }; handler.later = 1; return handler; },
  shrunk: () => { const handler = { label: "plain", gone: 1 }; delete handler.gone; return handler; },
  frozen: () => Object.freeze({ label: "plain" }),
};
const targets = {
  record: () => ({ width: 1, height: 2 }),
  instance: () => new Box(),
  parsed: () => JSON.parse('{"width":1,"height":2}'),
  list: () => Object.assign([1, 2, 3], { width: 1 }),
  fn: () => Object.assign(function () {}, { width: 1 }),
  withoutTheName: () => ({ height: 2 }),
  belowRecord: () => Object.create({ width: 1 }),
};
const traps = {
  defineProperty: count => function (target, key, descriptor) { count.calls++; return Reflect.defineProperty(target, key, descriptor); },
  getOwnPropertyDescriptor: count => function (target, key) { count.calls++; return Reflect.getOwnPropertyDescriptor(target, key); },
};
const ways = {
  stored: (name, trap) => { Object.prototype[name] = trap; },
  defined: (name, trap) => { Object.defineProperty(Object.prototype, name, { configurable: true, writable: true, value: trap }); },
  getter: (name, trap) => { Object.defineProperty(Object.prototype, name, { configurable: true, get() { return trap; } }); },
};
function fill(proxy, count) { for (let i = 0; i < count; i++) proxy.width = i; }
test("all of them", () => {
  for (const name of ["defineProperty", "getOwnPropertyDescriptor"]) {
    for (const way in ways) {
      for (const handlerKind in handlers) {
        for (const targetKind in targets) {
          const told = [];
          for (const moment of ["first", "between", "behind", "warm"]) {
            const count = { calls: 0 }, trap = traps[name](count);
            let target, error = "";
            try {
              if (moment === "first") ways[way](name, trap);
              const handler = handlers[handlerKind]();
              if (moment === "between") ways[way](name, trap);
              target = targets[targetKind]();
              const proxy = new Proxy(target, handler);
              if (moment === "behind") ways[way](name, trap);
              if (moment === "warm") { fill(proxy, 40); ways[way](name, trap); }
              fill(proxy, 20);
              delete Object.prototype[name];
              fill(proxy, 5);
            } catch (thrown) { error = thrown.constructor.name; } finally { delete Object.prototype[name]; }
            told.push(count.calls + ":" + target.width + error);
          }
          console.log(name, way, handlerKind, targetKind, told.join(" "));
        }
      }
    }
  }
});
