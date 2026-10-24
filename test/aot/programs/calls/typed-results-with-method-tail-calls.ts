// Methods and functions with a declared result type that return values of their own on some paths and end in a tail call of a method
// on others: a method that subclasses override, a function kept in a field, a method of an interface. Chains of any length run in constant space.
const lines: string[] = [];
function say(...parts: unknown[]) {
  lines.push(parts.map(part => (typeof part === "object" && part !== null ? JSON.stringify(part) : String(part))).join(" "));
}
const deep = 300000;
let sink: unknown;

class Walker {
  bias = 0.5;
  step(n: number, acc: number): number {
    if (n === 0) return acc + this.bias;
    return this.next(n - 1, acc + 1);
  }
  next(n: number, acc: number): number {
    if (n === 0) return acc - this.bias;
    return this.step(n - 1, acc + 2);
  }
  pass(n: number, acc: number): number {
    return this.step(n, acc);
  }
  label(n: number, acc: string): string {
    if (n === 0) return acc + "!";
    return this.relabel(n - 1, acc);
  }
  relabel(n: number, acc: string): string {
    if (n === 0) return acc + "?";
    return this.label(n - 1, n % 100000 === 1 ? acc + "w" : acc);
  }
}
class Strider extends Walker {
  next(n: number, acc: number): number {
    if (n === 0) return acc;
    return this.step(n - 1, acc + 3);
  }
  relabel(n: number, acc: string): string {
    if (n === 0) return acc + ".";
    return this.label(n - 1, n % 100000 === 1 ? acc + "s" : acc);
  }
}
class Idler extends Walker {
  step(n: number, acc: number): number {
    if (n === 0) return acc | 0;
    return this.pass(n - 1, acc);
  }
}
const walkers: Walker[] = [new Walker(), new Strider(), new Idler()];
for (const walker of walkers) say(walker.step(deep, 0) + 1, walker.step(deep + 1, 0) + 1, walker.next(deep, 0), walker.pass(deep, 0), walker.label(deep, ""), walker.label(deep + 1, "").length);
for (const walker of walkers) say(walker.step(0, 1), walker.next(0, 1), walker.pass(0, 1), walker.label(0, "a"), walker.relabel(0, "b"));
say(walkers.map(walker => [walker.step, walker.next, walker.pass].map(method => method.call(walker, deep, 0))));

interface Mapper {
  kind: number;
  func: (n: number, acc: number, mapper: Mapper) => number;
}
function viaField(n: number, acc: number, mapper: Mapper): number {
  if (n === 0) return acc + 0.5;
  return mapper.func(n - 1, acc + mapper.kind, mapper);
}
function viaOtherField(n: number, acc: number, mapper: Mapper): number {
  if (n === 0) return acc - 0.5;
  return mapper.func(n - 1, acc + 2 * mapper.kind, mapper);
}
const mappers: Mapper[] = [
  { kind: 1, func: viaField },
  { kind: 2, func: viaOtherField },
  { kind: 3, func: (n, acc, mapper) => (n === 0 ? acc : viaField(n - 1, acc + 1, mapper)) },
];
say(mappers.map(mapper => viaField(deep, 0, mapper) + 1), mappers.map(mapper => mapper.func(deep + 1, 0, mapper)), mappers.map(mapper => viaOtherField(0, 1, mapper)));

interface Host {
  resolve(n: number, acc: number, host: Host): number;
}
function throughHost(n: number, acc: number, host: Host): number {
  if (n === 0) return acc + 0.25;
  return host.resolve(n - 1, acc + 1, host);
}
const plainHost: Host = { resolve: throughHost };
const inheritingHost: Host = Object.create({ resolve(n: number, acc: number, host: Host) { return n === 0 ? acc : throughHost(n - 1, acc + 2, host); } });
class ClassHost implements Host {
  resolve(n: number, acc: number, host: Host): number {
    if (n === 0) return acc - 0.25;
    return throughHost(n - 1, acc + 3, host);
  }
}
sink = [throughHost, viaField, viaOtherField];
say([plainHost, inheritingHost, new ClassHost()].map(host => throughHost(deep, 0, host) * 2), [plainHost, inheritingHost, new ClassHost()].map(host => host.resolve(deep + 1, 0, host)));

class Chain {
  hop(n: number, acc: number, f: (n: number, acc: number, f: any) => number): number {
    if (n === 0) return acc + 0.5;
    return f(n - 1, acc + 1, f);
  }
  forward(n: number, acc: number, f: (n: number, acc: number, f: any) => number): number {
    return this.hop(n, acc, f);
  }
}
class LongChain extends Chain {
  hop(n: number, acc: number, f: (n: number, acc: number, f: any) => number): number {
    if (n === 0) return acc - 0.5;
    return f(n - 1, acc + 2, f);
  }
}
for (const chain of [new Chain(), new LongChain()] as Chain[]) {
  const loop = (n: number, acc: number, f: any): number => chain.forward(n, acc, f);
  say(chain.forward(deep, 0, loop) + 1, chain.hop(deep, 0, loop) + 1, loop(deep, 0, loop), [loop].map(f => f(deep + 1, 0, f)));
}

let total = 0;
for (let i = 0; i < 20000; i++) {
  const walker = walkers[i % 3];
  total += walker.step(i & 3, i) + walker.pass(i & 1, i) + walker.label(i & 1, "a").length + viaField(i & 3, i, mappers[i % 3]) + throughHost(i & 1, i, plainHost);
}
say(total);
console.log(lines.join("\n"));
