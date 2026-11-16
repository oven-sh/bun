import { nextTurns } from "../host.ts";
let sink: unknown;
const tables: Record<string, unknown>[] = JSON.parse('[{"etag":"W/\\"2a\\""},{"etag":"abc"},{"etag":"W/\\"1024\\""},{"etag":"x"}]');
function textOf(headers: Record<string, unknown>): string { return String(headers["etag"]); }
const readers = [textOf];
function bench(n: number): number {
    let s = 0;
    for (let i = 0; i < n; i++) s = (s + readers[0]!(tables[i & 3]!).length) | 0;
    return s;
}
sink = [bench];
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof sink);
