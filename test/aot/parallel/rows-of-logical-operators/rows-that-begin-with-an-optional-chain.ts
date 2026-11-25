const call = new Function("f", "a", "b", "c", "d", "return f(a, b, c, d)") as (f: Function, a?: unknown, b?: unknown, c?: unknown, d?: unknown) => any;
const box = { tag: "box" };
const inner: unknown[] = [0, 1, NaN, "", "a", null, undefined, false, true, 0n, box];
const values: unknown[] = [null, undefined, ...inner.map(x => ({ x, y: { x }, f() { log += "f"; return x; } })), 0, "", "a", false, box];
let log = "";
function see(name: string, value: unknown) { log += name; return value; }
function show(value: unknown) { return typeof value === "symbol" ? "symbol" : typeof value === "bigint" ? value + "n" : Object.is(value, -0) ? "-0" : value === box ? "box" : String(value); }
let sum = 0;
function mix(text: string) { for (let i = 0; i < text.length; i++) sum = (Math.imul(sum, 31) + text.charCodeAt(i)) | 0; }
function run(f: Function, operands: number) {
    sum = 0;
    let first = "";
    const at = [0, 0, 0, 0];
    for (;;) {
        log = "";
        let answer: string;
        try { answer = show(call(f, values[at[0]], values[at[1]], values[at[2]], values[at[3]])) + ":" + log; } catch { answer = "throws:" + log; }
        if (first.length < 60) first += answer + " ";
        mix(answer);
        let place = 0;
        while (place < operands && ++at[place] === values.length) at[place++] = 0;
        if (place === operands) break;
    }
    console.log(f.name, sum, first);
}
function row1(a: any, b: unknown, c: unknown, d: unknown) { return a?.x && see("b", b); }
function row2(a: any, b: unknown, c: unknown, d: unknown) { if (a?.x && see("b", b)) return 1; return 2; }
function row3(a: any, b: unknown, c: unknown, d: unknown) { a?.x && see("b", b); return log.length; }
function row4(a: any, b: unknown, c: unknown, d: unknown) { return a?.x || see("b", b); }
function row5(a: any, b: unknown, c: unknown, d: unknown) { if (a?.x || see("b", b)) return 1; return 2; }
function row6(a: any, b: unknown, c: unknown, d: unknown) { a?.x || see("b", b); return log.length; }
function row7(a: any, b: unknown, c: unknown, d: unknown) { return a?.x ?? see("b", b); }
function row8(a: any, b: unknown, c: unknown, d: unknown) { if (a?.x ?? see("b", b)) return 1; return 2; }
function row9(a: any, b: unknown, c: unknown, d: unknown) { a?.x ?? see("b", b); return log.length; }
function row10(a: any, b: unknown, c: unknown, d: unknown) { return a?.x && see("b", b) && see("c", c); }
function row11(a: any, b: unknown, c: unknown, d: unknown) { if (a?.x && see("b", b) && see("c", c)) return 1; return 2; }
function row12(a: any, b: unknown, c: unknown, d: unknown) { a?.x && see("b", b) && see("c", c); return log.length; }
function row13(a: any, b: unknown, c: unknown, d: unknown) { return a?.x || see("b", b) || see("c", c); }
function row14(a: any, b: unknown, c: unknown, d: unknown) { if (a?.x || see("b", b) || see("c", c)) return 1; return 2; }
function row15(a: any, b: unknown, c: unknown, d: unknown) { a?.x || see("b", b) || see("c", c); return log.length; }
function row16(a: any, b: unknown, c: unknown, d: unknown) { return a?.x && see("b", b) || see("c", c); }
function row17(a: any, b: unknown, c: unknown, d: unknown) { if (a?.x && see("b", b) || see("c", c)) return 1; return 2; }
function row18(a: any, b: unknown, c: unknown, d: unknown) { a?.x && see("b", b) || see("c", c); return log.length; }
function row19(a: any, b: unknown, c: unknown, d: unknown) { return a?.x || see("b", b) && see("c", c); }
function row20(a: any, b: unknown, c: unknown, d: unknown) { if (a?.x || see("b", b) && see("c", c)) return 1; return 2; }
function row21(a: any, b: unknown, c: unknown, d: unknown) { a?.x || see("b", b) && see("c", c); return log.length; }
function row22(a: any, b: unknown, c: unknown, d: unknown) { return (a?.x && see("b", b)) ?? see("c", c); }
function row23(a: any, b: unknown, c: unknown, d: unknown) { if ((a?.x && see("b", b)) ?? see("c", c)) return 1; return 2; }
function row24(a: any, b: unknown, c: unknown, d: unknown) { (a?.x && see("b", b)) ?? see("c", c); return log.length; }
function row25(a: any, b: unknown, c: unknown, d: unknown) { return (a?.x ?? see("b", b)) && see("c", c); }
function row26(a: any, b: unknown, c: unknown, d: unknown) { if ((a?.x ?? see("b", b)) && see("c", c)) return 1; return 2; }
function row27(a: any, b: unknown, c: unknown, d: unknown) { (a?.x ?? see("b", b)) && see("c", c); return log.length; }
function row28(a: any, b: unknown, c: unknown, d: unknown) { return (a?.x ?? see("b", b)) || see("c", c); }
function row29(a: any, b: unknown, c: unknown, d: unknown) { if ((a?.x ?? see("b", b)) || see("c", c)) return 1; return 2; }
function row30(a: any, b: unknown, c: unknown, d: unknown) { (a?.x ?? see("b", b)) || see("c", c); return log.length; }
function row31(a: any, b: unknown, c: unknown, d: unknown) { return a?.["x"] || see("b", b); }
function row32(a: any, b: unknown, c: unknown, d: unknown) { if (a?.["x"] || see("b", b)) return 1; return 2; }
function row33(a: any, b: unknown, c: unknown, d: unknown) { a?.["x"] || see("b", b); return log.length; }
function row34(a: any, b: unknown, c: unknown, d: unknown) { return a?.f() && see("b", b); }
function row35(a: any, b: unknown, c: unknown, d: unknown) { if (a?.f() && see("b", b)) return 1; return 2; }
function row36(a: any, b: unknown, c: unknown, d: unknown) { a?.f() && see("b", b); return log.length; }
function row37(a: any, b: unknown, c: unknown, d: unknown) { return a?.f?.() || see("b", b); }
function row38(a: any, b: unknown, c: unknown, d: unknown) { if (a?.f?.() || see("b", b)) return 1; return 2; }
function row39(a: any, b: unknown, c: unknown, d: unknown) { a?.f?.() || see("b", b); return log.length; }
function row40(a: any, b: unknown, c: unknown, d: unknown) { return a?.y?.x ?? see("b", b); }
function row41(a: any, b: unknown, c: unknown, d: unknown) { if (a?.y?.x ?? see("b", b)) return 1; return 2; }
function row42(a: any, b: unknown, c: unknown, d: unknown) { a?.y?.x ?? see("b", b); return log.length; }
function row43(a: any, b: unknown, c: unknown, d: unknown) { return a?.y.x || see("b", b) || see("c", c); }
function row44(a: any, b: unknown, c: unknown, d: unknown) { if (a?.y.x || see("b", b) || see("c", c)) return 1; return 2; }
function row45(a: any, b: unknown, c: unknown, d: unknown) { a?.y.x || see("b", b) || see("c", c); return log.length; }
function row46(a: any, b: unknown, c: unknown, d: unknown) { return (a?.y).x || see("b", b); }
function row47(a: any, b: unknown, c: unknown, d: unknown) { if ((a?.y).x || see("b", b)) return 1; return 2; }
function row48(a: any, b: unknown, c: unknown, d: unknown) { (a?.y).x || see("b", b); return log.length; }
function row49(a: any, b: unknown, c: unknown, d: unknown) { return a!?.x && see("b", b); }
function row50(a: any, b: unknown, c: unknown, d: unknown) { if (a!?.x && see("b", b)) return 1; return 2; }
function row51(a: any, b: unknown, c: unknown, d: unknown) { a!?.x && see("b", b); return log.length; }
function row52(a: any, b: unknown, c: unknown, d: unknown) { return see("b", b) && a?.x && see("c", c); }
function row53(a: any, b: unknown, c: unknown, d: unknown) { if (see("b", b) && a?.x && see("c", c)) return 1; return 2; }
function row54(a: any, b: unknown, c: unknown, d: unknown) { see("b", b) && a?.x && see("c", c); return log.length; }
for (const f of [row1, row2, row3, row4, row5, row6, row7, row8, row9, row10, row11, row12, row13, row14, row15, row16, row17, row18, row19, row20, row21, row22, row23, row24, row25, row26, row27, row28, row29, row30, row31, row32, row33, row34, row35, row36, row37, row38, row39, row40, row41, row42, row43, row44, row45, row46, row47, row48, row49, row50, row51, row52, row53, row54]) run(f, 3);
