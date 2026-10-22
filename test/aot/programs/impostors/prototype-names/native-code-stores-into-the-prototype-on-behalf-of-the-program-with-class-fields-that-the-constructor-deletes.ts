// Built-ins that store into an object they are handed, or into a receiver: a Proxy without traps around the prototype, Reflect.set with the prototype as the receiver,
// Array.prototype.push called on it (makes "length"), Error.captureStackTrace (makes "stack"), Array.from with a constructor that returns it, and Object.fromEntries feeding Object.assign.
// In this twin the optional fields are class fields without `declare`: they are defined at birth and the constructor deletes them, so the slots are declared and empty. Every instance may reach unknown code.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
class ThroughProxy {
  tag?: number;
  constructor(public id: number) {
    delete this.tag;
    handOver(this);
  }
  read() { return this.tag; }
  write(value: number) { this.tag = value; }
}
class AsReceiver {
  tag?: number;
  constructor(public id: number) {
    delete this.tag;
    handOver(this);
  }
  read() { return this.tag; }
  write(value: number) { this.tag = value; }
}
class Pushed {
  length?: number;
  constructor(public id: number) {
    delete this.length;
    handOver(this);
  }
  read() { return this.length; }
  write(value: number) { this.length = value; }
}
class Traced {
  stack?: string;
  constructor(public id: number) {
    delete this.stack;
    handOver(this);
  }
  read() { return this.stack; }
  write(value: string) { this.stack = value; }
}
class Listed {
  length?: number;
  constructor(public id: number) {
    delete this.length;
    handOver(this);
  }
  read() { return this.length; }
  write(value: number) { this.length = value; }
}
class Assigned {
  tag?: number;
  constructor(public id: number) {
    delete this.tag;
    handOver(this);
  }
  read() { return this.tag; }
  write(value: number) { this.tag = value; }
}
function own(object: object) {
  return `[${Object.keys(object)}]`;
}

let sum = 0;
for (let i = 0; i < 3000; i++) {
  const a = new ThroughProxy(i), b = new AsReceiver(i), c = new Pushed(i), d = new Traced(i), e = new Listed(i), f = new Assigned(i);
  sum += (a.read() ?? 1) + (b.read() ?? 1) + (c.read() ?? 1) + (d.read()?.length ?? 1) + (e.read() ?? 1) + (f.read() ?? 1);
  if (i & 1) {
    a.write(2);
    b.write(2);
    c.write(2);
    d.write("st");
    e.write(2);
    f.write(2);
  }
  sum += (a.read() ?? 1) + (b.read() ?? 1) + (c.read() ?? 1) + (d.read()?.length ?? 1) + (e.read() ?? 1) + (f.read() ?? 1);
}
console.log("warm", sum);

const a = new ThroughProxy(1), b = new AsReceiver(1), c = new Pushed(1), d = new Traced(1), e = new Listed(1), f = new Assigned(1);
const veil: any = new Proxy(ThroughProxy.prototype, {});
veil.tag = 10;
console.log("a proxy without traps:", a.read(), own(a), new ThroughProxy(2).read());
Object.defineProperty(veil, "tag", { get: () => 11, configurable: true });
console.log("a definition through it:", a.read(), own(a), new ThroughProxy(2).read());
delete veil.tag;
console.log("a delete through it:", a.read(), new ThroughProxy(2).read());

console.log("a receiver:", Reflect.set({}, "tag", 20, AsReceiver.prototype), b.read(), own(b), new AsReceiver(2).read());
console.log("push:", Array.prototype.push.call(Pushed.prototype, "a", "b"), c.read(), own(c), new Pushed(2).read(), (c as any)[1]);
Error.captureStackTrace(Traced.prototype);
console.log("captureStackTrace:", typeof d.read(), own(d), typeof new Traced(2).read(), Object.hasOwn(Traced.prototype, "stack"));
const made = (Array.from as any).call(function () { return Listed.prototype; }, ["x", "y", "z"]);
console.log("Array.from:", made === (Listed.prototype as unknown), e.read(), own(e), new Listed(2).read());
Object.assign(Assigned.prototype, Object.fromEntries([["tag", 60]]));
console.log("fromEntries and assign:", f.read(), own(f), new Assigned(2).read());

b.write(21);
c.write(31);
d.write("own");
e.write(51);
f.write(61);
console.log("own ones over them:", b.read(), own(b), c.read(), own(c), d.read(), own(d), e.read(), own(e), f.read(), own(f));
