import { seen } from "./writes-b.js";
export function a() { return "a"; }
export function b() { return "b"; }
export function c() { return "c"; }
export function d() { return "d"; }
export function e() { return "e"; }
export function f() { return "f"; }
export function write() { [a] = [1]; ({ b } = { b: 2 }); c ||= 3; d &&= 4; for (e of [5]); f++; }
console.log("writes", seen, a, b, typeof c, d, e, f);
