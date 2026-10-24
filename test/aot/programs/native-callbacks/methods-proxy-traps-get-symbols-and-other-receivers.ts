// Methods found through instances: the traps of a handler that is a class instance are called by native code with symbols as keys and with other receivers, while the program's own calls pass strings and the target.
export {};

let total = 0;

type Target = Record<string, number>;

class Watcher implements ProxyHandler<Target> {
  get(target: Target, key: string, receiver: Target): unknown {
    total += typeof key === "string" ? 1 : typeof key === "symbol" ? 1000 : 1000000;
    return Reflect.get(target, key, receiver);
  }
  has(target: Target, key: string): boolean {
    total += typeof key === "string" ? 10000000 : 100000000;
    return key in target;
  }
  set(target: Target, key: string, value: number, receiver: Target): boolean {
    total += receiver === target ? 10 : 100;
    target[key] = typeof value === "number" ? value : -1;
    return true;
  }
}

const target: Target = { a: 1 };
const watcher = new Watcher();
watcher.get(target, "a", target);
watcher.has(target, "a");
watcher.set(target, "b", 2, target);
const proxy: any = new Proxy(target, watcher);
const child = Object.create(proxy);
child.c = "text";
const results: unknown[] = [String(Object.prototype.toString.call(proxy)), JSON.stringify(proxy), [].concat(proxy).length, Symbol.iterator in proxy, Reflect.has(proxy, "a"), await proxy === proxy, `${Object.keys(proxy)}`];
try {
  results.push(`${proxy}`);
} catch (error) {
  results.push((error as Error).name);
}
console.log(total, results.join(" "));
