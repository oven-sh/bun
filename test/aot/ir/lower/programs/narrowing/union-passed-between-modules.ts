// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 8

// FILE: main.ts
// A union of object types is passed between modules as a whole, as a narrowed subset and as a single member.
import { first } from "./files/first";
import { second } from "./files/second";
import { third } from "./files/third";
import { calls } from "./files/calls";
console.log(first());
console.log(second());
console.log(third());
console.log(calls());

// FILE: files/any.ts
import type { S1 } from "./s1";
import type { S2 } from "./s2";
import type { S3 } from "./s3";
import type { S4 } from "./s4";
import type { S5 } from "./s5";
import type { S6 } from "./s6";
import type { S7 } from "./s7";
import type { S8 } from "./s8";
export type Any3 = S1 | S2 | S3;
export type Any5 = S1 | S2 | S3 | S4 | S5;
export type Any8 = S1 | S2 | S3 | S4 | S5 | S6 | S7 | S8;

// FILE: files/base.ts
export type Base = { id: string; type: string; status: "idle" | "busy"; tags: string[]; meta: { at: number } };

// FILE: files/calls.ts
import type { Any8 } from "./any";
import type { Deep } from "./deep";
import type { S3 } from "./s3";
import { make5, make8 } from "./make";
import { row5, row8 } from "./row";
export function whole(task: Deep<Any8>): string { return row8(task); }
export function narrowed(task: Deep<Any8>): string {
    if (task.type === "t1") return "first";
    if (task.type === "t8") return "last";
    return row8(task);
}
export function one(task: Deep<S3>): string { return row8(task); }
export function calls(): string {
    const all: string[] = [];
    for (let n = 1; n <= 8; n++) all.push(whole(make8(n)), narrowed(make8(n)));
    for (let n = 1; n <= 5; n++) all.push(row5(make5(n)));
    all.push(one({ id: "c", type: "t3", status: "busy", tags: ["q"], meta: { at: 3 }, own3: 3 }));
    return all.join(" ");
}

// FILE: files/deep.ts
export type Deep<T> = T extends (infer U)[] ? readonly Deep<U>[] : T extends Function ? T : T extends object ? { readonly [K in keyof T]: Deep<T[K]> } : T;

// FILE: files/first.ts
import type { Deep } from "./deep";
import type { S8 } from "./s8";
import type { S7 } from "./s7";
import type { S5 } from "./s5";
import type { S3 } from "./s3";
import { row3, row5, row8 } from "./row";
const eight: Deep<S8> = { id: "h", type: "t8", status: "busy", tags: ["x"], meta: { at: 8 }, own8: 8, extra8: 80 };
const seven: Deep<S7> = { id: "g", type: "t7", status: "idle", tags: [], meta: { at: 7 }, own7: 7 };
const five: Deep<S5> = { id: "e", type: "t5", status: "idle", tags: [], meta: { at: 5 }, own5: 5 };
const three: Deep<S3> = { id: "c", type: "t3", status: "busy", tags: [], meta: { at: 3 }, own3: 3 };
export function first(): string { return [row8(eight), row8(seven), row5(five), row3(three)].join(" "); }

// FILE: files/make.ts
import type { Any5, Any8 } from "./any";
import type { Deep } from "./deep";
export function make5(n: number): Any5 {
    switch (n) {
        case 1: return { id: "a", type: "t1", status: "idle", tags: [], meta: { at: 1 }, own1: 1 };
        case 2: return { id: "b", type: "t2", status: "busy", tags: [], meta: { at: 2 }, own2: 2, extra2: 20 };
        case 3: return { id: "c", type: "t3", status: "idle", tags: [], meta: { at: 3 }, own3: 3 };
        case 4: return { id: "d", type: "t4", status: "busy", tags: [], meta: { at: 4 }, own4: 4, extra4: 40 };
        default: return { id: "e", type: "t5", status: "idle", tags: [], meta: { at: 5 }, own5: 5 };
    }
}
// The same by way of a variable, so that the values meet.
export function pick5(n: number): Deep<Any5> {
    let made: Deep<Any5>;
    if (n === 1) made = { id: "a", type: "t1", status: "idle", tags: [], meta: { at: 1 }, own1: 1 };
    else if (n === 2) made = { id: "b", type: "t2", status: "busy", tags: [], meta: { at: 2 }, own2: 2, extra2: 20 };
    else if (n === 3) made = { id: "c", type: "t3", status: "idle", tags: [], meta: { at: 3 }, own3: 3 };
    else if (n === 4) made = { id: "d", type: "t4", status: "busy", tags: [], meta: { at: 4 }, own4: 4, extra4: 40 };
    else made = { id: "e", type: "t5", status: "idle", tags: [], meta: { at: 5 }, own5: 5 };
    return made;
}
export function make8(n: number): Deep<Any8> {
    if (n === 6) return { id: "f", type: "t6", status: "idle", tags: ["z"], meta: { at: 6 }, own6: 6, extra6: 60 };
    if (n === 7) return { id: "g", type: "t7", status: "busy", tags: [], meta: { at: 7 }, own7: 7 };
    if (n === 8) return { id: "h", type: "t8", status: "busy", tags: [], meta: { at: 8 }, own8: 8, extra8: 80 };
    return pick5(n);
}

// FILE: files/parse.ts
import type { Any5, Any8 } from "./any";
import type { Deep } from "./deep";
export function parse5(text: string): Deep<Any5> { return JSON.parse(text) as Deep<Any5>; }
export function parse8(text: string): Deep<Any8> { const made = JSON.parse(text) as Deep<Any8>; return made; }
export function plain5(text: string): Any5 { return JSON.parse(text) as Any5; }
export function from(value: unknown): Deep<Any8> { return value as Deep<Any8>; }

