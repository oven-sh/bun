import { nextTurns } from "../host.ts";
let sink: unknown;
const pattern = /^(?:\/a\/([^/]+)()|\/b\/([^/]+)\/([^/]+)()|\/c()|\/d\/([^/]+)())$/;
const matches = ["/b/x/y", "/a/1", "/d/last", "/c"].map(path => pattern.exec(path)!);
function routeOf(match: RegExpExecArray): number { return match.indexOf("", 1); }
const finders = [routeOf];
function bench(n: number): number {
    let s = 0;
    for (let i = 0; i < n; i++) s = (s + finders[0]!(matches[i & 3]!)) | 0;
    return s;
}
sink = [bench];
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof sink);
