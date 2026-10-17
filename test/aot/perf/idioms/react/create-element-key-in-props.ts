import { nextTurns } from "../host.ts";
let sink: unknown;
interface Q { a: number; b: number; c: number; d: number; e: number; f: number }
interface Props { [name: string]: string|number }
type Mixed = number|string|boolean|null
class K { x: number; y: number; z: number; constructor(x: number) { this.x = x; this.y = x + 1; this.z = x + 2; } get value(): number { return this.x; } set value(v: number) { this.x = v; } m(): number { return this.x + this.y; } static s(v: number): number { return v + 1; } static count = 3; }
function bench(key: string, props: Props, n: number): number {
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
        const out: Props = {}; for (const n1 in props) Object.prototype.hasOwnProperty.call(props, n1) && "key" !== n1 && "__self" !== n1 && "__source" !== n1 && (out[n1] = props[n1]);
        sink = out;
    }
    return s;
}
const A0: string = Array.from("bravo").join("");
const A1: Props = { key: "k", className: "a", id: "x", children: 1 };
sink = [bench];
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(A0, A1, n);
console.log(check, typeof sink);
