import { nextTurns } from "../host.ts";
let sink: unknown;
const tables: Record<string, unknown>[] = JSON.parse('[{"content-length":"42"},{"content-length":"7"},{"content-length":"1024"},{"content-length":"318"}]');
function lengthOf(headers: Record<string, unknown>): number { return Number(headers["content-length"]); }
const readers = [lengthOf];
function bench(n: number): number {
    let s = 0;
    for (let i = 0; i < n; i++) s = (s + readers[0]!(tables[i & 3]!)) | 0;
    return s;
}
sink = [bench];
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof sink);
