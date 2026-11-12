import { base } from "./dep.mjs";
export const log = [];
const attempt = f => { try { return f(); } catch (e) { return e.constructor.name; } };
export class B { static a = attempt(() => B.name); static [attempt(() => "k" + typeof B)] = 1; static b = attempt(() => C.name); }
log.push(attempt(() => C)); 
class C extends (log.push(attempt(() => C)), Object) { static s = attempt(() => C.name); }
let late; { const early = () => inner; log.push(attempt(early)); let inner = 5 + base; log.push(early()); late = () => inner++; }
export function use() { return [B.a, B.b, Object.keys(B).join(","), C.s, late(), late(), log.join("/")].join(" "); }
