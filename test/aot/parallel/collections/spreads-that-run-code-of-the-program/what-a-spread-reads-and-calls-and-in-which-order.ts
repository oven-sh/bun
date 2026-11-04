// Each read and each call that a spread makes, as a proxy and getters see them.
const seen: string[] = [];
function watched<T extends object>(name: string, target: T): T {
  return new Proxy(target, {
    get(object, key, receiver) { seen.push(name + " get " + String(key)); return Reflect.get(object, key, receiver); },
    has(object, key) { seen.push(name + " has " + String(key)); return Reflect.has(object, key); },
    getOwnPropertyDescriptor(object, key) { seen.push(name + " describe " + String(key)); return Reflect.getOwnPropertyDescriptor(object, key); },
    getPrototypeOf(object) { seen.push(name + " prototype"); return Reflect.getPrototypeOf(object); },
  });
}
function make(limit: number) {
  let step = 0;
  return watched("iterable", {
    [Symbol.iterator]() {
      seen.push("open with " + (this === undefined ? "undefined" : typeof this));
      return watched("iterator", {
        next(...sent: unknown[]) { seen.push("next with " + sent.length + " arguments"); step++; return watched("result " + step, { done: step > limit, value: "v" + step }); },
        return() { seen.push("return"); return {}; },
      });
    },
  });
}
console.log([...make(2)].join()); console.log(seen.join("\n")); seen.length = 0;
(globalThis as any).held = { it: make(1) };
console.log(["head", ...(globalThis as any).held.it, "tail"].join()); console.log(seen.join("\n")); seen.length = 0;
class Truthy { [Symbol.iterator]() { let step = 0; return { next: () => ({ done: [0, "", null, NaN, "yes"][step++], value: step }) }; } }
console.log([...new Truthy()].join());
class Counts { opened = 0; [Symbol.iterator]() { this.opened++; let step = 0; return { next: () => ({ done: step++ > 1, value: step }) }; } }
const counts = new Counts();
console.log([...counts, ...counts].join(), counts.opened);
