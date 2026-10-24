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

const sets = [
  () => ({ a: [5, 6], s: "abc", n: 7, f: x => x + 1, o: ({ x: 1, y: 2 }) }),
  () => ({ a: Odd.of(5, 6), s: ({ charCodeAt(index) { globalThis.log.push("own charCodeAt " + index); return "mine"; } }), n: "3", f: class Made { constructor(x) { globalThis.log.push("constructed " + x); } }, o: ({ get x() { globalThis.log.push("get x"); return 10; }, set x(value) { globalThis.log.push("set x " + value); }, get y() { globalThis.log.push("get y"); return 20; } }) }),
  () => ({ a: ({ 0: 5, length: 7, push(value) { globalThis.log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { globalThis.log.push("own iterator"); return [8, 9][Symbol.iterator](); } }), s: Object.assign(new String("xyz"), { charCodeAt: () => -1 }), n: ({ valueOf() { globalThis.log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { globalThis.log.push("toString"); return "text"; } }), f: logged(x => x + 2), o: logged({ y: 2, x: 1 }) }),
  () => ({ a: logged([5, 6]), s: ["abc"], n: 10n, f: function (a, b) { return [this.tag, a, b]; }.bind({ tag: "bound" }, "first"), o: Object.freeze({ x: 5, y: 6 }) }),
];

export let { a, s, n, f, o } = sets[0]();

export function replace(index) {
  ({ a, s, n, f, o } = sets[index]());
}
