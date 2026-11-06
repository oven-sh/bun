// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 5

// FILE: main.ts
// `import a = ns.b` where `ns` is an ES module namespace object, and `export import a = ns.b` imported by other files.
import * as ns from "./values";
import { inner } from "./values";
import { values, star } from "./again";
import * as again from "./again";
import { f as exportedF, m as exportedM, K as ExportedK, inner as exportedInner, h as exportedH, bumped } from "./exported";
import * as exported from "./exported";
import { f as listedF, m as listedM, renamed } from "./listed";
import listedDefault from "./listed";
import f = ns.f;
import v = ns.v;
import K = ns.K;
import E = ns.E;
import B = ns.E.B;
import CE = ns.CE;
import P = ns.CE.P;
import obj = ns.obj;
import same = ns;
import m = ns.m;
import arrow = ns.arrow;
import n = inner.n;
import up = inner.up;
import g = inner.most.g;
import most = inner.most;
import f2 = values.f;
import m2 = star.m;
import n2 = star.inner.n;
import f3 = again.values.f;
import written = again.written.g;
import count = again.written.count;
import bottom = again.star.inner.most.bottom;

console.log(listedF(1), listedM, renamed, listedDefault(5));
console.log(f(1), v, new K().x, K.s, K === ns.K, E.A, B, CE.Q, P, f === ns.f, obj.x, obj === ns.obj, same === ns);
const before = ns.m;
ns.bump();
console.log(m === before, ns.m === before + 1, m2 === before);
ns.swap();
console.log(arrow(), ns.arrow());
up();
console.log(n, inner.n, n2, g(), most.bottom, bottom);
again.written.more();
console.log(f2 === f, f3 === f, written(), count, again.written.count);
console.log(exportedF(1), exportedM, new ExportedK().x, exportedInner.w, exportedH(), bumped(), exportedM === exported.m, exported.f(2), Object.keys(exported).sort().join());

// FILE: again.ts
import * as values from "./values";
export { values };
export * as star from "./values";
export namespace written { export function g() { return "g"; } export let count = 0; export function more() { count++; } }

// FILE: exported.ts
import * as ns from "./values";
namespace local { export function h() { return "h"; } }
export import f = ns.f;
export import m = ns.m;
export import K = ns.K;
export import inner = ns.inner;
export import h = local.h;
export function bumped() { const was = m; ns.bump(); return m === was && ns.m !== was; }

// FILE: listed.ts
import * as ns from "./values";
import f = ns.f;
import m = ns.m;
import v = ns.v;
ns.bump();
export { f, m, v as renamed };
export default f;

// FILE: values.ts
export let m = 1;
export function bump() { m++; }
export function f(n: number) { return n + 1; }
export const v = 5;
export class K { x = 1; static s = "s"; }
export enum E { A = 1, B = 2 }
export const enum CE { P = 10, Q = 20 }
export namespace inner { export let n = 10; export function up() { n++; } export const w = 7; export namespace most { export const bottom = "bottom"; export function g() { return "g"; } } }
export const obj = { x: 1, y: { z: 2 } };
export let arrow = () => "first";
export function swap() { arrow = () => "second"; }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
