import { bump, seen, own } from "./taker.ts";
export function callWithPlain() { const o = { x: 1, y: 2, inner: { v: 3 } }; const got = bump(o); return [o.x, o.inner.v, got === o, Object.keys(o).join(), JSON.stringify(o)].join(" "); }
export function callWithMore() { const o = { x: 1, y: 2, inner: { v: 3 }, more: "kept" }; const got = bump(o); return [o.x, o.inner.v, got === o, o.more, Object.keys(o).join()].join(" "); }
export function callWithOtherOrder() { const o = { inner: { v: 3 }, y: 2, x: 1 }; const got = bump(o); return [o.x, o.inner.v, got === o, Object.keys(o).join()].join(" "); }
export function callWithFrozen() { const o = Object.freeze({ x: 1, y: 2, inner: { v: 3 } }); let said = "no error"; try { bump(o); } catch (e) { said = e.constructor.name; } return [said, o.x, o.inner.v].join(" "); }
export function callWithGetter() { let reads = 0; const o = { get x() { reads++; return 1; }, set x(v) { reads += 100; }, y: 2, inner: { v: 3 } }; bump(o); return [reads, o.x].join(" "); }
export function callWithInstance() { class P { constructor() { this.x = 1; this.y = 2; this.inner = { v: 3 }; } m() { return "m"; } } const o = new P(); const got = bump(o); return [o.x, got === o, got.m(), got instanceof P].join(" "); }
export function callTwice() { const o = { x: 1, y: 2, inner: { v: 3 } }; bump(o); bump(o); return [o.x, o.inner.v].join(" "); }
export function callAndKeep() { const o = { x: 1, y: 2, inner: { v: 3 } }; bump(o); o.x = 50; return [seen(), o.x].join(" "); }
export function callWithTyped() { const o = own(); const got = bump(o); return [o.x, o.inner.v, got === o, Object.keys(o).join(), JSON.stringify(o)].join(" "); }
export function callWithLess() { const o = { x: 1 }; let said = "no error"; try { bump(o); } catch (e) { said = e.constructor.name; } return [said, o.x].join(" "); }
