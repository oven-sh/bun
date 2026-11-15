import { nextTurns } from "../host.ts";
let sink: unknown;
const addresses: string[] = ["/orders/17", "/items", "/", "//elsewhere"];
const startsWithTwoSlashes = /^\/\//;
function hrefOf(address: string): string {
    const end = address.length;
    return address.slice(0, end) + address.slice(end) + address.slice(end);
}
const makers = [hrefOf];
function bench(n: number): number {
    let s = 0;
    for (let i = 0; i < n; i++) {
        const href = makers[0](addresses[i & 3]);
        s = (s + href.length + (startsWithTwoSlashes.test(href) ? 1 : 0)) | 0;
    }
    return s;
}
sink = [bench];
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof sink);
