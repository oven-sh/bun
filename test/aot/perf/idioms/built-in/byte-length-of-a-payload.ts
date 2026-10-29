import { nextTurns } from "../host.ts";
let sink: unknown;
const payloads: { body: any }[] = JSON.parse('[{"body":"{\\"ok\\":true}"},{"body":"hello, world"},{"body":"caf\\u00e9 au lait"},{"body":"a longer line of plain text that a server answers with"}]');
function sizeOf(reply: { body: any }): number { return Buffer.byteLength(reply.body); }
const readers = [sizeOf];
function bench(n: number): number {
    let s = 0;
    for (let i = 0; i < n; i++) s = (s + readers[0]!(payloads[i & 3]!)) | 0;
    return s;
}
sink = [bench];
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof sink);
