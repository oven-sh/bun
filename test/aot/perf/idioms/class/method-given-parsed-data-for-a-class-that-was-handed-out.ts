import { nextTurns } from "../host.ts";
let sink: unknown;
const handOut = new Function("value", "return value") as <Value>(value: Value) => Value;
class Host { name = "host"; }
class Holder {
    #count: number;
    constructor(count: number) { this.#count = count | 0; }
    read(host: Host): number { return this.#count ^ host.name.length; }
}
function sum(holder: Holder, host: Host, i: number): number { return (holder.read(host) + i) | 0; }
function bench(holder: Holder, host: Host, n: number): number {
    let s = 0;
    for (let i = 0; i < n; i++) s = (s + sum(holder, host, i)) | 0;
    return s;
}
const holder = new Holder(3);
const host = handOut(new Host());
const parsed = handOut(JSON.parse('{"name":"no","more":1}') as Host);
sink = [bench, sum, host];
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(holder, parsed, n)) | 0;
console.log(check, typeof sink);
