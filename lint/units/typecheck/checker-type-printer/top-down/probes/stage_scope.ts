namespace M {
    interface Hidden { h: 1 }
    export interface Shown { s: 1 }
    declare const hid: Hidden;
    declare const sh: Shown;
    export const o = { a: hid, b: sh, c: [hid], d: (x: Hidden): Shown => sh, e: 1 as const, f: "lit", g: null, h: undefined, i: -1, j: 10n };
}
const s: string = M.o;
function outer<T>() { class L { x!: T } return L; }
const inst = new (outer<number>())();
const s2: string = inst;
const s3: string = outer<string>();
interface R { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: R } } } } } } } } } } } }
declare const rr: R["next"];
const s4: string = rr;
declare const rec: { a: typeof rec; b: 1 };
const s5: string = rec;
