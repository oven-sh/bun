// Substrings of a string whose storage changed from 8-bit to 16-bit after they were created.
declare function isRope(s: string): boolean;
const stillRope: (s: string) => boolean = typeof isRope === "function" ? isRope : () => true;
const outside = new Function("f", "return (...a) => f(...a)") as <F>(f: F) => F;
const table: Record<string, number> = {};

function substringOfBaseWidenedTo16Bit(upper: string, from: number, to: number) {
    const lower = upper.toLowerCase();
    const flat = lower + "☃";
    Symbol(flat);
    const wide = flat.slice(0, lower.length);
    Symbol(wide);
    table[wide] = 1;
    const narrow = upper.toLowerCase();
    const part = narrow.slice(from, to);
    if (table[narrow] !== 1) throw new Error("the base is no key of the table");
    if (!stillRope(part)) throw new Error("the part is no rope any more");
    return part;
}

function equals3(s: string) { return s === "ert"; }
function equals6(s: string) { return s === "ertyui"; }
function equals8(s: string) { return s === "ertyuiop"; }
function equals13(s: string) { return s === "ertyuiopasdfg"; }
function equals40(s: string) { return s === "ertyuiopasdfghjklzxcvbnmqwertyuiopasdfgh"; }
function differs6(s: string) { return s !== "ertyui"; }
function which(s: string) {
    switch (s) {
        case "ert": return 1;
        case "ertyui": return 2;
        case "ertyuiop": return 3;
        case "ertyuiopasdfg": return 4;
        default: return 0;
    }
}
function same(a: string, b: string) { return a === b; }
function starts(s: string) { return s.startsWith("erty"); }
function ends(s: string) { return s.endsWith("yui"); }
function has(s: string) { return s.includes("tyu"); }
function where(s: string) { return s.indexOf("yu"); }
function whereLast(s: string) { return s.lastIndexOf("u"); }
function inLoop(s: string, n: number) {
    let count = 0;
    for (let i = 0; i < n; i++) if (s === "ertyui") count++;
    return count;
}
function anyValue(s: unknown) { return s === "ertyui"; }
function trimmed(s: string) { return s.trim() === "ertyui"; }
function code(s: string) { return s.charCodeAt(1) + s.length; }

const long = "QWERTYUIOPASDFGHJKLZXCVBNMQWERTYUIOPASDFGHJKLZXCVBNM";
const fresh = (to: number) => substringOfBaseWidenedTo16Bit(long, 2, to);
console.log("equals3", outside(equals3)(fresh(5)), outside(equals3)(fresh(6)));
console.log("equals6", outside(equals6)(fresh(8)), outside(equals6)(fresh(9)));
console.log("equals8", outside(equals8)(fresh(10)), outside(equals8)(fresh(11)));
console.log("equals13", outside(equals13)(fresh(15)), outside(equals13)(fresh(16)));
console.log("equals40", outside(equals40)(fresh(42)), outside(equals40)(fresh(43)));
console.log("differs6", outside(differs6)(fresh(8)), outside(differs6)(fresh(9)));
console.log("which", outside(which)(fresh(5)), outside(which)(fresh(8)), outside(which)(fresh(10)), outside(which)(fresh(15)), outside(which)(fresh(7)));
console.log("same", outside(same)(fresh(8), "ERTYUI".toLowerCase()), outside(same)("ERTYUI".toLowerCase(), fresh(8)), outside(same)(fresh(8), fresh(8)), outside(same)(fresh(8), "ERTYUO".toLowerCase()), outside(same)(fresh(30), fresh(30)));
console.log("same at the start of the bases only", outside(same)(fresh(8), substringOfBaseWidenedTo16Bit("QWERABCDEFGHIJKLMNOPQRSTUVWXYZ", 2, 8)));
console.log("starts", outside(starts)(fresh(8)), "ends", outside(ends)(fresh(8)), "has", outside(has)(fresh(8)), "where", outside(where)(fresh(8)), outside(whereLast)(fresh(8)));
console.log("inLoop", outside(inLoop)(fresh(8), 5));
console.log("anyValue", outside(anyValue)(fresh(8)));
console.log("trimmed", outside(trimmed)(fresh(8)));
console.log("code", outside(code)(fresh(8)));
