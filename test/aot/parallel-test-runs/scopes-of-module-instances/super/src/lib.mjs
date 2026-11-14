import { base } from "./dep.mjs";
export class S { static tag() { return "S" + base; } tag() { return "s" + S.tag(); } get g() { return 1 + base; } }
export class T extends S { static tag() { return "T" + super.tag(); } tag() { return "t" + super.tag() + T.tag(); } get g() { return super.g * 10; } static { this.fixed = super.tag() + T.tag(); } field = super.tag(); arrow = () => super.tag() + this.g; }
export const o = { __proto__: new T(), tag() { return "o" + super.tag(); } };
export function use() { const t = new T(); return [T.tag(), t.tag(), t.g, T.fixed, t.field, t.arrow(), o.tag()].join(" "); }
