import { nextTurns } from "../host.ts";
let sink: unknown;
class Point { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y; } }
function valueOf(object: object, key: string): number { const descriptor = Object.getOwnPropertyDescriptor(object, key)!; return descriptor.value; }
const objects: object[] = [new Point(1, 2), new Point(3, 4), { x: 5, z: 1 }, new Point(7, 8)]; const takers = [valueOf];
function bench(n: number): number {
    let s = 0;
    for (let i = 0; i < n; i++) s = (s + takers[0]!(objects[i & 3]!, "x")) | 0;
    return s;
}
sink = [bench];
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof sink);
