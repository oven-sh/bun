import { nextTurns } from "../host.ts";
let sink: unknown;
const paths: string[] = ["/orders", "/items", "/carts", "//elsewhere"];
const queries: string[] = ["?page=2", "?q=tea", "?x", "?all=yes"];
const fragments: string[] = ["#top", "#end", "#m", "#part-3"];
const startsWithTwoSlashes = /^\/\//;
function hrefOf(path: string, query: string, fragment: string): string {
    return path + query + fragment;
}
const makers = [hrefOf];
function bench(n: number): number {
    let s = 0;
    for (let i = 0; i < n; i++) {
        const href = makers[0](paths[i & 3], queries[i & 3], fragments[i & 3]);
        s = (s + href.length + (startsWithTwoSlashes.test(href) ? 1 : 0)) | 0;
    }
    return s;
}
sink = [bench];
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof sink);
