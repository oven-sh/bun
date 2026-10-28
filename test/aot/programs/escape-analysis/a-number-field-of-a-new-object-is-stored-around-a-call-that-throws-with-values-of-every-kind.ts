// A number field of a new object is stored on both sides of a call that may throw, the handler reads it, and the object is handed on: with values of every kind and three operators.
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
class K1 {
  x: number;
  constructor(b: number) {
    if (--fuel < 0) throw 0;
    this.x = b;
  }
  m() { return 13; }
}
function f1(a: number[]) {
  const s = new K1(1).m();
  const n: number = a[2];
  function t(p: number) { if (p) throw 0; }
  function h(p: number) {
    const o = new K1(p);
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
console.log("undefined, s << n");
f1([]);
class K2 {
  x: number;
  constructor(b: number) {
    if (--fuel < 0) throw 0;
    this.x = b;
  }
  m() { return 13; }
}
function f2(a: number[]) {
  const s = new K2(1).m();
  const n: number = a[2];
  function t(p: number) { if (p) throw 0; }
  function h(p: number) {
    const o = new K2(p);
    try {
      o.x = n;
      t(p);
      o.x = s | n;
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
console.log("undefined, s | n");
f2([]);
class K3 {
  x: number;
  constructor(b: number) {
    if (--fuel < 0) throw 0;
    this.x = b;
  }
  m() { return 13; }
}
function f3(a: number[]) {
  const s = new K3(1).m();
  const n: number = a[2];
  function t(p: number) { if (p) throw 0; }
  function h(p: number) {
    const o = new K3(p);
    try {
      o.x = n;
      t(p);
      o.x = s + n;
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
console.log("undefined, s + n");
f3([]);
class K4 {
  x: number;
  constructor(b: number) {
    if (--fuel < 0) throw 0;
    this.x = b;
  }
  m() { return 13; }
}
function f4(a: number[]) {
  const s = new K4(1).m();
  const n: number = a[2];
  function t(p: number) { if (p) throw 0; }
  function h(p: number) {
    const o = new K4(p);
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
console.log("null, s << n");
f4([0, 0, null as any]);
class K5 {
  x: number;
  constructor(b: number) {
    if (--fuel < 0) throw 0;
    this.x = b;
  }
  m() { return 13; }
}
function f5(a: number[]) {
  const s = new K5(1).m();
  const n: number = a[2];
  function t(p: number) { if (p) throw 0; }
  function h(p: number) {
    const o = new K5(p);
    try {
      o.x = n;
      t(p);
      o.x = s | n;
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
console.log("null, s | n");
f5([0, 0, null as any]);
class K6 {
  x: number;
  constructor(b: number) {
    if (--fuel < 0) throw 0;
    this.x = b;
  }
  m() { return 13; }
}
function f6(a: number[]) {
  const s = new K6(1).m();
  const n: number = a[2];
  function t(p: number) { if (p) throw 0; }
  function h(p: number) {
    const o = new K6(p);
    try {
      o.x = n;
      t(p);
      o.x = s + n;
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
console.log("null, s + n");
f6([0, 0, null as any]);
class K7 {
  x: number;
  constructor(b: number) {
    if (--fuel < 0) throw 0;
    this.x = b;
  }
  m() { return 13; }
}
function f7(a: number[]) {
  const s = new K7(1).m();
  const n: number = a[2];
  function t(p: number) { if (p) throw 0; }
  function h(p: number) {
    const o = new K7(p);
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
console.log("NaN, s << n");
f7([0, 0, NaN]);
class K8 {
  x: number;
  constructor(b: number) {
    if (--fuel < 0) throw 0;
    this.x = b;
  }
  m() { return 13; }
}
function f8(a: number[]) {
  const s = new K8(1).m();
  const n: number = a[2];
  function t(p: number) { if (p) throw 0; }
  function h(p: number) {
    const o = new K8(p);
    try {
      o.x = n;
      t(p);
      o.x = s | n;
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
console.log("NaN, s | n");
f8([0, 0, NaN]);
class K9 {
  x: number;
  constructor(b: number) {
    if (--fuel < 0) throw 0;
    this.x = b;
  }
  m() { return 13; }
}
function f9(a: number[]) {
  const s = new K9(1).m();
  const n: number = a[2];
  function t(p: number) { if (p) throw 0; }
  function h(p: number) {
    const o = new K9(p);
    try {
      o.x = n;
      t(p);
      o.x = s + n;
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
console.log("NaN, s + n");
f9([0, 0, NaN]);
class K10 {
  x: number;
  constructor(b: number) {
    if (--fuel < 0) throw 0;
    this.x = b;
  }
  m() { return 13; }
}
function f10(a: number[]) {
  const s = new K10(1).m();
  const n: number = a[2];
  function t(p: number) { if (p) throw 0; }
  function h(p: number) {
    const o = new K10(p);
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
console.log("minus zero, s << n");
f10([0, 0, -0]);
class K11 {
  x: number;
  constructor(b: number) {
    if (--fuel < 0) throw 0;
    this.x = b;
  }
  m() { return 13; }
}
function f11(a: number[]) {
  const s = new K11(1).m();
  const n: number = a[2];
  function t(p: number) { if (p) throw 0; }
  function h(p: number) {
    const o = new K11(p);
    try {
      o.x = n;
      t(p);
      o.x = s | n;
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
console.log("minus zero, s | n");
f11([0, 0, -0]);
class K12 {
  x: number;
  constructor(b: number) {
    if (--fuel < 0) throw 0;
    this.x = b;
  }
  m() { return 13; }
}
function f12(a: number[]) {
  const s = new K12(1).m();
  const n: number = a[2];
  function t(p: number) { if (p) throw 0; }
  function h(p: number) {
    const o = new K12(p);
    try {
      o.x = n;
      t(p);
      o.x = s + n;
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
console.log("minus zero, s + n");
f12([0, 0, -0]);
class K13 {
  x: number;
  constructor(b: number) {
    if (--fuel < 0) throw 0;
    this.x = b;
  }
  m() { return 13; }
}
function f13(a: number[]) {
  const s = new K13(1).m();
  const n: number = a[2];
  function t(p: number) { if (p) throw 0; }
  function h(p: number) {
    const o = new K13(p);
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
console.log("true, s << n");
f13([0, 0, true as any]);
class K14 {
  x: number;
  constructor(b: number) {
    if (--fuel < 0) throw 0;
    this.x = b;
  }
  m() { return 13; }
}
function f14(a: number[]) {
  const s = new K14(1).m();
  const n: number = a[2];
  function t(p: number) { if (p) throw 0; }
  function h(p: number) {
    const o = new K14(p);
    try {
      o.x = n;
      t(p);
      o.x = s | n;
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
console.log("true, s | n");
f14([0, 0, true as any]);
class K15 {
  x: number;
  constructor(b: number) {
    if (--fuel < 0) throw 0;
    this.x = b;
  }
  m() { return 13; }
}
function f15(a: number[]) {
  const s = new K15(1).m();
  const n: number = a[2];
  function t(p: number) { if (p) throw 0; }
  function h(p: number) {
    const o = new K15(p);
    try {
      o.x = n;
      t(p);
      o.x = s + n;
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
console.log("true, s + n");
f15([0, 0, true as any]);
class K16 {
  x: number;
  constructor(b: number) {
    if (--fuel < 0) throw 0;
    this.x = b;
  }
  m() { return 13; }
}
function f16(a: number[]) {
  const s = new K16(1).m();
  const n: number = a[2];
  function t(p: number) { if (p) throw 0; }
  function h(p: number) {
    const o = new K16(p);
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
console.log("zero, s << n");
f16([0, 0, 0]);
class K17 {
  x: number;
  constructor(b: number) {
    if (--fuel < 0) throw 0;
    this.x = b;
  }
  m() { return 13; }
}
function f17(a: number[]) {
  const s = new K17(1).m();
  const n: number = a[2];
  function t(p: number) { if (p) throw 0; }
  function h(p: number) {
    const o = new K17(p);
    try {
      o.x = n;
      t(p);
      o.x = s | n;
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
console.log("zero, s | n");
f17([0, 0, 0]);
class K18 {
  x: number;
  constructor(b: number) {
    if (--fuel < 0) throw 0;
    this.x = b;
  }
  m() { return 13; }
}
function f18(a: number[]) {
  const s = new K18(1).m();
  const n: number = a[2];
  function t(p: number) { if (p) throw 0; }
  function h(p: number) {
    const o = new K18(p);
    try {
      o.x = n;
      t(p);
      o.x = s + n;
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
console.log("zero, s + n");
f18([0, 0, 0]);
class K19 {
  x: number;
  constructor(b: number) {
    if (--fuel < 0) throw 0;
    this.x = b;
  }
  m() { return 13; }
}
function f19(a: number[]) {
  const s = new K19(1).m();
  const n: number = a[2];
  function t(p: number) { if (p) throw 0; }
  function h(p: number) {
    const o = new K19(p);
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
console.log("a fraction, s << n");
f19([0, 0, 0.5]);
class K20 {
  x: number;
  constructor(b: number) {
    if (--fuel < 0) throw 0;
    this.x = b;
  }
  m() { return 13; }
}
function f20(a: number[]) {
  const s = new K20(1).m();
  const n: number = a[2];
  function t(p: number) { if (p) throw 0; }
  function h(p: number) {
    const o = new K20(p);
    try {
      o.x = n;
      t(p);
      o.x = s | n;
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
console.log("a fraction, s | n");
f20([0, 0, 0.5]);
class K21 {
  x: number;
  constructor(b: number) {
    if (--fuel < 0) throw 0;
    this.x = b;
  }
  m() { return 13; }
}
function f21(a: number[]) {
  const s = new K21(1).m();
  const n: number = a[2];
  function t(p: number) { if (p) throw 0; }
  function h(p: number) {
    const o = new K21(p);
    try {
      o.x = n;
      t(p);
      o.x = s + n;
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
console.log("a fraction, s + n");
f21([0, 0, 0.5]);
