// A namespace object passed on under its type stays live.
declare const console: { log(...values: unknown[]): void };
import * as ns from "./t";
import { inc } from "./t";
function viaParameter(m: typeof import("./t")): number { inc(); return m.n; }
const kept: typeof ns = ns;
interface Shape { n: number; table: { a: number } }
function viaInterface(m: Shape): number { inc(); return m.n + m.table.a; }
function viaAny(m: any): number { inc(); return m.n; }
const list: (typeof ns)[] = [ns];
console.log(viaParameter(ns), kept.n, viaInterface(ns), viaAny(ns), list[0].n);
kept.inc(); list[0].inc();
console.log(kept.n, ns.n, list[0].n, Object.keys(kept).join(), Object.keys({ ...ns }).join(), ({ ...ns }).n, kept === ns, list[0] === kept);
const dynamic: typeof import("./t") = await import("./t");
dynamic.inc();
console.log(dynamic.n, dynamic === ns, dynamic.table === ns.table);
