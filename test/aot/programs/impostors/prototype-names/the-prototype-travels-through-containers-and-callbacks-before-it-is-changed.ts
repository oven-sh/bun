// The prototype object is put away and comes back as a value of no particular type: out of a Map, a WeakRef, a resolved promise, an argument of setTimeout,
// the arguments object, a generator, a sorted array and an event. Only then it gets the name. One class for each way.
import { EventEmitter } from "node:events";
interface Probe {
  id: number;
  read(): string | undefined;
  write(value: string): void;
}
class A implements Probe {
  declare t?: string;
  constructor(public id: number) {}
  read() { return this.t; }
  write(value: string) { this.t = value; }
}
class B implements Probe {
  declare t?: string;
  constructor(public id: number) {}
  read() { return this.t; }
  write(value: string) { this.t = value; }
}
class C implements Probe {
  declare t?: string;
  constructor(public id: number) {}
  read() { return this.t; }
  write(value: string) { this.t = value; }
}
class D implements Probe {
  declare t?: string;
  constructor(public id: number) {}
  read() { return this.t; }
  write(value: string) { this.t = value; }
}
class E implements Probe {
  declare t?: string;
  constructor(public id: number) {}
  read() { return this.t; }
  write(value: string) { this.t = value; }
}
class F implements Probe {
  declare t?: string;
  constructor(public id: number) {}
  read() { return this.t; }
  write(value: string) { this.t = value; }
}
class G implements Probe {
  declare t?: string;
  constructor(public id: number) {}
  read() { return this.t; }
  write(value: string) { this.t = value; }
}
class H implements Probe {
  declare t?: string;
  constructor(public id: number) {}
  read() { return this.t; }
  write(value: string) { this.t = value; }
}
function lastArgument(..._: unknown[]) {
  return arguments[arguments.length - 1];
}
function* handOver(value: unknown) {
  yield value;
}
const routes: [string, new (id: number) => Probe, () => unknown][] = [
  ["a map", A, () => new Map<string, unknown>([["k", A.prototype]]).get("k")],
  ["a weak reference", B, () => new WeakRef<object>(B.prototype).deref()],
  ["a promise", C, () => Promise.resolve(C.prototype as unknown)],
  ["a timer", D, () => new Promise(resolve => setTimeout(resolve, 0, D.prototype))],
  ["the arguments object", E, () => lastArgument(1, 2, E.prototype)],
  ["a generator", F, () => handOver(F.prototype).next().value],
  ["a sorted array", G, () => [{ n: 2, v: null as unknown }, { n: 1, v: G.prototype }].sort((a, b) => a.n - b.n)[0].v],
  ["an event", H, () => new Promise(resolve => { const emitter = new EventEmitter(); emitter.once("ready", resolve); emitter.emit("ready", H.prototype); })],
];
const log: string[] = [];
function state(probe: Probe) {
  return `${probe.read()} ${"t" in probe} [${Object.keys(probe)}]`;
}
for (const [label, Class, route] of routes) {
  let length = 0;
  for (let i = 0; i < 3000; i++) {
    const probe = new Class(i);
    length += probe.read()?.length ?? 1;
    if (i & 1) probe.write("ab");
    length += probe.read()?.length ?? 1;
  }
  const empty = new Class(1);
  const holder: any = await route();
  Object.defineProperty(holder, "t", {
    get(this: Probe) {
      return "inherited by " + this.id;
    },
    set(this: Probe, value: string) {
      log.push(`${value} on ${this.id}`);
    },
    configurable: true,
  });
  const before = `${state(empty)} | ${state(new Class(2))}`;
  empty.write("w");
  console.log(`${label}: ${length} -> ${before} -> ${state(empty)} | ${log.join(", ")}`);
  log.length = 0;
}
