// Fields of every kind get values of which nothing is proven, through receivers whose class is known and through receivers of which nothing is known: values that the type of the field takes and values that it
// does not, into fields that are there and into fields that are not there yet, into objects that are frozen, sealed or closed, below prototypes that get and lose a setter. As any engine answers.
const hide: (value: any) => any = (0, eval)("(value) => value");
const lines: string[] = [];
const calls: string[] = [];
type Level = "low" | "middle" | "high";
class Other { tag = "other"; }
class Record {
    whole = 1;
    wholeOrNone?: number;
    real = 1.5;
    realOrNone?: number;
    flag = true;
    flagOrNone?: boolean;
    text = "t";
    textOrNone?: string;
    level: Level = "low";
    other = new Other();
    otherOrNone?: Other;
    list: number[] = [];
    anything: unknown = null;
    late?: unknown;
}
class Heir extends Record { own = 0; ownOrNone?: string; }
const names = ["whole", "wholeOrNone", "real", "realOrNone", "flag", "flagOrNone", "text", "textOrNone", "level", "other", "otherOrNone", "list", "anything", "late", "own", "ownOrNone"] as const;
const values: unknown[] = [0, -1, 7, 2147483647, 2147483648, -2147483649, 0.5, -0, NaN, Infinity, true, false, "", "s", "low", "high", "none of them", null, undefined, new Other(), new Record(), [], [1], {}, () => 1, Symbol.for("s"), 10n];
function show(value: unknown): string {
    if (typeof value === "function") return "function";
    if (typeof value === "symbol" || typeof value === "bigint") return String(value);
    if (Object.is(value, -0)) return "-0";
    if (value instanceof Other) return "Other";
    if (value instanceof Record) return "Record";
    return typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
}
// The receiver's class is known and the value is not.
function storeKnown(target: Record, which: number, value: any): void {
    switch (which) {
    case 0: target.whole = value; break;
    case 1: target.wholeOrNone = value; break;
    case 2: target.real = value; break;
    case 3: target.realOrNone = value; break;
    case 4: target.flag = value; break;
    case 5: target.flagOrNone = value; break;
    case 6: target.text = value; break;
    case 7: target.textOrNone = value; break;
    case 8: target.level = value; break;
    case 9: target.other = value; break;
    case 10: target.otherOrNone = value; break;
    case 11: target.list = value; break;
    case 12: target.anything = value; break;
    case 13: target.late = value; break;
    }
}
function storeKnownInHeir(target: Heir, which: number, value: any): void {
    if (which === 14) target.own = value;
    else if (which === 15) target.ownOrNone = value;
    else storeKnown(target, which, value);
}
// Nothing is known of either.
function storeUnknown(target: any, which: number, value: any): void {
    switch (which) {
    case 0: target.whole = value; break;
    case 1: target.wholeOrNone = value; break;
    case 2: target.real = value; break;
    case 3: target.realOrNone = value; break;
    case 4: target.flag = value; break;
    case 5: target.flagOrNone = value; break;
    case 6: target.text = value; break;
    case 7: target.textOrNone = value; break;
    case 8: target.level = value; break;
    case 9: target.other = value; break;
    case 10: target.otherOrNone = value; break;
    case 11: target.list = value; break;
    case 12: target.anything = value; break;
    case 13: target.late = value; break;
    case 14: target.own = value; break;
    case 15: target.ownOrNone = value; break;
    }
}
function attempt(store: () => void): string {
    try {
        store();
        return "";
    } catch (error) {
        return " " + (error as Error).constructor.name;
    }
}
function round(title: string, prepare: (made: Record) => Record): void {
    lines.push(title);
    for (const [wayName, way] of [["known", storeKnownInHeir], ["unknown", storeUnknown]] as const) {
        for (let which = 0; which < names.length; which++) {
            const seen: string[] = [];
            for (const value of values) {
                for (const make of [() => new Record(), () => new Heir()]) {
                    if (which >= 14 && make === undefined) continue;
                    const made = prepare(make());
                    if (which >= 14 && !(made instanceof Heir) && wayName === "known") continue;
                    calls.length = 0;
                    const thrown = attempt(() => way(hide(made), which, hide(value)));
                    const again = attempt(() => way(hide(made), which, hide(value)));
                    seen.push(show((made as any)[names[which]]) + thrown + again + (calls.length ? " {" + calls.join() + "}" : "") + " " + Object.keys(made).length);
                }
            }
            lines.push("  " + wayName + " " + names[which] + ": " + seen.join(" | "));
        }
    }
}
round("as made", (made) => made);
round("again", (made) => made);
round("frozen", (made) => Object.freeze(made));
round("sealed", (made) => Object.seal(made));
round("closed", (made) => Object.preventExtensions(made));
round("a field deleted", (made) => { delete (made as any).real; delete (made as any).text; delete (made as any).anything; return made; });
round("a field redefined", (made) => Object.defineProperty(made, "whole", { value: 5, writable: false, configurable: true, enumerable: true }));
round("an extra property", (made) => { (made as any).extra = 1; return made; });
for (const name of ["late", "wholeOrNone", "ownOrNone"]) {
    Object.defineProperty(Record.prototype, name, { set(value) { calls.push("set " + name + " " + show(value)); }, get() { return "got"; }, configurable: true });
    round("a setter for " + name + " above", (made) => made);
    delete (Record.prototype as any)[name];
    round("and gone", (made) => made);
}
Object.defineProperty(Heir.prototype, "textOrNone", { value: "fixed", writable: false, configurable: true });
round("textOrNone cannot be written below one class", (made) => made);
delete (Heir.prototype as any).textOrNone;
Object.setPrototypeOf(Heir.prototype, { set flagOrNone(value: unknown) { calls.push("moved " + show(value)); } });
round("the class moved below another object", (made) => made);
Object.setPrototypeOf(Heir.prototype, Record.prototype);
round("and back", (made) => made);
let hash = 0;
const text = lines.join("\n");
for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
console.log(lines.length, text.length, hash);
console.log(lines.filter((_, i) => i % 23 === 0).map((line) => line.slice(0, 400)).join("\n"));
