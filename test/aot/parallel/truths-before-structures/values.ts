class Entry { kind: number; flags: number; next: Entry | undefined; constructor(kind: number, flags: number, next: Entry | undefined) { this.kind = kind; this.flags = flags; this.next = next; } }
class Named extends Entry { text: string; constructor(kind: number, flags: number, next: Entry | undefined, text: string) { super(kind, flags, next); this.text = text; } }
const shared: any = globalThis;
let log = "";
function add(value: any): void {
    log += (value === undefined ? "undefined" : value === null ? "null" : typeof value === "object" ? "object " + value.kind : typeof value === "number" ? (Object.is(value, -0) ? "-0" : String(value)) : typeof value === "symbol" ? "symbol" : typeof value === "bigint" ? value + "n" : typeof value === "function" ? "function" : JSON.stringify(value)) + "\n";
}
function kindOf(entry: Entry | undefined): void { add(entry && entry.kind); }
function nextOf(entry: Entry | undefined): void { if (entry && entry.kind === 1) add(entry.next); else add(entry); }
function isEmpty(entry: Entry | undefined): void { if (!entry) { add(entry); return; } add(entry.flags); }
function flagsOf(entry: Entry | undefined): void { let sum = 0; let left = 4; while (entry && entry.kind !== 4 && left--) { sum += entry.flags; entry = entry.next; } add(sum); add(entry); }
const first = new Entry(2, 4, undefined), second = new Named(1, 2, first, "second"), third = new Entry(3, 1, second), fourth = new Entry(4, 16, third);
shared.functions = [kindOf, nextOf, isEmpty, flagsOf];
shared.values = [first, second, third, fourth, undefined, null, 0, -0, NaN, "", false, true, "text", 7, 1.5, 0n, 10n, Symbol.iterator, [1], {}, { kind: 1, flags: 32, next: { kind: 2, flags: 128 } }, () => 1, new Proxy(first, {}), Object(""), Object(0), JSON.parse('{"kind":1,"next":null}')];
shared.classes = [Entry, Named];
shared.run = (functions: any, values: any) => { for (const callee of functions) for (const value of values) { try { callee(value); } catch (error: any) { add(error instanceof TypeError ? "TypeError" : "other"); } } };
shared.run(shared.functions, shared.values);
for (const entry of [first, second, third, fourth]) { kindOf(entry); nextOf(entry); isEmpty(entry); flagsOf(entry); }
console.log(log);
