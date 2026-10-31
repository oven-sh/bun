import { probe, keep, fail } from "./probes.js";

export function probeTyped(seen: object): string {
  return Object.keys(seen).join() + "|" + ("h" in seen) + "|" + Object.prototype.hasOwnProperty.call(seen, "h") + "|" + JSON.stringify(seen) + "|" + Object.keys({ ...seen }).length;
}

export class Core {
  first!: string;
  a = 1;
  b: string = probe(this);
  c = 2;
  d?: number;
  e: string = probe(this);
  f = () => this.a;
  g: string = probe(this);
  h = 3;
  last!: number;
  constructor(seed: number) {
    this.a = seed;
  }
}
export function sumOfCore(core: Core): number {
  return core.a + core.c + core.h + core.f();
}

export class SeenByTypedCode {
  a = 1;
  b: string = probeTyped(this);
  c = "c";
  d: string = probeTyped(this);
  h = 3;
}
export function sumOfSeenByTypedCode(seen: SeenByTypedCode): number {
  return seen.a + seen.h + seen.b.length + seen.d.length;
}

export class Base {
  a = 1;
  b: string = probe(this);
  c = 2;
}
export class Middle extends Base {
  m = 10;
  n: string = probe(this);
  o!: number;
  p = 11;
}
export function sumOfMiddle(middle: Middle): number {
  return middle.a + middle.c + middle.m + middle.p;
}

export class Throws {
  a = 1;
  kept: number = keep(this);
  b = 2;
  c: number = fail("in the middle");
  d = 4;
}
export function sumOfThrows(value: Throws): number {
  return value.a + value.b;
}

export class InTheConstructor {
  a = 1;
  b!: number;
  c = 3;
  seen: string;
  late?: number;
  constructor() {
    this.seen = probe(this);
    this.b = 2;
    this.late = 5;
  }
}
export function sumOfInTheConstructor(value: InTheConstructor): number {
  return value.a + value.b + value.c;
}

export class NamesAFunction {
  a = 1;
  f = () => this.a;
  named = probeTyped;
  imported = probe;
  z = 2;
}
export function sumOfNamesAFunction(value: NamesAFunction): number {
  return value.a + value.z + value.f();
}

export class DefinedNotSet {
  a = 1;
  guarded = 2;
  b: string = probe(this);
  alsoGuarded = 3;
  bare!: number;
}
export function sumOfDefinedNotSet(value: DefinedNotSet): number {
  return value.a + value.guarded + value.alsoGuarded;
}

export class Both {
  a = 1;
  b: string = probe(this);
  c = 2;
  d!: number;
}
export function makeBoth(): Both {
  return new Both();
}
export function sumOfBoth(value: Both): number {
  return value.a + value.c;
}

export class Wide {
  f0!: string;
  f1: number = 1;
  f2: number = 2;
  f3!: string;
  f4: number = 4;
  f5: number = 5;
  f6!: string;
  f7: number = 7;
  f8: number = 8;
  f9!: string;
  f10: number = 10;
  f11: number = 11;
  f12!: string;
  f13: number = 13;
  f14: number = 14;
  f15!: string;
  f16: number = 16;
  f17: number = 17;
  f18!: string;
  f19: number = 19;
  f20: number = 20;
  f21!: string;
  f22: number = 22;
  f23: number = 23;
  f24!: string;
  f25: number = 25;
  f26: number = 26;
  f27!: string;
  f28: number = 28;
  f29: number = 29;
  f30: string = probe(this).length + "";
  f31: number = 31;
  f32: number = 32;
  f33!: string;
  f34: number = 34;
  f35: number = 35;
  f36!: string;
  f37: number = 37;
  f38: number = 38;
  f39!: string;
  f40: number = 40;
  f41: number = 41;
  f42!: string;
  f43: number = 43;
  f44: number = 44;
  f45!: string;
  f46: number = 46;
  f47: number = 47;
  f48!: string;
  f49: number = 49;
  f50: number = 50;
  f51!: string;
  f52: number = 52;
  f53: number = 53;
  f54!: string;
  f55: number = 55;
  f56: number = 56;
  f57!: string;
  f58: number = 58;
  f59: number = 59;
  f60!: string;
  f61: number = 61;
  f62: number = 62;
  f63!: string;
  f64: number = 64;
  f65: number = 65;
  f66!: string;
  f67: number = 67;
  f68: number = 68;
  f69!: string;
  f70: string = probe(this).length + "";
  f71: number = 71;
  f72!: string;
  f73: number = 73;
}
export function sumOfWide(wide: Wide): number {
  return wide.f1 + wide.f73;
}
