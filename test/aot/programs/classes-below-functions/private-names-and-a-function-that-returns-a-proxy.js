const seen = [];
function Meter(wrap) { this.made = 1; if (wrap) return new Proxy(this, { defineProperty(target, key, descriptor) { seen.push("define " + String(key)); return Reflect.defineProperty(target, key, descriptor); }, get(target, key, receiver) { return Reflect.get(target, key, receiver); } }); }
class Fine extends Meter { #secret = 7; extra = 2; read() { return this.#secret + this.extra + this.made; } static has(it) { return #secret in it; } }
const plain = new Fine(false), wrapped = new Fine(true);
console.log(plain.read(), wrapped.read(), Fine.has(plain), Fine.has(wrapped), seen.join(), JSON.stringify(wrapped));
