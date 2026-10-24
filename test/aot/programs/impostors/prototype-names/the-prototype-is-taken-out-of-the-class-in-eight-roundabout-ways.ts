// Eight classes, eight roundabout ways to get hold of the prototype object: Reflect.get, a computed "prototype", a destructuring pattern, a property descriptor,
// all descriptors, a walk over Reflect.ownKeys, the getter of __proto__ called on an instance, and Object.getPrototypeOf called through Reflect.apply.
interface Probe {
  id: number;
  read(): number | undefined;
  write(value: number): void;
}
const log: string[] = [];
class A implements Probe {
  declare x?: number;
  constructor(public id: number) {}
  read() { return this.x; }
  write(value: number) { this.x = value; }
}
class B implements Probe {
  declare x?: number;
  constructor(public id: number) {}
  read() { return this.x; }
  write(value: number) { this.x = value; }
}
class C implements Probe {
  declare x?: number;
  constructor(public id: number) {}
  read() { return this.x; }
  write(value: number) { this.x = value; }
}
class D implements Probe {
  declare x?: number;
  constructor(public id: number) {}
  read() { return this.x; }
  write(value: number) { this.x = value; }
}
class E implements Probe {
  declare x?: number;
  constructor(public id: number) {}
  read() { return this.x; }
  write(value: number) { this.x = value; }
}
class F implements Probe {
  declare x?: number;
  constructor(public id: number) {}
  read() { return this.x; }
  write(value: number) { this.x = value; }
}
class G implements Probe {
  declare x?: number;
  constructor(public id: number) {}
  read() { return this.x; }
  write(value: number) { this.x = value; }
}
class H implements Probe {
  declare x?: number;
  constructor(public id: number) {}
  read() { return this.x; }
  write(value: number) { this.x = value; }
}
const protoGetter = Object.getOwnPropertyDescriptor(Object.prototype, "__proto__")!.get!;
const routes: [string, new (id: number) => Probe, (old: Probe) => any][] = [
  ["Reflect.get", A, () => Reflect.get(A, "prototype")],
  ["a computed name", B, () => (B as any)["proto" + "type".slice(0)]],
  ["a pattern", C, () => { const { prototype } = C; return prototype; }],
  ["a descriptor", D, () => Object.getOwnPropertyDescriptor(D, "prototype")!.value],
  ["all descriptors", E, () => Object.getOwnPropertyDescriptors(E).prototype.value],
  ["own keys", F, () => Reflect.ownKeys(F).map(key => (F as any)[key]).find(value => typeof value === "object")],
  ["the getter of __proto__", G, old => protoGetter.call(old)],
  ["Reflect.apply", H, old => Reflect.apply(Object.getPrototypeOf, undefined, [old])],
];
function state(probe: Probe) {
  return `${probe.read()} ${"x" in probe} [${Object.keys(probe)}]`;
}
for (const [label, Class, reach] of routes) {
  let sum = 0;
  for (let i = 0; i < 3000; i++) {
    const probe = new Class(i);
    sum += probe.read() ?? 1;
    if (i & 1) probe.write(2);
    sum += probe.read() ?? 1;
  }
  const empty = new Class(1);
  const filled = new Class(2);
  filled.write(20);
  const holder = reach(empty);
  holder.x = 5;
  const value = `${state(empty)} | ${state(filled)} | ${state(new Class(3))}`;
  Object.defineProperty(holder, "x", {
    get() {
      return 6;
    },
    set(this: Probe, value: number) {
      log.push(`${value} on ${this.id}`);
    },
    configurable: true,
  });
  empty.write(7);
  filled.write(21);
  new Class(4).write(8);
  const accessors = `${state(empty)} | ${state(filled)} | ${log.join(", ")}`;
  log.length = 0;
  delete holder.x;
  empty.write(9);
  console.log(`${label}: ${sum} -> ${value} -> ${accessors} -> ${state(empty)} | ${state(new Class(5))}`);
}
