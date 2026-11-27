// The trap of the next public definition reads the private name laid in front of it: it holds undefined until its store.
let last: object = {}; let seen = "";
class Hands { constructor() { last = new Proxy({}, { defineProperty(target, key, descriptor) { seen += String(key) + ":" + String(Heir.read(last)) + ";"; return Reflect.defineProperty(target, key, descriptor); } }); return last; } }
class Heir extends Hands { #x: number; y: number; constructor(v: number) { super(); this.#x = v; this.y = v; } static read(it: object): unknown { return (it as Heir).#x; } }
new Heir(7); console.log(seen);
