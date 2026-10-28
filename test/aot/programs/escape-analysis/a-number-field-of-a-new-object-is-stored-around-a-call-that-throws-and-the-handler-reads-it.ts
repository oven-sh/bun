// A number field of a new object is stored on both sides of a call that may throw, the handler reads it, and the object is handed on.
declare const process: any;
let fuel: number = 1500;
function show(v: any): void {
  const c: any = v.constructor;
  c(c);
}
function out(l: string, v: any): void {
  console.log(l, String(v));
  try { show(v); } catch (e) {}
}
process.on("unhandledRejection", (e: any) => out("unhandled", e));
class K {
  x: number;
  constructor(b: number) {
    if (--fuel < 0) throw 0;
    this.x = b;
  }
  m() { return 13; }
}
function f(a: number[]) {
  const s = new K(1).m();
  const n: number = a[2];
  function t(p: number) { if (p) throw 0; }
  function h(p: number) {
    const o = new K(p);
    try {
      o.x = n;
      t(p);
      o.x = s << n;
    } catch (e) {
      out("caught", o.x);
    }
    const r = o.x;
    out("o", o);
    return r;
  }
  h(0);
  h(1);
}
f([]);
