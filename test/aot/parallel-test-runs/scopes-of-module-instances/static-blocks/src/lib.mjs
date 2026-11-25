import { base } from "./dep.mjs";
export const log = [];
export class A { static x = 1; static { log.push(A.x, typeof A.make, this === A); A.x = 5; } static y = A.x + base; static make() { return new A(); } v = A.y; static { try { log.push(typeof Outer); } catch (e) { log.push(e.constructor.name); } } }
const Outer = class Inner { static n = Inner.name; static { log.push(Inner === this); } who() { return Inner.n + (Outer === Inner); } };
export function use() { return [A.x, A.y, A.make().v, new Outer().who(), log.join("/")].join(" "); }
