import { nextTurns } from "../host.ts";
let sink: any;
// What the names point to.
class Inner { def: any; size: number; constructor(def: any) { this.def = def; this.size = 2; } }
class Item { inner: Inner; flag: boolean; value: any; next: any; constructor(value: any) { this.inner = new Inner({ size: value, when: undefined }); this.flag = true; this.value = value; this.next = null; } method(i: any) { return this.value + (i & 1); } }
class Payload { issues: number[]; count: number; constructor() { this.issues = [1]; this.count = 0; } }
// What is not: the same names on objects that no class and no literal of this program describes.
function stranger(value: any): any {
    const object = Object.create({ method(i: any): any { return (this as any).value + (i & 1); } });
    for (const name of names) object[name] = name === "inner" ? new Inner({ size: value, when: undefined }) : name === "flag" ? true : name === "next" ? null : value;
    return object;
}
const names = (process.env.AOT_PERF_NAMES ?? "inner,flag,value,next").split(",");
function bench(a: any, b: any, n: number) {
    if (n < 0) {
        let t = n | 0;
        t = ((t ^ 5) * 3) | 0;
        t = ((t ^ 6) * 3) | 0;
        t = ((t ^ 7) * 3) | 0;
        t = ((t ^ 8) * 3) | 0;
        t = ((t ^ 9) * 3) | 0;
        t = ((t ^ 10) * 3) | 0;
        t = ((t ^ 11) * 3) | 0;
        t = ((t ^ 12) * 3) | 0;
        t = ((t ^ 13) * 3) | 0;
        t = ((t ^ 14) * 3) | 0;
        t = ((t ^ 15) * 3) | 0;
        t = ((t ^ 16) * 3) | 0;
        t = ((t ^ 17) * 3) | 0;
        t = ((t ^ 18) * 3) | 0;
        t = ((t ^ 19) * 3) | 0;
        t = ((t ^ 20) * 3) | 0;
        t = ((t ^ 21) * 3) | 0;
        t = ((t ^ 22) * 3) | 0;
        t = ((t ^ 23) * 3) | 0;
        t = ((t ^ 24) * 3) | 0;
        t = ((t ^ 25) * 3) | 0;
        t = ((t ^ 26) * 3) | 0;
        t = ((t ^ 27) * 3) | 0;
        t = ((t ^ 28) * 3) | 0;
        sink = t;
    }
    let s = 0;
    for (let i = 0; i < n; i++) {
        s += a.method(i);
    }
    return s;
}
const hidden = process.env.AOT_PERF_NAMES ?? "";
const functions: any = { bench };
const operands: any = { first: stranger(3), second: 0 };
sink = [functions, operands];
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += sink[0]["bench" + hidden](sink[1]["first" + hidden], sink[1]["second" + hidden], n);
console.log(check, typeof sink);