// FILE: files/row.ts
import type { Any3, Any5, Any8 } from "./any";
import type { Deep } from "./deep";
export function row3(task: Deep<Any3>): string { return task.type + task.status + task.meta.at; }
export function row5(task: Deep<Any5>): string { return task.type + task.status + task.meta.at; }
export function row8(task: Deep<Any8>): string {
    switch (task.type) {
        case "t1": return "one" + task.own1;
        case "t8": return "eight" + task.own8 + task.extra8;
        default: return task.type + task.status + task.tags.length;
    }
}

// FILE: files/s1.ts
import type { Base } from "./base";
export type S1 = Base & { type: "t1"; own1: number };

// FILE: files/s2.ts
import type { Base } from "./base";
export type S2 = Base & { type: "t2"; own2: number } & { extra2: number };

// FILE: files/s3.ts
import type { Base } from "./base";
export type S3 = Base & { type: "t3"; own3: number };

// FILE: files/s4.ts
import type { Base } from "./base";
export type S4 = Base & { type: "t4"; own4: number } & { extra4: number };

// FILE: files/s5.ts
import type { Base } from "./base";
export type S5 = Base & { type: "t5"; own5: number };

// FILE: files/s6.ts
import type { Base } from "./base";
export type S6 = Base & { type: "t6"; own6: number } & { extra6: number };

// FILE: files/s7.ts
import type { Base } from "./base";
export type S7 = Base & { type: "t7"; own7: number };

// FILE: files/s8.ts
import type { Base } from "./base";
export type S8 = Base & { type: "t8"; own8: number } & { extra8: number };

// FILE: files/second.ts
import type { Deep } from "./deep";
import type { S2 } from "./s2";
import type { S1 } from "./s1";
import type { S4 } from "./s4";
import { row3, row5, row8 } from "./row";
const two: Deep<S2> = { id: "b", type: "t2", status: "busy", tags: ["x", "y"], meta: { at: 2 }, own2: 2, extra2: 20 };
const one: Deep<S1> = { id: "a", type: "t1", status: "idle", tags: [], meta: { at: 1 }, own1: 1 };
const four: Deep<S4> = { id: "d", type: "t4", status: "idle", tags: [], meta: { at: 4 }, own4: 4, extra4: 40 };
export function second(): string { return [row8(two), row8(one), row5(four), row3(two)].join(" "); }

// FILE: files/third.ts
import type { Deep } from "./deep";
import type { S6 } from "./s6";
import type { S4 } from "./s4";
import type { Any5, Any8 } from "./any";
import { from, parse5, parse8, plain5 } from "./parse";
import { row5, row8 } from "./row";
const six: Deep<S6> = { id: "f", type: "t6", status: "idle", tags: [], meta: { at: 6 }, own6: 6, extra6: 60 };
const four: Deep<S4> = { id: "d", type: "t4", status: "idle", tags: [], meta: { at: 4 }, own4: 4, extra4: 40 };
function again(task: Deep<Any8>): Deep<Any8> { return JSON.parse(JSON.stringify(task)) as Deep<Any8>; }
function again5(task: Any5): Any5 { return JSON.parse(JSON.stringify(task)) as Any5; }
export function third(): string {
    return [row8(six), row5(four), row5(parse5('{"id":"a","type":"t1","status":"idle","tags":[],"meta":{"at":1},"own1":1}')), row8(parse8('{"id":"g","type":"t7","status":"busy","tags":[],"meta":{"at":7},"own7":7}')),
        row5(plain5('{"id":"b","type":"t2","status":"busy","tags":[],"meta":{"at":2},"own2":2,"extra2":20}')), row8(from(six)), row8(again(six)), row5(again5(plain5('{"id":"c","type":"t3","status":"idle","tags":[],"meta":{"at":3},"own3":3}')))].join(" ");
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="first"
// CHECK-NEXT: v7 = Call v6 calleeName="first"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v9 = Call v4, v2, v8 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v10 = Builtin builtin=GlobalThis
// CHECK-NEXT: v11 = PropGet v10 key="console" [isFreeName]
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v13 = PropGet v12 key="log"
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v15 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v16 = CheckInitialized v15 name="second"
// CHECK-NEXT: v17 = Call v16 calleeName="second"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v19 = Call v14, v12, v18 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v20 = Builtin builtin=GlobalThis
// CHECK-NEXT: v21 = PropGet v20 key="console" [isFreeName]
// CHECK-NEXT: v22 = Convert v21 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v23 = PropGet v22 key="log"
// CHECK-NEXT: v24 = Convert v23 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v25 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v26 = CheckInitialized v25 name="third"
// CHECK-NEXT: v27 = Call v26 calleeName="third"
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|null|string site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v29 = Call v24, v22, v28 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v30 = Builtin builtin=GlobalThis
// CHECK-NEXT: v31 = PropGet v30 key="console" [isFreeName]
// CHECK-NEXT: v32 = Convert v31 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v33 = PropGet v32 key="log"
// CHECK-NEXT: v34 = Convert v33 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v35 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v36 = CheckInitialized v35 name="calls"
// CHECK-NEXT: v37 = Call v36 calleeName="calls"
// CHECK-NEXT: v38 = Convert v37 declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v39 = Call v34, v32, v38 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v40 = Undefined
// CHECK-NEXT: Return v40
// CHECK-NEXT: }
