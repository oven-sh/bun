const nothing: any = null;
let depth = 0;
function fail(): never {
  throw new RangeError("fail " + depth);
}
class A {
  x: number;
  m = nothing.y;
  constructor(x: number) {
    this.x = x;
  }
}
class B {
  m = [nothing()];
  constructor(public y: number) {}
}
class C {
  m = new nothing.Thing();
  z: number;
  constructor(y: number) {
    this.z = y;
  }
}
class D {
  m = missing;
  z: number;
  constructor(y: number) {
    this.z = y;
  }
}
class E {
  ok = new Map();
  m = fail();
  constructor(public z: number, w = console.log("no default is evaluated")) {}
}
class F {
  m = new Error("made");
  z: number;
  constructor(z: number) {
    this.z = z;
  }
}
class G {
  m = later;
  z: number;
  constructor(z: number) {
    this.z = z;
  }
}
class H {
  m = [...(5 as any)];
  z = BigInt("x");
  constructor(public q: number) {}
}
class I {
  m = (() => fail())();
  constructor(public q: number) {}
}
class J {
  m = new (class {
    z = nothing.z;
    constructor(public y: number) {}
  })(5);
  constructor(public q: number) {}
}
declare const missing: any;
const frames = (error: any) =>
  error.stack
    .split("\n")
    .slice(1)
    .map((line: string) => line.trim().replace(/\(.*\//, "(").replace(/at \S*\//, "at "))
    .join(" | ");
for (const construct of [() => new A(1), () => new B(2), () => new C(3), () => new D(4), () => new E(5), () => new G(6), () => new H(7), () => new I(8), () => new J(9)]) {
  for (let turn = 0; turn < 2; turn++) {
    depth++;
    try {
      console.log(construct());
    } catch (error: any) {
      console.log(error.name, error.line, error.column, "|", frames(error));
    }
  }
}
console.log(frames(new F(1).m), new F(1).m.message);
let later = 5;
console.log(new G(6).m, new G(7).z);
Error.prepareStackTrace = (error, sites) => sites.map(site => site.getFunctionName() + ":" + site.getLineNumber() + ":" + site.isConstructor()).join(" ");
for (const construct of [() => new A(1), () => new B(2), () => new C(3), () => new E(4), () => new J(5)]) {
  try {
    construct();
  } catch (error: any) {
    console.log(error.stack);
  }
}
console.log(new F(2).m.stack);
