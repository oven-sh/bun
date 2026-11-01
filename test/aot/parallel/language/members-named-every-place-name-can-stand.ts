// Members are named in every way the language has: read, written, called, constructed, deleted, behind `super`, `import.meta` and optional chains, as keys of literals, classes and patterns.
import * as path from "node:path";
class Base {
  greet() {
    return "base";
  }
  static make() {
    return new this();
  }
  get size() {
    return 1;
  }
  set size(v: number) {}
}
class Point extends Base {
  x = 1;
  y = 2;
  static origin = new Point();
  greet() {
    return super.greet() + this.x;
  }
  get size() {
    return super.size + 1;
  }
  static {
    Point.origin.x = 0;
  }
  sum() {
    return this.x + this.y;
  }
}
function read(p: Point) {
  return p.x + p.y;
}
function write(p: Point, v: number) {
  p.x = v;
  p.y += v;
  p.x++;
  return p;
}
function call(p: Point) {
  return p.sum() + p.greet().length;
}
function optional(p?: Point) {
  return p?.x ?? p?.sum?.();
}
function make() {
  return {
    a: 1,
    b: "two",
    c() {
      return this.a;
    },
    get d() {
      return 4;
    },
  };
}
function pattern({ a, b: renamed, c = 5 }: { a: number; b: string; c?: number }) {
  return a + renamed + c;
}
function remove(o: { a?: number }) {
  delete o.a;
  return "a" in o;
}
function host() {
  return typeof process.env.HOME + path.join("a", "b") + globalThis.Math.max(1, 2) + import.meta.url.length + Math.PI;
}
function construct() {
  const ns = { Point };
  return new ns.Point().x;
}
function tag(o: { t(s: TemplateStringsArray): string }) {
  return o.t`x`;
}
function untyped(o: any) {
  o.k = o.k + 1;
  o.m();
  return o.length + o.name + o.constructor.name + o.prototype;
}
function symbols() {
  return {
    [Symbol.iterator]() {
      return [1][Symbol.iterator]();
    },
  };
}
console.log(
  read(new Point()),
  write(new Point(), 2).x,
  call(new Point()),
  optional(),
  optional(new Point()),
  make().c(),
  make().d,
  pattern({ a: 1, b: "x" }),
  remove({ a: 1 }),
  host().length > 0,
  construct(),
  tag({ t: s => s[0] }),
  [...symbols()],
  Point.make().greet(),
);
try {
  untyped({ k: 1, m() {} });
  console.log("ok");
} catch (e) {
  console.log(String(e));
}
