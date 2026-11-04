// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 1

// FILE: main.ts
// The type of `{ count: 1 }` in `const kept = { count: 1 }` is inferred: nobody wrote it. JavaScript that is handed such an object may store anything to it, and typed code then reads what is there, as under plain Bun: an inferred type never decides what a program does.
import { alter, spoil, fill, call, put, Holder } from "./library.js";
const o = alter({ count: 1, more: { n: 1, extra: "e" } });
console.log(o.more.n, o.more.extra, o.count, JSON.stringify(o));
const kept = { count: 1, more: { n: 1, extra: "e" } };
alter(kept);
console.log(kept.more.n, kept.more.extra, kept.count, typeof kept.count, kept.count + 1, JSON.stringify(kept));
const p = { x: 1, y: 2 };
console.log(p.x + p.y); spoil(p);
console.log(p.x, typeof p.x, p.x + 1, p.y);
function make(i: number) { return { x: i, y: i * 2 }; }
let total = 0; const all = [make(1), make(2)];
spoil(all[0]);
for (const q of all) total += q.y; console.log(total, all[0].x + "!", all[1].x + 1);
const list = [make(3), make(4)];
fill(list);
console.log(list.length, list.map(q => q.x + ":" + q.y).join());
console.log(call((q = make(5)) => q.x + "|" + q.y));
const map = new Map([["a", make(6)]]);
put(map);
console.log([...map.values()].map(q => String(q.x)).join());
const held = make(7);
console.log(JSON.stringify(new Holder(held).change().held), typeof held.x, JSON.stringify(held));
const nested = { inner: make(8), list: [make(9)] };
spoil(nested.inner); spoil(nested.list[0]);
console.log(nested.inner.x + 1, nested.list[0].x + 1, JSON.stringify(nested));

// FILE: library.js
export function alter(target) { target.more = { n: 2 }; target.count = "many"; return target; }
export function spoil(point) { point.x = "text"; return point; }
export function fill(list) { list.push({ x: "pushed" }); list[0] = { y: 1 }; return list; }
export function call(callback) { return callback({ x: "given", y: [1] }); }
export function put(map) { map.set("k", { x: null }); return map; }
export class Holder { constructor(held) { this.held = held; } change() { this.held.x = { deep: true }; return this; } }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: make
// CHECK-LABEL: function {{*}}name="make"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_1]]}] results=[{type=undefined|null|[[L_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=number}
// CHECK-NEXT: v2 = Integer integer=2
// CHECK-NEXT: v3 = Mul v0, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number}
// CHECK-NEXT: v5 = NewObject -, v1, v4 layout=[[L_2]] fields=[0, 1]
// CHECK-NEXT: v6 = FinishObject v5
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[L_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
