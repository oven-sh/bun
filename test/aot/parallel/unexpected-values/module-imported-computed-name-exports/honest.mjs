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

export const a = () => [5, 6];
export const s = () => "abc";
export const n = () => 7;
export const f = () => x => x + 1;
export const o = () => ({ x: 1, y: 2 });
