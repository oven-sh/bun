import { nextTurns } from "../host.ts";
let sink: unknown;
const paths = ["/users/42/posts/7", "/users/1001/posts/abc", "/users/al/posts/x-y_z", "/users/9/posts/2026"];
const parameters = paths.map(path => /^\/users\/([^/]+)\/posts\/([^/]+)$/.exec(path)![1]!);
function decodeParameter(value: string): string { return typeof value !== "string" || value.length === 0 ? value : decodeURIComponent(value); }
const decoders = [decodeParameter];
function bench(n: number): number {
    let s = 0;
    for (let i = 0; i < n; i++) s = (s + decoders[0]!(parameters[i & 3]!).length) | 0;
    return s;
}
sink = [bench];
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof sink);
