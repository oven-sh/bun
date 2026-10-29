// Keys made at run time are stored into objects of a few keys and of many, while the objects above them have, get and lose setters, getters, read-only properties and plain ones under those keys, and a proxy.
let log: string[] = [];
class Base { low = 0; set viaBase(v: unknown) { log.push("Base.viaBase " + String(v)); } get onlyGetter() { return 1; } method() { return 1; } }
class Middle extends Base { mid = 1; set k7(v: unknown) { log.push("Middle.k7 " + String(v)); } static s = 1; }
class Leaf extends Middle { leaf?: number; }
class Plain { a = 1; }
let seed = 1;
function random(limit: number): number { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return (seed >>> 8) % limit; }
const names = ["k1", "k7", "viaBase", "onlyGetter", "method", "added", "frozen", "toString", "constructor", "__proto__", "hasOwnProperty", "k" + 3, "valueOf", "low", "leaf", "12", "length"];
for (let i = 0; i < 6; i++) names.push("r" + i);
function run(theSeed: number): string {
  seed = theSeed * 7919 + 3; log = [];
  const kind = random(5);
  const literalAbove: any = { inherited: 1 };
  const o: any = kind === 0 ? new Leaf() : kind === 1 ? new Plain() : kind === 2 ? Object.setPrototypeOf(new Plain(), literalAbove) : kind === 3 ? Object.setPrototypeOf(new Leaf(), new Middle()) : Object.setPrototypeOf(new Plain(), null);
  for (let i = 100; i < 100 + [0, 10, 80][random(3)]; i++) o["k" + i] = i;
  const chain: any[] = []; for (let p = Object.getPrototypeOf(o); p; p = Object.getPrototypeOf(p)) chain.push(p);
  const undo: (() => void)[] = [];
  for (let step = 0; step < 60; step++) {
    const name = names[random(names.length)];
    const key = random(2) ? name : name.slice(0, 1) + name.slice(1);
    const choice = random(10);
    try {
      if (choice < 5) { "use strict"; o[key] = step; log.push("stored " + key + " " + Object.hasOwn(o, key) + " " + String(o[key])); }
      else if (choice < 6) { delete o[key]; }
      else if (choice < 9 && chain.length) {
        const above = chain[random(chain.length)];
        if (above === Object.prototype) continue;
        const had = Object.getOwnPropertyDescriptor(above, name);
        const form = random(5);
        if (form === 0) Object.defineProperty(above, name, { set(v) { log.push("set above " + name + " " + String(v)); }, configurable: true });
        else if (form === 1) Object.defineProperty(above, name, { value: "ro", writable: false, configurable: true });
        else if (form === 2) Object.defineProperty(above, name, { value: "rw", writable: true, configurable: true });
        else if (form === 3) Object.defineProperty(above, name, { get() { return "got"; }, configurable: true });
        else delete above[name];
        undo.push(() => { if (had) Object.defineProperty(above, name, had); else delete above[name]; });
        log.push("above " + chain.indexOf(above) + " " + name + " " + form);
      } else if (random(6) === 0 && chain.length && kind !== 0 && kind !== 1) {
        const last = chain[chain.length - 1] === Object.prototype ? chain[chain.length - 2] : chain[chain.length - 1];
        if (last) { Object.setPrototypeOf(last, new Proxy({}, { set(t, k, v) { log.push("proxy set " + String(k)); return true; } })); log.push("proxy above"); }
      }
    } catch (e) { log.push("threw " + (e as Error).constructor.name + " " + key); }
  }
  log.push(Reflect.ownKeys(o).map(String).join());
  while (undo.length) undo.pop()!();
  let hash = 0; for (const line of log) for (let i = 0; i < line.length; i++) hash = (Math.imul(hash, 31) + line.charCodeAt(i)) | 0;
  return theSeed + " " + kind + " " + log.length + " " + hash;
}
const out: string[] = [];
for (let s = 1; s <= 300; s++) out.push(run(s));
console.log(out.join("\n"));
