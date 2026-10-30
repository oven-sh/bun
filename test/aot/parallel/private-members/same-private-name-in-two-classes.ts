// Top-level classes declare private fields, methods, accessors and statics with the same names. Each class finds only its own members.
function attempt(f: () => unknown): string { try { return String(f()); } catch (e) { return "threw " + (e as Error).name; } }
const collect: () => void = (globalThis as any).gc ?? (() => (globalThis as any).Bun.gc(true));

interface Probe {
  has(o: any): boolean;
  hasEach(o: any): string;
  read(o: any): number;
  write(o: any, v: number): number;
  call(o: any): string;
  readAccessor(o: any): string;
  writeAccessor(o: any, v: string): void;
  readStatic(o: any): string;
}

class A {
  #x = 1;
  #m(): string { return "A.#m " + this.#x; }
  get #g(): string { return "A.#g " + this.#x; }
  set #g(v: string) { this.#x = v.length; }
  static #s = "A.#s";
  static has(o: any): boolean { return #x in o; }
  static hasEach(o: any): string { return [#x in o, #m in o, #g in o, #s in o].join(); }
  static read(o: any): number { return o.#x; }
  static write(o: any, v: number): number { return o.#x = v; }
  static call(o: any): string { return o.#m(); }
  static readAccessor(o: any): string { return o.#g; }
  static writeAccessor(o: any, v: string): void { o.#g = v; }
  static readStatic(o: any): string { return o.#s; }
  static readTyped(o: A): number { return o.#x; }
}
class B {
  #x = 2;
  #m(): string { return "B.#m " + this.#x; }
  get #g(): string { return "B.#g " + this.#x; }
  set #g(v: string) { this.#x = v.length; }
  static #s = "B.#s";
  static has(o: any): boolean { return #x in o; }
  static hasEach(o: any): string { return [#x in o, #m in o, #g in o, #s in o].join(); }
  static read(o: any): number { return o.#x; }
  static write(o: any, v: number): number { return o.#x = v; }
  static call(o: any): string { return o.#m(); }
  static readAccessor(o: any): string { return o.#g; }
  static writeAccessor(o: any, v: string): void { o.#g = v; }
  static readStatic(o: any): string { return o.#s; }
  static readTyped(o: B): number { return o.#x; }
}

console.log("has", A.has(new B()), B.has(new A()), A.has(new A()), B.has(new B()));
console.log("read", attempt(() => A.read(new B())), attempt(() => B.read(new A())), attempt(() => A.read(new A())), attempt(() => B.read(new B())));
console.log("typed read", attempt(() => A.readTyped(new B() as any)), attempt(() => B.readTyped(new A() as any)), A.readTyped(new A()), B.readTyped(new B()));

class C extends A {
  #x = 3;
  #m(): string { return "C.#m " + this.#x; }
  get #g(): string { return "C.#g " + this.#x; }
  set #g(v: string) { this.#x = v.length; }
  static #s = "C.#s";
  static has(o: any): boolean { return #x in o; }
  static hasEach(o: any): string { return [#x in o, #m in o, #g in o, #s in o].join(); }
  static read(o: any): number { return o.#x; }
  static write(o: any, v: number): number { return o.#x = v; }
  static call(o: any): string { return o.#m(); }
  static readAccessor(o: any): string { return o.#g; }
  static writeAccessor(o: any, v: string): void { o.#g = v; }
  static readStatic(o: any): string { return o.#s; }
}

const probes: [string, Probe][] = [["A", A], ["B", B], ["C", C]];
const values: [string, () => any][] = [
  ["an A", () => new A()],
  ["a B", () => new B()],
  ["a C", () => new C()],
  ["class A", () => A],
  ["class B", () => B],
  ["class C", () => C],
  ["an object", () => ({})],
  ["an object that inherits from an A", () => Object.create(new A())],
  ["a proxy of an A", () => new Proxy(new A(), {})],
  ["a number", () => 1],
  ["null", () => null],
];
function report(): void {
  for (const [name, probe] of probes) {
    for (const [title, create] of values) {
      console.log(name, "with", title + ":", [
        attempt(() => probe.has(create())),
        attempt(() => probe.hasEach(create())),
        attempt(() => probe.read(create())),
        attempt(() => probe.write(create(), 7)),
        attempt(() => probe.call(create())),
        attempt(() => probe.readAccessor(create())),
        attempt(() => probe.writeAccessor(create(), "four")),
        attempt(() => probe.readStatic(create())),
      ].join(" | "));
    }
  }
}
report();

const both = new C();
console.log("both", A.read(both), C.read(both), attempt(() => B.read(both)));
A.write(both, 10);
console.log("both", A.read(both), C.read(both), A.call(both), C.call(both));
C.writeAccessor(both, "twelve chars");
console.log("both", A.read(both), C.read(both), A.readAccessor(both), C.readAccessor(both));
collect();
console.log("both", A.read(both), C.read(both), attempt(() => B.write(both, 1)), A.hasEach(both), B.hasEach(both), C.hasEach(both));
report();
