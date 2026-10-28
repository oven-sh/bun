"use strict";
function Point(x, y) { this.x = x; this.y = y; }
class Base { constructor(x) { this.x = x; } }
class Fields { a = 1; b = 2; }
function Large(a, b) { this.a = a; this.b = b; this.c = a + b; this.d = a - b; this.e = a * b; if (a > b) { this.f = a; this.g = b; } else { this.f = b; this.g = a; } for (let i = 0; i < 2; i++) this.h = (this.h | 0) + i + a; this.i = String(a); this.j = [a]; this.k = { a }; this.l = typeof b; this.m = -a; this.n = ~b; this.o = !a; this.p = a % 7; this.q = b / 3; this.r = a | b; this.s = a & b; this.t = a ^ b; this.u = a << 1; this.v = b >> 1; this.w = a >>> 1; this.z = this.a + this.b + this.c + this.d + this.e + this.f + this.g; }
function MayReturnObject(x) { this.x = x; if (x < 0) return { x: 0 }; }
function makesPoints(n) { let s = 0; for (let i = 0; i < n; i++) s += new Point(i, 1).y; return s; }
function makesBases(n) { let s = 0; for (let i = 0; i < n; i++) s += new Base(1).x; return s; }
function makesFields(n) { let s = 0; for (let i = 0; i < n; i++) s += new Fields().b; return s; }
function makesLarge(n) { let s = 0; for (let i = 0; i < n; i++) s += new Large(i, 2).g; return s; }
function makesEither(n) { let s = 0; for (let i = 0; i < n; i++) s += new MayReturnObject(1).x; return s; }
function makesGiven(F, n) { let s = 0; for (let i = 0; i < n; i++) s += new F(1, 2).x; return s; }
module.exports = { Point, makesPoints, makesBases, makesFields, makesLarge, makesEither, makesGiven };
