class Odd extends Array {
  push(value) {
    globalThis.log.push("Odd.push " + value);
    return 42;
  }
  *[Symbol.iterator]() {
    globalThis.log.push("Odd.iterator");
    yield "odd";
  }
}

function logged(target) {
  return new Proxy(target, {
    get(target, key, receiver) {
      globalThis.log.push("get " + String(key));
      return Reflect.get(target, key, receiver);
    },
    set(target, key, value, receiver) {
      globalThis.log.push("set " + String(key));
      return Reflect.set(target, key, value, receiver);
    },
    apply(target, self, list) {
      globalThis.log.push("apply " + list.length);
      return Reflect.apply(target, self, list);
    },
  });
}

export const a = () => Odd.of(5, 6);
export const s = () => ({ charCodeAt(index) { globalThis.log.push("own charCodeAt " + index); return "mine"; } });
export const n = () => "3";
export const f = () => class Made { constructor(x) { globalThis.log.push("constructed " + x); } };
export const o = () => ({ get x() { globalThis.log.push("get x"); return 10; }, set x(value) { globalThis.log.push("set x " + value); }, get y() { globalThis.log.push("get y"); return 20; } });
