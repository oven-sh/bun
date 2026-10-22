// Sources of a spread: spreading a proxy runs ownKeys, getOwnPropertyDescriptor and get of a handler that is a class instance, with symbols among the keys; the program's own calls pass strings.
let total = 0;

const tag = Symbol("tag");
type Target = Record<string | symbol, number>;

class Handler implements ProxyHandler<Target> {
  ownKeys(target: Target): (string | symbol)[] {
    total += 1;
    return [...Reflect.ownKeys(target), "ghost"];
  }
  getOwnPropertyDescriptor(target: Target, key: string): PropertyDescriptor | undefined {
    total += typeof key === "string" ? 100 : 10000;
    return key === "ghost" ? { value: 0, enumerable: true, configurable: true } : Reflect.getOwnPropertyDescriptor(target, key);
  }
  get(target: Target, key: string): number | string {
    total += typeof key === "string" ? 1000000 : 100000000;
    return typeof key === "string" ? key.length : "symbol";
  }
}

const handler = new Handler();
const target: Target = { a: 1, bb: 2, [tag]: 3 };
handler.get(target, "own");
handler.getOwnPropertyDescriptor(target, "a");
const proxy = new Proxy(target, handler);
const copy = { ...proxy };
const assigned = Object.assign({}, proxy);
const { a, ...rest } = proxy;
console.log(total, JSON.stringify(copy), String(copy[tag]), Object.keys(assigned).join(), a, Object.keys(rest).join());
