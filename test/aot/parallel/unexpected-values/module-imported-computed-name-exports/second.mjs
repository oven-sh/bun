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

export const a = () => ({ 0: 5, length: 7, push(value) { globalThis.log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { globalThis.log.push("own iterator"); return [8, 9][Symbol.iterator](); } });
export const s = () => Object.assign(new String("xyz"), { charCodeAt: () => -1 });
export const n = () => ({ valueOf() { globalThis.log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { globalThis.log.push("toString"); return "text"; } });
export const f = () => logged(x => x + 2);
export const o = () => logged({ y: 2, x: 1 });
