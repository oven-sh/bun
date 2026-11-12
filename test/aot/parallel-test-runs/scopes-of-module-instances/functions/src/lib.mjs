import { base } from "./dep.mjs";
export function make(n) { class Local { static count = 0; #p = n; constructor() { Local.count++; } p() { return this.#p + base + Local.count; } static is(o) { return #p in o; } } return Local; }
export const X = make(1), Y = make(2);
export const mixin = Base => class Mixed extends Base { who() { return "mixed " + (super.who ? super.who() : "none") + base; } };
export class Root { who() { return "root" + Root.name; } }
export const M = mixin(Root), N = mixin(M);
export function use() { const x = new X(), y = new Y(); return [x.p(), y.p(), X.is(x), X.is(y), Y.is(y), new N().who(), new M().who()].join(" "); }
