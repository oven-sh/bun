// A constructor that returns another object: the class below puts its names on a foreign object, which has no such layout.
class Return { constructor(o: any) { return o; } }
class Stamp extends Return {
  #x = 1; #m() { return "m" + this.#x; }
  constructor(o: any) { super(o); }
  static get(o: any) { return o.#x; } static set(o: any, v: number) { o.#x = v; } static has(o: any) { return #x in o; } static call(o: any) { return o.#m(); }
}
class Point { x = 1; y = 2; }
function attempt(name: string, f: () => unknown) { try { console.log(name, f()); } catch (e: any) { console.log(name, e instanceof TypeError, e.constructor.name); } }
const plain: any = { a: 1 }, point = new Point(), list: any = [1, 2], fn: any = function () {}, frozen = Object.freeze({ f: 1 }), proxy = new Proxy({}, {});
const own = new Stamp(undefined as any);
for (const [name, o] of [["plain", plain], ["point", point], ["list", list], ["fn", fn], ["frozen", frozen], ["proxy", proxy], ["class", Stamp]] as const) {
  attempt(name + " has before", () => Stamp.has(o));
  attempt(name + " get before", () => Stamp.get(o));
  attempt(name + " stamp", () => new Stamp(o) === o);
  attempt(name + " has", () => Stamp.has(o));
  attempt(name + " get", () => Stamp.get(o));
  attempt(name + " set", () => Stamp.set(o, 5));
  attempt(name + " get", () => Stamp.get(o));
  attempt(name + " call", () => Stamp.call(o));
  attempt(name + " stamp twice", () => new Stamp(o));
  attempt(name + " keys", () => Reflect.ownKeys(o).filter(k => typeof k !== "string" || !["length", "name", "prototype", "arguments", "caller"].includes(k)).length);
}
attempt("own get", () => Stamp.get(own));
attempt("own stamp twice", () => new Stamp(own));
attempt("point fields", () => point.x + point.y);
let sum = 0;
const mixed: any[] = [own, plain, point, new Stamp(undefined as any)];
for (let i = 0; i < 1000; i++) { const o = mixed[i & 3]; Stamp.set(o, Stamp.get(o) + 1); sum += Stamp.get(o); }
console.log(sum);
