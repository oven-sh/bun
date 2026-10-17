
function show(v: unknown): string {
    if (Array.isArray(v)) {
        const parts: string[] = [];
        for (let i = 0; i < v.length && i < 12; i++) parts.push(i in v ? show(v[i]) : "hole");
        const own = Object.getOwnPropertyNames(v).filter(k => k !== "length" && !/^\d+$/.test(k));
        return "[" + parts.join(",") + (v.length > 12 ? ",.. " + v.length + " .." + show(v[v.length - 1]) : "") + "]" + (own.length ? "{" + own.map(k => k + "=" + show((v as any)[k])).join(",") + "}" : "");
    }
    if (v === undefined) return "undefined";
    if (v === null) return "null";
    if (typeof v === "object") return "{" + Object.keys(v as object).join(",") + "}";
    return typeof v === "string" ? JSON.stringify(v) : String(v);
}
function thrown(e: unknown): string { return "throws " + (e instanceof Error ? e.constructor.name : show(e)); }
const lines: string[] = [];
let kept: unknown[] = [];
function churn(): void { for (let i = 0; i < 200; i++) kept[i % 7] = [i, { i }, "s" + i]; }

const holders: Array<(x: any) => any> = [x => x, x => x];
function holder(x: any): any { return holders[Date.now() > 0 ? 0 : 1](x); }
function c1(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one push double: " + c1());
function c2(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one push text: " + c2());
function c3(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one push undefined: " + c3());
function c4(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push(7.5, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one pushTwo double: " + c4());
function c5(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push("t", "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one pushTwo text: " + c5());
function c6(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push(undefined, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one pushTwo undefined: " + c6());
function c7(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.unshift(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one unshift double: " + c7());
function c8(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.unshift("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one unshift text: " + c8());
function c9(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.unshift(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one unshift undefined: " + c9());
function c10(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(1, 0, 7.5, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one spliceIn double: " + c10());
function c11(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(1, 0, "t", "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one spliceIn text: " + c11());
function c12(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(1, 0, undefined, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one spliceIn undefined: " + c12());
function c13(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(0, 1, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one spliceOver double: " + c13());
function c14(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(0, 1, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one spliceOver text: " + c14());
function c15(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(0, 1, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one spliceOver undefined: " + c15());
function c16(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one fill double: " + c16());
function c17(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one fill text: " + c17());
function c18(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one fill undefined: " + c18());
function c19(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill(7.5, 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one fillPart double: " + c19());
function c20(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill("t", 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one fillPart text: " + c20());
function c21(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill(undefined, 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one fillPart undefined: " + c21());
function c22(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[1] = 7.5; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one store double: " + c22());
function c23(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[1] = "t"; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one store text: " + c23());
function c24(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[1] = undefined; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one store undefined: " + c24());
function c25(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[a.length] = 7.5; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one storeAtEnd double: " + c25());
function c26(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[a.length] = "t"; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one storeAtEnd text: " + c26());
function c27(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[a.length] = undefined; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one storeAtEnd undefined: " + c27());
function c28(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.with(0, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one with double: " + c28());
function c29(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.with(0, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one with text: " + c29());
function c30(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.with(0, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one with undefined: " + c30());
function c31(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.concat([7.5]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one concat double: " + c31());
function c32(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.concat(["t"]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one concat text: " + c32());
function c33(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.concat([undefined]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one concat undefined: " + c33());
function c34(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.toSpliced(0, 0, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one toSpliced double: " + c34());
function c35(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.toSpliced(0, 0, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one toSpliced text: " + c35());
function c36(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.toSpliced(0, 0, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one toSpliced undefined: " + c36());
function c37(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push(7.5); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("int32 one pushMany double: " + c37());
function c38(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift(7.5); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("int32 one unshiftMany double: " + c38());
function c39(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push("t"); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("int32 one pushMany text: " + c39());
function c40(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift("t"); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("int32 one unshiftMany text: " + c40());
function c41(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push(undefined); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("int32 one pushMany undefined: " + c41());
function c42(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift(undefined); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("int32 one unshiftMany undefined: " + c42());
function c43(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one pop: " + c43());
function c44(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.shift(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one shift: " + c44());
function c45(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.reverse(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one reverse: " + c45());
function c46(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one sort: " + c46());
function c47(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.copyWithin(0, 1); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one copyWithin: " + c47());
function c48(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(0, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one spliceOut: " + c48());
function c49(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.length = 0; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one lengthZero: " + c49());
function c50(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one slice: " + c50());
function c51(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.map((x: unknown) => x); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one map: " + c51());
function c52(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.filter(() => true); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one filter: " + c52());
function c53(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.flat(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one flat: " + c53());
function c54(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.join(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one join: " + c54());
function c55(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.includes(3); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one includes: " + c55());
function c56(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.indexOf(3); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one indexOf: " + c56());
function c57(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.at(0); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one at: " + c57());
function c58(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = [...a]; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one spread: " + c58());
function c59(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = [...a.entries()]; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one entries: " + c59());
function c60(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve push double: " + c60());
function c61(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve push text: " + c61());
function c62(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve push undefined: " + c62());
function c63(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push(7.5, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve pushTwo double: " + c63());
function c64(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push("t", "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve pushTwo text: " + c64());
function c65(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push(undefined, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve pushTwo undefined: " + c65());
function c66(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.unshift(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve unshift double: " + c66());
function c67(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.unshift("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve unshift text: " + c67());
function c68(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.unshift(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve unshift undefined: " + c68());
function c69(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(1, 0, 7.5, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve spliceIn double: " + c69());
function c70(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(1, 0, "t", "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve spliceIn text: " + c70());
function c71(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(1, 0, undefined, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve spliceIn undefined: " + c71());
function c72(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(0, 1, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve spliceOver double: " + c72());
function c73(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(0, 1, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve spliceOver text: " + c73());
function c74(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(0, 1, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve spliceOver undefined: " + c74());
function c75(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve fill double: " + c75());
function c76(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve fill text: " + c76());
function c77(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve fill undefined: " + c77());
function c78(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill(7.5, 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve fillPart double: " + c78());
function c79(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill("t", 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve fillPart text: " + c79());
function c80(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill(undefined, 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve fillPart undefined: " + c80());
function c81(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[1] = 7.5; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve store double: " + c81());
function c82(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[1] = "t"; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve store text: " + c82());
function c83(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[1] = undefined; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve store undefined: " + c83());
function c84(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[a.length] = 7.5; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve storeAtEnd double: " + c84());
function c85(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[a.length] = "t"; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve storeAtEnd text: " + c85());
function c86(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[a.length] = undefined; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve storeAtEnd undefined: " + c86());
function c87(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.with(0, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve with double: " + c87());
function c88(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.with(0, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve with text: " + c88());
function c89(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.with(0, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve with undefined: " + c89());
function c90(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.concat([7.5]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve concat double: " + c90());
function c91(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.concat(["t"]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve concat text: " + c91());
function c92(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.concat([undefined]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve concat undefined: " + c92());
function c93(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.toSpliced(0, 0, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve toSpliced double: " + c93());
function c94(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.toSpliced(0, 0, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve toSpliced text: " + c94());
function c95(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.toSpliced(0, 0, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve toSpliced undefined: " + c95());
function c96(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push(7.5); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("int32 twelve pushMany double: " + c96());
function c97(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift(7.5); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("int32 twelve unshiftMany double: " + c97());
function c98(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push("t"); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("int32 twelve pushMany text: " + c98());
function c99(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift("t"); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("int32 twelve unshiftMany text: " + c99());
function c100(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push(undefined); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("int32 twelve pushMany undefined: " + c100());
function c101(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift(undefined); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("int32 twelve unshiftMany undefined: " + c101());
function c102(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve pop: " + c102());
function c103(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.shift(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve shift: " + c103());
function c104(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.reverse(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve reverse: " + c104());
function c105(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve sort: " + c105());
function c106(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.copyWithin(0, 1); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve copyWithin: " + c106());
function c107(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(0, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve spliceOut: " + c107());
function c108(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.length = 0; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve lengthZero: " + c108());
function c109(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve slice: " + c109());
function c110(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.map((x: unknown) => x); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve map: " + c110());
function c111(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.filter(() => true); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve filter: " + c111());
function c112(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.flat(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve flat: " + c112());
function c113(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.join(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve join: " + c113());
function c114(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.includes(3); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve includes: " + c114());
function c115(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.indexOf(3); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve indexOf: " + c115());
function c116(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.at(0); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve at: " + c116());
function c117(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = [...a]; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve spread: " + c117());
function c118(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = [...a.entries()]; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve entries: " + c118());
function c119(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one push double: " + c119());
function c120(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one push text: " + c120());
function c121(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one push undefined: " + c121());
function c122(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push(7.5, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one pushTwo double: " + c122());
function c123(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push("t", "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one pushTwo text: " + c123());
function c124(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push(undefined, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one pushTwo undefined: " + c124());
function c125(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.unshift(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one unshift double: " + c125());
function c126(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.unshift("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one unshift text: " + c126());
function c127(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.unshift(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one unshift undefined: " + c127());
function c128(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(1, 0, 7.5, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one spliceIn double: " + c128());
function c129(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(1, 0, "t", "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one spliceIn text: " + c129());
function c130(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(1, 0, undefined, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one spliceIn undefined: " + c130());
function c131(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(0, 1, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one spliceOver double: " + c131());
function c132(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(0, 1, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one spliceOver text: " + c132());
function c133(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(0, 1, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one spliceOver undefined: " + c133());
function c134(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one fill double: " + c134());
function c135(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one fill text: " + c135());
function c136(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one fill undefined: " + c136());
function c137(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill(7.5, 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one fillPart double: " + c137());
function c138(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill("t", 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one fillPart text: " + c138());
function c139(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill(undefined, 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one fillPart undefined: " + c139());
function c140(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[1] = 7.5; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one store double: " + c140());
function c141(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[1] = "t"; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one store text: " + c141());
function c142(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[1] = undefined; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one store undefined: " + c142());
function c143(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[a.length] = 7.5; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one storeAtEnd double: " + c143());
function c144(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[a.length] = "t"; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one storeAtEnd text: " + c144());
function c145(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[a.length] = undefined; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one storeAtEnd undefined: " + c145());
function c146(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.with(0, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one with double: " + c146());
function c147(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.with(0, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one with text: " + c147());
function c148(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.with(0, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one with undefined: " + c148());
function c149(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.concat([7.5]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one concat double: " + c149());
function c150(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.concat(["t"]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one concat text: " + c150());
function c151(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.concat([undefined]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one concat undefined: " + c151());
function c152(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.toSpliced(0, 0, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one toSpliced double: " + c152());
function c153(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.toSpliced(0, 0, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one toSpliced text: " + c153());
function c154(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.toSpliced(0, 0, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one toSpliced undefined: " + c154());
function c155(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push(7.5); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("double one pushMany double: " + c155());
function c156(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift(7.5); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("double one unshiftMany double: " + c156());
function c157(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push("t"); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("double one pushMany text: " + c157());
function c158(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift("t"); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("double one unshiftMany text: " + c158());
function c159(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push(undefined); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("double one pushMany undefined: " + c159());
function c160(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift(undefined); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("double one unshiftMany undefined: " + c160());
function c161(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one pop: " + c161());
function c162(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.shift(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one shift: " + c162());
function c163(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.reverse(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one reverse: " + c163());
function c164(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one sort: " + c164());
function c165(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.copyWithin(0, 1); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one copyWithin: " + c165());
function c166(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(0, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one spliceOut: " + c166());
function c167(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.length = 0; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one lengthZero: " + c167());
function c168(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one slice: " + c168());
function c169(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.map((x: unknown) => x); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one map: " + c169());
function c170(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.filter(() => true); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one filter: " + c170());
function c171(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.flat(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one flat: " + c171());
function c172(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.join(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one join: " + c172());
function c173(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.includes(3); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one includes: " + c173());
function c174(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.indexOf(3); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one indexOf: " + c174());
function c175(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.at(0); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one at: " + c175());
function c176(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = [...a]; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one spread: " + c176());
function c177(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = [...a.entries()]; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one entries: " + c177());
function c178(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve push double: " + c178());
function c179(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve push text: " + c179());
function c180(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve push undefined: " + c180());
function c181(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push(7.5, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve pushTwo double: " + c181());
function c182(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push("t", "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve pushTwo text: " + c182());
function c183(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push(undefined, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve pushTwo undefined: " + c183());
function c184(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.unshift(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve unshift double: " + c184());
function c185(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.unshift("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve unshift text: " + c185());
function c186(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.unshift(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve unshift undefined: " + c186());
function c187(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(1, 0, 7.5, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve spliceIn double: " + c187());
function c188(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(1, 0, "t", "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve spliceIn text: " + c188());
function c189(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(1, 0, undefined, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve spliceIn undefined: " + c189());
function c190(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(0, 1, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve spliceOver double: " + c190());
function c191(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(0, 1, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve spliceOver text: " + c191());
function c192(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(0, 1, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve spliceOver undefined: " + c192());
function c193(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve fill double: " + c193());
function c194(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve fill text: " + c194());
function c195(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve fill undefined: " + c195());
function c196(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill(7.5, 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve fillPart double: " + c196());
function c197(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill("t", 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve fillPart text: " + c197());
function c198(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill(undefined, 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve fillPart undefined: " + c198());
function c199(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[1] = 7.5; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve store double: " + c199());
function c200(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[1] = "t"; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve store text: " + c200());
function c201(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[1] = undefined; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve store undefined: " + c201());
function c202(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[a.length] = 7.5; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve storeAtEnd double: " + c202());
function c203(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[a.length] = "t"; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve storeAtEnd text: " + c203());
function c204(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[a.length] = undefined; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve storeAtEnd undefined: " + c204());
function c205(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.with(0, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve with double: " + c205());
function c206(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.with(0, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve with text: " + c206());
function c207(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.with(0, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve with undefined: " + c207());
function c208(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.concat([7.5]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve concat double: " + c208());
function c209(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.concat(["t"]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve concat text: " + c209());
function c210(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.concat([undefined]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve concat undefined: " + c210());
function c211(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.toSpliced(0, 0, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve toSpliced double: " + c211());
function c212(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.toSpliced(0, 0, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve toSpliced text: " + c212());
function c213(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.toSpliced(0, 0, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve toSpliced undefined: " + c213());
function c214(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push(7.5); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("double twelve pushMany double: " + c214());
function c215(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift(7.5); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("double twelve unshiftMany double: " + c215());
function c216(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push("t"); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("double twelve pushMany text: " + c216());
function c217(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift("t"); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("double twelve unshiftMany text: " + c217());
function c218(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push(undefined); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("double twelve pushMany undefined: " + c218());
function c219(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift(undefined); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("double twelve unshiftMany undefined: " + c219());
function c220(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve pop: " + c220());
function c221(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.shift(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve shift: " + c221());
function c222(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.reverse(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve reverse: " + c222());
function c223(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve sort: " + c223());
function c224(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.copyWithin(0, 1); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve copyWithin: " + c224());
function c225(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(0, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve spliceOut: " + c225());
function c226(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.length = 0; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve lengthZero: " + c226());
function c227(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve slice: " + c227());
function c228(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.map((x: unknown) => x); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve map: " + c228());
function c229(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.filter(() => true); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve filter: " + c229());
function c230(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.flat(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve flat: " + c230());
function c231(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.join(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve join: " + c231());
function c232(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.includes(3); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve includes: " + c232());
function c233(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.indexOf(3); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve indexOf: " + c233());
function c234(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.at(0); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve at: " + c234());
function c235(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = [...a]; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve spread: " + c235());
function c236(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = [...a.entries()]; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve entries: " + c236());
function c237(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one push double: " + c237());
function c238(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one push text: " + c238());
function c239(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one push undefined: " + c239());
function c240(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push(7.5, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one pushTwo double: " + c240());
function c241(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push("t", "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one pushTwo text: " + c241());
function c242(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push(undefined, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one pushTwo undefined: " + c242());
function c243(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.unshift(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one unshift double: " + c243());
function c244(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.unshift("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one unshift text: " + c244());
function c245(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.unshift(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one unshift undefined: " + c245());
function c246(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(1, 0, 7.5, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one spliceIn double: " + c246());
function c247(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(1, 0, "t", "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one spliceIn text: " + c247());
function c248(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(1, 0, undefined, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one spliceIn undefined: " + c248());
function c249(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(0, 1, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one spliceOver double: " + c249());
function c250(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(0, 1, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one spliceOver text: " + c250());
function c251(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(0, 1, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one spliceOver undefined: " + c251());
function c252(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one fill double: " + c252());
function c253(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one fill text: " + c253());
function c254(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one fill undefined: " + c254());
function c255(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill(7.5, 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one fillPart double: " + c255());
function c256(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill("t", 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one fillPart text: " + c256());
function c257(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill(undefined, 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one fillPart undefined: " + c257());
function c258(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[1] = 7.5; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one store double: " + c258());
function c259(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[1] = "t"; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one store text: " + c259());
function c260(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[1] = undefined; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one store undefined: " + c260());
function c261(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[a.length] = 7.5; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one storeAtEnd double: " + c261());
function c262(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[a.length] = "t"; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one storeAtEnd text: " + c262());
function c263(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[a.length] = undefined; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one storeAtEnd undefined: " + c263());
function c264(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.with(0, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one with double: " + c264());
function c265(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.with(0, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one with text: " + c265());
function c266(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.with(0, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one with undefined: " + c266());
function c267(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.concat([7.5]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one concat double: " + c267());
function c268(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.concat(["t"]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one concat text: " + c268());
function c269(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.concat([undefined]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one concat undefined: " + c269());
function c270(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.toSpliced(0, 0, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one toSpliced double: " + c270());
function c271(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.toSpliced(0, 0, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one toSpliced text: " + c271());
function c272(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.toSpliced(0, 0, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one toSpliced undefined: " + c272());
function c273(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push(7.5); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("values one pushMany double: " + c273());
function c274(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift(7.5); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("values one unshiftMany double: " + c274());
function c275(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push("t"); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("values one pushMany text: " + c275());
function c276(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift("t"); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("values one unshiftMany text: " + c276());
function c277(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push(undefined); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("values one pushMany undefined: " + c277());
function c278(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift(undefined); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("values one unshiftMany undefined: " + c278());
function c279(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one pop: " + c279());
function c280(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.shift(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one shift: " + c280());
function c281(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.reverse(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one reverse: " + c281());
function c282(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one sort: " + c282());
function c283(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.copyWithin(0, 1); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one copyWithin: " + c283());
function c284(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(0, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one spliceOut: " + c284());
function c285(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.length = 0; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one lengthZero: " + c285());
function c286(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one slice: " + c286());
function c287(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.map((x: unknown) => x); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one map: " + c287());
function c288(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.filter(() => true); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one filter: " + c288());
function c289(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.flat(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one flat: " + c289());
function c290(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.join(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one join: " + c290());
function c291(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.includes(3); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one includes: " + c291());
function c292(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.indexOf(3); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one indexOf: " + c292());
function c293(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.at(0); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one at: " + c293());
function c294(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = [...a]; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one spread: " + c294());
function c295(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = [...a.entries()]; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one entries: " + c295());
function c296(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve push double: " + c296());
function c297(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve push text: " + c297());
function c298(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve push undefined: " + c298());
function c299(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push(7.5, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve pushTwo double: " + c299());
function c300(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push("t", "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve pushTwo text: " + c300());
function c301(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push(undefined, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve pushTwo undefined: " + c301());
function c302(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.unshift(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve unshift double: " + c302());
function c303(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.unshift("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve unshift text: " + c303());
function c304(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.unshift(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve unshift undefined: " + c304());
function c305(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(1, 0, 7.5, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve spliceIn double: " + c305());
function c306(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(1, 0, "t", "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve spliceIn text: " + c306());
function c307(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(1, 0, undefined, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve spliceIn undefined: " + c307());
function c308(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(0, 1, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve spliceOver double: " + c308());
function c309(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(0, 1, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve spliceOver text: " + c309());
function c310(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(0, 1, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve spliceOver undefined: " + c310());
function c311(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve fill double: " + c311());
function c312(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve fill text: " + c312());
function c313(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve fill undefined: " + c313());
function c314(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill(7.5, 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve fillPart double: " + c314());
function c315(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill("t", 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve fillPart text: " + c315());
function c316(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill(undefined, 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve fillPart undefined: " + c316());
function c317(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[1] = 7.5; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve store double: " + c317());
function c318(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[1] = "t"; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve store text: " + c318());
function c319(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[1] = undefined; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve store undefined: " + c319());
function c320(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[a.length] = 7.5; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve storeAtEnd double: " + c320());
function c321(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[a.length] = "t"; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve storeAtEnd text: " + c321());
function c322(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[a.length] = undefined; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve storeAtEnd undefined: " + c322());
function c323(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.with(0, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve with double: " + c323());
function c324(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.with(0, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve with text: " + c324());
function c325(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.with(0, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve with undefined: " + c325());
function c326(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.concat([7.5]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve concat double: " + c326());
function c327(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.concat(["t"]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve concat text: " + c327());
function c328(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.concat([undefined]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve concat undefined: " + c328());
function c329(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.toSpliced(0, 0, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve toSpliced double: " + c329());
function c330(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.toSpliced(0, 0, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve toSpliced text: " + c330());
function c331(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.toSpliced(0, 0, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve toSpliced undefined: " + c331());
function c332(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push(7.5); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("values twelve pushMany double: " + c332());
function c333(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift(7.5); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("values twelve unshiftMany double: " + c333());
function c334(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push("t"); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("values twelve pushMany text: " + c334());
function c335(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift("t"); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("values twelve unshiftMany text: " + c335());
function c336(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push(undefined); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("values twelve pushMany undefined: " + c336());
function c337(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift(undefined); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("values twelve unshiftMany undefined: " + c337());
function c338(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve pop: " + c338());
function c339(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.shift(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve shift: " + c339());
function c340(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.reverse(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve reverse: " + c340());
function c341(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve sort: " + c341());
function c342(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.copyWithin(0, 1); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve copyWithin: " + c342());
function c343(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(0, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve spliceOut: " + c343());
function c344(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.length = 0; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve lengthZero: " + c344());
function c345(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve slice: " + c345());
function c346(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.map((x: unknown) => x); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve map: " + c346());
function c347(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.filter(() => true); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve filter: " + c347());
function c348(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.flat(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve flat: " + c348());
function c349(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.join(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve join: " + c349());
function c350(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.includes(3); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve includes: " + c350());
function c351(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.indexOf(3); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve indexOf: " + c351());
function c352(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.at(0); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve at: " + c352());
function c353(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = [...a]; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve spread: " + c353());
function c354(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = [...a.entries()]; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve entries: " + c354());
function c355(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one push double: " + c355());
function c356(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one push text: " + c356());
function c357(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one push undefined: " + c357());
function c358(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push(7.5, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one pushTwo double: " + c358());
function c359(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push("t", "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one pushTwo text: " + c359());
function c360(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push(undefined, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one pushTwo undefined: " + c360());
function c361(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.unshift(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one unshift double: " + c361());
function c362(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.unshift("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one unshift text: " + c362());
function c363(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.unshift(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one unshift undefined: " + c363());
function c364(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(1, 0, 7.5, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one spliceIn double: " + c364());
function c365(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(1, 0, "t", "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one spliceIn text: " + c365());
function c366(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(1, 0, undefined, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one spliceIn undefined: " + c366());
function c367(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(0, 1, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one spliceOver double: " + c367());
function c368(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(0, 1, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one spliceOver text: " + c368());
function c369(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(0, 1, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one spliceOver undefined: " + c369());
function c370(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one fill double: " + c370());
function c371(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one fill text: " + c371());
function c372(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one fill undefined: " + c372());
function c373(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill(7.5, 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one fillPart double: " + c373());
function c374(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill("t", 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one fillPart text: " + c374());
function c375(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill(undefined, 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one fillPart undefined: " + c375());
function c376(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[1] = 7.5; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one store double: " + c376());
function c377(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[1] = "t"; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one store text: " + c377());
function c378(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[1] = undefined; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one store undefined: " + c378());
function c379(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[a.length] = 7.5; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one storeAtEnd double: " + c379());
function c380(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[a.length] = "t"; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one storeAtEnd text: " + c380());
function c381(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[a.length] = undefined; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one storeAtEnd undefined: " + c381());
function c382(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.with(0, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one with double: " + c382());
function c383(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.with(0, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one with text: " + c383());
function c384(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.with(0, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one with undefined: " + c384());
function c385(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.concat([7.5]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one concat double: " + c385());
function c386(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.concat(["t"]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one concat text: " + c386());
function c387(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.concat([undefined]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one concat undefined: " + c387());
function c388(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.toSpliced(0, 0, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one toSpliced double: " + c388());
function c389(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.toSpliced(0, 0, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one toSpliced text: " + c389());
function c390(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.toSpliced(0, 0, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one toSpliced undefined: " + c390());
function c391(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push(7.5); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("mixed one pushMany double: " + c391());
function c392(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift(7.5); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("mixed one unshiftMany double: " + c392());
function c393(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push("t"); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("mixed one pushMany text: " + c393());
function c394(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift("t"); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("mixed one unshiftMany text: " + c394());
function c395(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push(undefined); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("mixed one pushMany undefined: " + c395());
function c396(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift(undefined); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("mixed one unshiftMany undefined: " + c396());
function c397(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one pop: " + c397());
function c398(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.shift(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one shift: " + c398());
function c399(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.reverse(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one reverse: " + c399());
function c400(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one sort: " + c400());
function c401(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.copyWithin(0, 1); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one copyWithin: " + c401());
function c402(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(0, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one spliceOut: " + c402());
function c403(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.length = 0; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one lengthZero: " + c403());
function c404(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one slice: " + c404());
function c405(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.map((x: unknown) => x); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one map: " + c405());
function c406(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.filter(() => true); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one filter: " + c406());
function c407(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.flat(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one flat: " + c407());
function c408(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.join(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one join: " + c408());
function c409(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.includes(3); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one includes: " + c409());
function c410(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.indexOf(3); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one indexOf: " + c410());
function c411(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.at(0); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one at: " + c411());
function c412(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = [...a]; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one spread: " + c412());
function c413(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = [...a.entries()]; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one entries: " + c413());
function c414(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve push double: " + c414());
function c415(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve push text: " + c415());
function c416(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve push undefined: " + c416());
function c417(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push(7.5, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve pushTwo double: " + c417());
function c418(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push("t", "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve pushTwo text: " + c418());
function c419(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push(undefined, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve pushTwo undefined: " + c419());
function c420(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.unshift(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve unshift double: " + c420());
function c421(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.unshift("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve unshift text: " + c421());
function c422(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.unshift(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve unshift undefined: " + c422());
function c423(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(1, 0, 7.5, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve spliceIn double: " + c423());
function c424(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(1, 0, "t", "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve spliceIn text: " + c424());
function c425(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(1, 0, undefined, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve spliceIn undefined: " + c425());
function c426(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(0, 1, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve spliceOver double: " + c426());
function c427(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(0, 1, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve spliceOver text: " + c427());
function c428(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(0, 1, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve spliceOver undefined: " + c428());
function c429(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve fill double: " + c429());
function c430(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve fill text: " + c430());
function c431(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve fill undefined: " + c431());
function c432(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill(7.5, 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve fillPart double: " + c432());
function c433(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill("t", 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve fillPart text: " + c433());
function c434(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill(undefined, 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve fillPart undefined: " + c434());
function c435(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[1] = 7.5; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve store double: " + c435());
function c436(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[1] = "t"; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve store text: " + c436());
function c437(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[1] = undefined; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve store undefined: " + c437());
function c438(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[a.length] = 7.5; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve storeAtEnd double: " + c438());
function c439(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[a.length] = "t"; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve storeAtEnd text: " + c439());
function c440(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[a.length] = undefined; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve storeAtEnd undefined: " + c440());
function c441(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.with(0, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve with double: " + c441());
function c442(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.with(0, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve with text: " + c442());
function c443(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.with(0, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve with undefined: " + c443());
function c444(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.concat([7.5]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve concat double: " + c444());
function c445(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.concat(["t"]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve concat text: " + c445());
function c446(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.concat([undefined]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve concat undefined: " + c446());
function c447(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.toSpliced(0, 0, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve toSpliced double: " + c447());
function c448(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.toSpliced(0, 0, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve toSpliced text: " + c448());
function c449(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.toSpliced(0, 0, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve toSpliced undefined: " + c449());
function c450(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push(7.5); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("mixed twelve pushMany double: " + c450());
function c451(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift(7.5); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("mixed twelve unshiftMany double: " + c451());
function c452(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push("t"); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("mixed twelve pushMany text: " + c452());
function c453(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift("t"); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("mixed twelve unshiftMany text: " + c453());
function c454(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push(undefined); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("mixed twelve pushMany undefined: " + c454());
function c455(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift(undefined); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("mixed twelve unshiftMany undefined: " + c455());
function c456(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve pop: " + c456());
function c457(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.shift(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve shift: " + c457());
function c458(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.reverse(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve reverse: " + c458());
function c459(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve sort: " + c459());
function c460(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.copyWithin(0, 1); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve copyWithin: " + c460());
function c461(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(0, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve spliceOut: " + c461());
function c462(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.length = 0; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve lengthZero: " + c462());
function c463(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve slice: " + c463());
function c464(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.map((x: unknown) => x); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve map: " + c464());
function c465(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.filter(() => true); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve filter: " + c465());
function c466(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.flat(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve flat: " + c466());
function c467(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.join(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve join: " + c467());
function c468(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.includes(3); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve includes: " + c468());
function c469(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.indexOf(3); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve indexOf: " + c469());
function c470(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.at(0); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve at: " + c470());
function c471(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = [...a]; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve spread: " + c471());
function c472(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = [...a.entries()]; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve entries: " + c472());
function c473(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one push double: " + c473());
function c474(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one push text: " + c474());
function c475(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one push undefined: " + c475());
function c476(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push(7.5, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one pushTwo double: " + c476());
function c477(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push("t", "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one pushTwo text: " + c477());
function c478(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push(undefined, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one pushTwo undefined: " + c478());
function c479(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.unshift(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one unshift double: " + c479());
function c480(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.unshift("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one unshift text: " + c480());
function c481(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.unshift(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one unshift undefined: " + c481());
function c482(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(1, 0, 7.5, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one spliceIn double: " + c482());
function c483(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(1, 0, "t", "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one spliceIn text: " + c483());
function c484(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(1, 0, undefined, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one spliceIn undefined: " + c484());
function c485(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(0, 1, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one spliceOver double: " + c485());
function c486(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(0, 1, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one spliceOver text: " + c486());
function c487(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(0, 1, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one spliceOver undefined: " + c487());
function c488(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one fill double: " + c488());
function c489(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one fill text: " + c489());
function c490(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one fill undefined: " + c490());
function c491(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill(7.5, 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one fillPart double: " + c491());
function c492(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill("t", 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one fillPart text: " + c492());
function c493(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill(undefined, 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one fillPart undefined: " + c493());
function c494(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[1] = 7.5; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one store double: " + c494());
function c495(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[1] = "t"; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one store text: " + c495());
function c496(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[1] = undefined; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one store undefined: " + c496());
function c497(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[a.length] = 7.5; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one storeAtEnd double: " + c497());
function c498(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[a.length] = "t"; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one storeAtEnd text: " + c498());
function c499(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[a.length] = undefined; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one storeAtEnd undefined: " + c499());
function c500(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.with(0, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one with double: " + c500());
function c501(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.with(0, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one with text: " + c501());
function c502(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.with(0, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one with undefined: " + c502());
function c503(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.concat([7.5]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one concat double: " + c503());
function c504(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.concat(["t"]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one concat text: " + c504());
function c505(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.concat([undefined]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one concat undefined: " + c505());
function c506(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.toSpliced(0, 0, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one toSpliced double: " + c506());
function c507(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.toSpliced(0, 0, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one toSpliced text: " + c507());
function c508(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.toSpliced(0, 0, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one toSpliced undefined: " + c508());
function c509(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push(7.5); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("empty one pushMany double: " + c509());
function c510(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift(7.5); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("empty one unshiftMany double: " + c510());
function c511(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push("t"); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("empty one pushMany text: " + c511());
function c512(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift("t"); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("empty one unshiftMany text: " + c512());
function c513(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push(undefined); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("empty one pushMany undefined: " + c513());
function c514(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift(undefined); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("empty one unshiftMany undefined: " + c514());
function c515(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one pop: " + c515());
function c516(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.shift(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one shift: " + c516());
function c517(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.reverse(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one reverse: " + c517());
function c518(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one sort: " + c518());
function c519(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.copyWithin(0, 1); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one copyWithin: " + c519());
function c520(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(0, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one spliceOut: " + c520());
function c521(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.length = 0; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one lengthZero: " + c521());
function c522(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one slice: " + c522());
function c523(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.map((x: unknown) => x); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one map: " + c523());
function c524(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.filter(() => true); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one filter: " + c524());
function c525(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.flat(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one flat: " + c525());
function c526(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.join(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one join: " + c526());
function c527(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.includes(3); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one includes: " + c527());
function c528(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.indexOf(3); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one indexOf: " + c528());
function c529(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.at(0); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one at: " + c529());
function c530(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = [...a]; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one spread: " + c530());
function c531(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = [...a.entries()]; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one entries: " + c531());
function c532(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve push double: " + c532());
function c533(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve push text: " + c533());
function c534(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve push undefined: " + c534());
function c535(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push(7.5, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve pushTwo double: " + c535());
function c536(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push("t", "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve pushTwo text: " + c536());
function c537(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push(undefined, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve pushTwo undefined: " + c537());
function c538(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.unshift(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve unshift double: " + c538());
function c539(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.unshift("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve unshift text: " + c539());
function c540(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.unshift(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve unshift undefined: " + c540());
function c541(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(1, 0, 7.5, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve spliceIn double: " + c541());
function c542(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(1, 0, "t", "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve spliceIn text: " + c542());
function c543(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(1, 0, undefined, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve spliceIn undefined: " + c543());
function c544(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(0, 1, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve spliceOver double: " + c544());
function c545(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(0, 1, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve spliceOver text: " + c545());
function c546(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(0, 1, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve spliceOver undefined: " + c546());
function c547(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve fill double: " + c547());
function c548(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve fill text: " + c548());
function c549(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve fill undefined: " + c549());
function c550(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill(7.5, 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve fillPart double: " + c550());
function c551(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill("t", 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve fillPart text: " + c551());
function c552(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill(undefined, 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve fillPart undefined: " + c552());
function c553(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[1] = 7.5; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve store double: " + c553());
function c554(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[1] = "t"; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve store text: " + c554());
function c555(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[1] = undefined; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve store undefined: " + c555());
function c556(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[a.length] = 7.5; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve storeAtEnd double: " + c556());
function c557(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[a.length] = "t"; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve storeAtEnd text: " + c557());
function c558(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[a.length] = undefined; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve storeAtEnd undefined: " + c558());
function c559(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.with(0, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve with double: " + c559());
function c560(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.with(0, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve with text: " + c560());
function c561(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.with(0, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve with undefined: " + c561());
function c562(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.concat([7.5]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve concat double: " + c562());
function c563(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.concat(["t"]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve concat text: " + c563());
function c564(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.concat([undefined]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve concat undefined: " + c564());
function c565(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.toSpliced(0, 0, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve toSpliced double: " + c565());
function c566(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.toSpliced(0, 0, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve toSpliced text: " + c566());
function c567(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.toSpliced(0, 0, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve toSpliced undefined: " + c567());
function c568(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push(7.5); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("empty twelve pushMany double: " + c568());
function c569(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift(7.5); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("empty twelve unshiftMany double: " + c569());
function c570(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push("t"); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("empty twelve pushMany text: " + c570());
function c571(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift("t"); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("empty twelve unshiftMany text: " + c571());
function c572(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push(undefined); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("empty twelve pushMany undefined: " + c572());
function c573(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift(undefined); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("empty twelve unshiftMany undefined: " + c573());
function c574(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve pop: " + c574());
function c575(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.shift(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve shift: " + c575());
function c576(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.reverse(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve reverse: " + c576());
function c577(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve sort: " + c577());
function c578(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.copyWithin(0, 1); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve copyWithin: " + c578());
function c579(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(0, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve spliceOut: " + c579());
function c580(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.length = 0; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve lengthZero: " + c580());
function c581(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve slice: " + c581());
function c582(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.map((x: unknown) => x); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve map: " + c582());
function c583(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.filter(() => true); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve filter: " + c583());
function c584(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.flat(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve flat: " + c584());
function c585(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.join(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve join: " + c585());
function c586(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.includes(3); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve includes: " + c586());
function c587(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.indexOf(3); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve indexOf: " + c587());
function c588(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.at(0); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve at: " + c588());
function c589(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = [...a]; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve spread: " + c589());
function c590(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = [...a.entries()]; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve entries: " + c590());
function c591(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one push double: " + c591());
function c592(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one push text: " + c592());
function c593(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one push undefined: " + c593());
function c594(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push(7.5, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one pushTwo double: " + c594());
function c595(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push("t", "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one pushTwo text: " + c595());
function c596(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push(undefined, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one pushTwo undefined: " + c596());
function c597(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.unshift(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one unshift double: " + c597());
function c598(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.unshift("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one unshift text: " + c598());
function c599(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.unshift(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one unshift undefined: " + c599());
function c600(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(1, 0, 7.5, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one spliceIn double: " + c600());
function c601(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(1, 0, "t", "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one spliceIn text: " + c601());
function c602(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(1, 0, undefined, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one spliceIn undefined: " + c602());
function c603(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(0, 1, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one spliceOver double: " + c603());
function c604(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(0, 1, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one spliceOver text: " + c604());
function c605(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(0, 1, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one spliceOver undefined: " + c605());
function c606(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one fill double: " + c606());
function c607(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one fill text: " + c607());
function c608(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one fill undefined: " + c608());
function c609(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill(7.5, 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one fillPart double: " + c609());
function c610(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill("t", 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one fillPart text: " + c610());
function c611(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill(undefined, 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one fillPart undefined: " + c611());
function c612(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[1] = 7.5; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one store double: " + c612());
function c613(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[1] = "t"; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one store text: " + c613());
function c614(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[1] = undefined; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one store undefined: " + c614());
function c615(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[a.length] = 7.5; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one storeAtEnd double: " + c615());
function c616(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[a.length] = "t"; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one storeAtEnd text: " + c616());
function c617(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[a.length] = undefined; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one storeAtEnd undefined: " + c617());
function c618(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.with(0, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one with double: " + c618());
function c619(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.with(0, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one with text: " + c619());
function c620(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.with(0, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one with undefined: " + c620());
function c621(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.concat([7.5]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one concat double: " + c621());
function c622(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.concat(["t"]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one concat text: " + c622());
function c623(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.concat([undefined]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one concat undefined: " + c623());
function c624(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.toSpliced(0, 0, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one toSpliced double: " + c624());
function c625(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.toSpliced(0, 0, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one toSpliced text: " + c625());
function c626(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.toSpliced(0, 0, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one toSpliced undefined: " + c626());
function c627(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push(7.5); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("holes one pushMany double: " + c627());
function c628(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift(7.5); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("holes one unshiftMany double: " + c628());
function c629(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push("t"); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("holes one pushMany text: " + c629());
function c630(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift("t"); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("holes one unshiftMany text: " + c630());
function c631(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push(undefined); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("holes one pushMany undefined: " + c631());
function c632(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift(undefined); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("holes one unshiftMany undefined: " + c632());
function c633(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one pop: " + c633());
function c634(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.shift(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one shift: " + c634());
function c635(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.reverse(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one reverse: " + c635());
function c636(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one sort: " + c636());
function c637(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.copyWithin(0, 1); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one copyWithin: " + c637());
function c638(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(0, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one spliceOut: " + c638());
function c639(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.length = 0; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one lengthZero: " + c639());
function c640(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one slice: " + c640());
function c641(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.map((x: unknown) => x); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one map: " + c641());
function c642(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.filter(() => true); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one filter: " + c642());
function c643(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.flat(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one flat: " + c643());
function c644(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.join(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one join: " + c644());
function c645(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.includes(3); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one includes: " + c645());
function c646(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.indexOf(3); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one indexOf: " + c646());
function c647(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.at(0); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one at: " + c647());
function c648(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = [...a]; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one spread: " + c648());
function c649(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = [...a.entries()]; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one entries: " + c649());
function c650(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve push double: " + c650());
function c651(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve push text: " + c651());
function c652(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve push undefined: " + c652());
function c653(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push(7.5, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve pushTwo double: " + c653());
function c654(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push("t", "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve pushTwo text: " + c654());
function c655(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push(undefined, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve pushTwo undefined: " + c655());
function c656(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.unshift(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve unshift double: " + c656());
function c657(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.unshift("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve unshift text: " + c657());
function c658(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.unshift(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve unshift undefined: " + c658());
function c659(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(1, 0, 7.5, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve spliceIn double: " + c659());
function c660(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(1, 0, "t", "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve spliceIn text: " + c660());
function c661(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(1, 0, undefined, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve spliceIn undefined: " + c661());
function c662(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(0, 1, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve spliceOver double: " + c662());
function c663(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(0, 1, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve spliceOver text: " + c663());
function c664(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(0, 1, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve spliceOver undefined: " + c664());
function c665(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve fill double: " + c665());
function c666(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve fill text: " + c666());
function c667(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve fill undefined: " + c667());
function c668(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill(7.5, 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve fillPart double: " + c668());
function c669(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill("t", 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve fillPart text: " + c669());
function c670(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill(undefined, 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve fillPart undefined: " + c670());
function c671(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[1] = 7.5; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve store double: " + c671());
function c672(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[1] = "t"; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve store text: " + c672());
function c673(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[1] = undefined; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve store undefined: " + c673());
function c674(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[a.length] = 7.5; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve storeAtEnd double: " + c674());
function c675(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[a.length] = "t"; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve storeAtEnd text: " + c675());
function c676(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[a.length] = undefined; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve storeAtEnd undefined: " + c676());
function c677(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.with(0, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve with double: " + c677());
function c678(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.with(0, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve with text: " + c678());
function c679(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.with(0, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve with undefined: " + c679());
function c680(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.concat([7.5]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve concat double: " + c680());
function c681(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.concat(["t"]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve concat text: " + c681());
function c682(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.concat([undefined]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve concat undefined: " + c682());
function c683(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.toSpliced(0, 0, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve toSpliced double: " + c683());
function c684(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.toSpliced(0, 0, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve toSpliced text: " + c684());
function c685(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.toSpliced(0, 0, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve toSpliced undefined: " + c685());
function c686(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push(7.5); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("holes twelve pushMany double: " + c686());
function c687(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift(7.5); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("holes twelve unshiftMany double: " + c687());
function c688(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push("t"); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("holes twelve pushMany text: " + c688());
function c689(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift("t"); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("holes twelve unshiftMany text: " + c689());
function c690(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push(undefined); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("holes twelve pushMany undefined: " + c690());
function c691(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift(undefined); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("holes twelve unshiftMany undefined: " + c691());
function c692(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve pop: " + c692());
function c693(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.shift(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve shift: " + c693());
function c694(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.reverse(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve reverse: " + c694());
function c695(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve sort: " + c695());
function c696(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.copyWithin(0, 1); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve copyWithin: " + c696());
function c697(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(0, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve spliceOut: " + c697());
function c698(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.length = 0; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve lengthZero: " + c698());
function c699(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve slice: " + c699());
function c700(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.map((x: unknown) => x); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve map: " + c700());
function c701(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.filter(() => true); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve filter: " + c701());
function c702(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.flat(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve flat: " + c702());
function c703(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.join(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve join: " + c703());
function c704(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.includes(3); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve includes: " + c704());
function c705(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.indexOf(3); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve indexOf: " + c705());
function c706(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.at(0); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve at: " + c706());
function c707(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = [...a]; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve spread: " + c707());
function c708(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = [...a.entries()]; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve entries: " + c708());
function c709(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one push double: " + c709());
function c710(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one push text: " + c710());
function c711(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one push undefined: " + c711());
function c712(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push(7.5, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one pushTwo double: " + c712());
function c713(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push("t", "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one pushTwo text: " + c713());
function c714(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push(undefined, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one pushTwo undefined: " + c714());
function c715(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.unshift(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one unshift double: " + c715());
function c716(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.unshift("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one unshift text: " + c716());
function c717(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.unshift(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one unshift undefined: " + c717());
function c718(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(1, 0, 7.5, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one spliceIn double: " + c718());
function c719(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(1, 0, "t", "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one spliceIn text: " + c719());
function c720(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(1, 0, undefined, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one spliceIn undefined: " + c720());
function c721(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(0, 1, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one spliceOver double: " + c721());
function c722(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(0, 1, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one spliceOver text: " + c722());
function c723(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(0, 1, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one spliceOver undefined: " + c723());
function c724(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one fill double: " + c724());
function c725(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one fill text: " + c725());
function c726(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one fill undefined: " + c726());
function c727(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill(7.5, 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one fillPart double: " + c727());
function c728(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill("t", 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one fillPart text: " + c728());
function c729(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill(undefined, 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one fillPart undefined: " + c729());
function c730(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[1] = 7.5; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one store double: " + c730());
function c731(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[1] = "t"; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one store text: " + c731());
function c732(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[1] = undefined; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one store undefined: " + c732());
function c733(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[a.length] = 7.5; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one storeAtEnd double: " + c733());
function c734(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[a.length] = "t"; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one storeAtEnd text: " + c734());
function c735(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[a.length] = undefined; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one storeAtEnd undefined: " + c735());
function c736(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.with(0, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one with double: " + c736());
function c737(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.with(0, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one with text: " + c737());
function c738(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.with(0, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one with undefined: " + c738());
function c739(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.concat([7.5]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one concat double: " + c739());
function c740(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.concat(["t"]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one concat text: " + c740());
function c741(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.concat([undefined]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one concat undefined: " + c741());
function c742(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.toSpliced(0, 0, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one toSpliced double: " + c742());
function c743(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.toSpliced(0, 0, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one toSpliced text: " + c743());
function c744(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.toSpliced(0, 0, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one toSpliced undefined: " + c744());
function c745(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push(7.5); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one pushMany double: " + c745());
function c746(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift(7.5); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one unshiftMany double: " + c746());
function c747(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push("t"); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one pushMany text: " + c747());
function c748(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift("t"); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one unshiftMany text: " + c748());
function c749(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push(undefined); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one pushMany undefined: " + c749());
function c750(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift(undefined); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one unshiftMany undefined: " + c750());
function c751(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one pop: " + c751());
function c752(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.shift(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one shift: " + c752());
function c753(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.reverse(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one reverse: " + c753());
function c754(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one sort: " + c754());
function c755(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.copyWithin(0, 1); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one copyWithin: " + c755());
function c756(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(0, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one spliceOut: " + c756());
function c757(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.length = 0; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one lengthZero: " + c757());
function c758(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one slice: " + c758());
function c759(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.map((x: unknown) => x); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one map: " + c759());
function c760(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.filter(() => true); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one filter: " + c760());
function c761(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.flat(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one flat: " + c761());
function c762(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.join(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one join: " + c762());
function c763(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.includes(3); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one includes: " + c763());
function c764(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.indexOf(3); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one indexOf: " + c764());
function c765(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.at(0); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one at: " + c765());
function c766(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = [...a]; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one spread: " + c766());
function c767(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = [...a.entries()]; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one entries: " + c767());
function c768(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve push double: " + c768());
function c769(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve push text: " + c769());
function c770(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve push undefined: " + c770());
function c771(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push(7.5, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve pushTwo double: " + c771());
function c772(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push("t", "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve pushTwo text: " + c772());
function c773(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push(undefined, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve pushTwo undefined: " + c773());
function c774(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.unshift(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve unshift double: " + c774());
function c775(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.unshift("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve unshift text: " + c775());
function c776(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.unshift(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve unshift undefined: " + c776());
function c777(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(1, 0, 7.5, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve spliceIn double: " + c777());
function c778(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(1, 0, "t", "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve spliceIn text: " + c778());
function c779(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(1, 0, undefined, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve spliceIn undefined: " + c779());
function c780(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(0, 1, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve spliceOver double: " + c780());
function c781(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(0, 1, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve spliceOver text: " + c781());
function c782(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(0, 1, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve spliceOver undefined: " + c782());
function c783(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve fill double: " + c783());
function c784(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve fill text: " + c784());
function c785(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve fill undefined: " + c785());
function c786(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill(7.5, 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve fillPart double: " + c786());
function c787(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill("t", 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve fillPart text: " + c787());
function c788(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill(undefined, 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve fillPart undefined: " + c788());
function c789(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[1] = 7.5; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve store double: " + c789());
function c790(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[1] = "t"; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve store text: " + c790());
function c791(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[1] = undefined; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve store undefined: " + c791());
function c792(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[a.length] = 7.5; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve storeAtEnd double: " + c792());
function c793(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[a.length] = "t"; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve storeAtEnd text: " + c793());
function c794(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[a.length] = undefined; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve storeAtEnd undefined: " + c794());
function c795(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.with(0, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve with double: " + c795());
function c796(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.with(0, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve with text: " + c796());
function c797(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.with(0, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve with undefined: " + c797());
function c798(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.concat([7.5]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve concat double: " + c798());
function c799(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.concat(["t"]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve concat text: " + c799());
function c800(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.concat([undefined]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve concat undefined: " + c800());
function c801(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.toSpliced(0, 0, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve toSpliced double: " + c801());
function c802(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.toSpliced(0, 0, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve toSpliced text: " + c802());
function c803(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.toSpliced(0, 0, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve toSpliced undefined: " + c803());
function c804(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push(7.5); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve pushMany double: " + c804());
function c805(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift(7.5); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve unshiftMany double: " + c805());
function c806(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push("t"); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve pushMany text: " + c806());
function c807(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift("t"); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve unshiftMany text: " + c807());
function c808(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push(undefined); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve pushMany undefined: " + c808());
function c809(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift(undefined); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve unshiftMany undefined: " + c809());
function c810(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve pop: " + c810());
function c811(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.shift(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve shift: " + c811());
function c812(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.reverse(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve reverse: " + c812());
function c813(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve sort: " + c813());
function c814(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.copyWithin(0, 1); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve copyWithin: " + c814());
function c815(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(0, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve spliceOut: " + c815());
function c816(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.length = 0; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve lengthZero: " + c816());
function c817(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve slice: " + c817());
function c818(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.map((x: unknown) => x); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve map: " + c818());
function c819(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.filter(() => true); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve filter: " + c819());
function c820(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.flat(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve flat: " + c820());
function c821(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.join(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve join: " + c821());
function c822(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.includes(3); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve includes: " + c822());
function c823(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.indexOf(3); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve indexOf: " + c823());
function c824(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.at(0); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve at: " + c824());
function c825(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = [...a]; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve spread: " + c825());
function c826(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = [...a.entries()]; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve entries: " + c826());
function c827(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one push double: " + c827());
function c828(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one push text: " + c828());
function c829(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one push undefined: " + c829());
function c830(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push(7.5, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one pushTwo double: " + c830());
function c831(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push("t", "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one pushTwo text: " + c831());
function c832(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push(undefined, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one pushTwo undefined: " + c832());
function c833(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.unshift(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one unshift double: " + c833());
function c834(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.unshift("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one unshift text: " + c834());
function c835(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.unshift(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one unshift undefined: " + c835());
function c836(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(1, 0, 7.5, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one spliceIn double: " + c836());
function c837(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(1, 0, "t", "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one spliceIn text: " + c837());
function c838(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(1, 0, undefined, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one spliceIn undefined: " + c838());
function c839(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(0, 1, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one spliceOver double: " + c839());
function c840(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(0, 1, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one spliceOver text: " + c840());
function c841(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(0, 1, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one spliceOver undefined: " + c841());
function c842(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one fill double: " + c842());
function c843(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one fill text: " + c843());
function c844(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one fill undefined: " + c844());
function c845(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill(7.5, 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one fillPart double: " + c845());
function c846(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill("t", 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one fillPart text: " + c846());
function c847(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill(undefined, 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one fillPart undefined: " + c847());
function c848(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[1] = 7.5; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one store double: " + c848());
function c849(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[1] = "t"; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one store text: " + c849());
function c850(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[1] = undefined; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one store undefined: " + c850());
function c851(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[a.length] = 7.5; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one storeAtEnd double: " + c851());
function c852(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[a.length] = "t"; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one storeAtEnd text: " + c852());
function c853(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[a.length] = undefined; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one storeAtEnd undefined: " + c853());
function c854(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.with(0, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one with double: " + c854());
function c855(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.with(0, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one with text: " + c855());
function c856(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.with(0, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one with undefined: " + c856());
function c857(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.concat([7.5]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one concat double: " + c857());
function c858(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.concat(["t"]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one concat text: " + c858());
function c859(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.concat([undefined]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one concat undefined: " + c859());
function c860(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.toSpliced(0, 0, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one toSpliced double: " + c860());
function c861(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.toSpliced(0, 0, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one toSpliced text: " + c861());
function c862(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.toSpliced(0, 0, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one toSpliced undefined: " + c862());
function c863(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push(7.5); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("long one pushMany double: " + c863());
function c864(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift(7.5); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("long one unshiftMany double: " + c864());
function c865(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push("t"); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("long one pushMany text: " + c865());
function c866(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift("t"); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("long one unshiftMany text: " + c866());
function c867(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push(undefined); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("long one pushMany undefined: " + c867());
function c868(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift(undefined); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("long one unshiftMany undefined: " + c868());
function c869(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one pop: " + c869());
function c870(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.shift(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one shift: " + c870());
function c871(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.reverse(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one reverse: " + c871());
function c872(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one sort: " + c872());
function c873(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.copyWithin(0, 1); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one copyWithin: " + c873());
function c874(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(0, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one spliceOut: " + c874());
function c875(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.length = 0; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one lengthZero: " + c875());
function c876(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one slice: " + c876());
function c877(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.map((x: unknown) => x); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one map: " + c877());
function c878(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.filter(() => true); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one filter: " + c878());
function c879(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.flat(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one flat: " + c879());
function c880(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.join(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one join: " + c880());
function c881(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.includes(3); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one includes: " + c881());
function c882(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.indexOf(3); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one indexOf: " + c882());
function c883(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.at(0); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one at: " + c883());
function c884(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = [...a]; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one spread: " + c884());
function c885(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = [...a.entries()]; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one entries: " + c885());
function c886(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve push double: " + c886());
function c887(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve push text: " + c887());
function c888(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve push undefined: " + c888());
function c889(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push(7.5, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve pushTwo double: " + c889());
function c890(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push("t", "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve pushTwo text: " + c890());
function c891(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push(undefined, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve pushTwo undefined: " + c891());
function c892(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.unshift(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve unshift double: " + c892());
function c893(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.unshift("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve unshift text: " + c893());
function c894(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.unshift(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve unshift undefined: " + c894());
function c895(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(1, 0, 7.5, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve spliceIn double: " + c895());
function c896(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(1, 0, "t", "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve spliceIn text: " + c896());
function c897(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(1, 0, undefined, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve spliceIn undefined: " + c897());
function c898(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(0, 1, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve spliceOver double: " + c898());
function c899(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(0, 1, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve spliceOver text: " + c899());
function c900(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(0, 1, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve spliceOver undefined: " + c900());
function c901(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve fill double: " + c901());
function c902(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve fill text: " + c902());
function c903(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve fill undefined: " + c903());
function c904(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill(7.5, 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve fillPart double: " + c904());
function c905(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill("t", 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve fillPart text: " + c905());
function c906(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill(undefined, 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve fillPart undefined: " + c906());
function c907(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[1] = 7.5; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve store double: " + c907());
function c908(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[1] = "t"; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve store text: " + c908());
function c909(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[1] = undefined; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve store undefined: " + c909());
function c910(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[a.length] = 7.5; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve storeAtEnd double: " + c910());
function c911(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[a.length] = "t"; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve storeAtEnd text: " + c911());
function c912(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[a.length] = undefined; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve storeAtEnd undefined: " + c912());
function c913(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.with(0, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve with double: " + c913());
function c914(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.with(0, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve with text: " + c914());
function c915(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.with(0, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve with undefined: " + c915());
function c916(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.concat([7.5]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve concat double: " + c916());
function c917(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.concat(["t"]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve concat text: " + c917());
function c918(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.concat([undefined]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve concat undefined: " + c918());
function c919(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.toSpliced(0, 0, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve toSpliced double: " + c919());
function c920(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.toSpliced(0, 0, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve toSpliced text: " + c920());
function c921(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.toSpliced(0, 0, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve toSpliced undefined: " + c921());
function c922(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push(7.5); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("long twelve pushMany double: " + c922());
function c923(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift(7.5); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("long twelve unshiftMany double: " + c923());
function c924(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push("t"); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("long twelve pushMany text: " + c924());
function c925(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift("t"); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("long twelve unshiftMany text: " + c925());
function c926(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push(undefined); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("long twelve pushMany undefined: " + c926());
function c927(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift(undefined); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("long twelve unshiftMany undefined: " + c927());
function c928(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve pop: " + c928());
function c929(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.shift(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve shift: " + c929());
function c930(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.reverse(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve reverse: " + c930());
function c931(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve sort: " + c931());
function c932(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.copyWithin(0, 1); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve copyWithin: " + c932());
function c933(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(0, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve spliceOut: " + c933());
function c934(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.length = 0; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve lengthZero: " + c934());
function c935(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve slice: " + c935());
function c936(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.map((x: unknown) => x); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve map: " + c936());
function c937(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.filter(() => true); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve filter: " + c937());
function c938(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.flat(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve flat: " + c938());
function c939(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.join(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve join: " + c939());
function c940(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.includes(3); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve includes: " + c940());
function c941(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.indexOf(3); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve indexOf: " + c941());
function c942(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.at(0); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve at: " + c942());
function c943(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = [...a]; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve spread: " + c943());
function c944(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = [...a.entries()]; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve entries: " + c944());
function c945(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one push double: " + c945());
function c946(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one push text: " + c946());
function c947(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one push undefined: " + c947());
function c948(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push(7.5, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one pushTwo double: " + c948());
function c949(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push("t", "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one pushTwo text: " + c949());
function c950(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.push(undefined, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one pushTwo undefined: " + c950());
function c951(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.unshift(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one unshift double: " + c951());
function c952(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.unshift("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one unshift text: " + c952());
function c953(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.unshift(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one unshift undefined: " + c953());
function c954(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(1, 0, 7.5, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one spliceIn double: " + c954());
function c955(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(1, 0, "t", "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one spliceIn text: " + c955());
function c956(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(1, 0, undefined, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one spliceIn undefined: " + c956());
function c957(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(0, 1, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one spliceOver double: " + c957());
function c958(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(0, 1, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one spliceOver text: " + c958());
function c959(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(0, 1, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one spliceOver undefined: " + c959());
function c960(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one fill double: " + c960());
function c961(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one fill text: " + c961());
function c962(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one fill undefined: " + c962());
function c963(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill(7.5, 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one fillPart double: " + c963());
function c964(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill("t", 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one fillPart text: " + c964());
function c965(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.fill(undefined, 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one fillPart undefined: " + c965());
function c966(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[1] = 7.5; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one store double: " + c966());
function c967(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[1] = "t"; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one store text: " + c967());
function c968(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[1] = undefined; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one store undefined: " + c968());
function c969(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[a.length] = 7.5; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one storeAtEnd double: " + c969());
function c970(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[a.length] = "t"; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one storeAtEnd text: " + c970());
function c971(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a[a.length] = undefined; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one storeAtEnd undefined: " + c971());
function c972(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.with(0, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one with double: " + c972());
function c973(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.with(0, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one with text: " + c973());
function c974(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.with(0, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one with undefined: " + c974());
function c975(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.concat([7.5]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one concat double: " + c975());
function c976(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.concat(["t"]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one concat text: " + c976());
function c977(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.concat([undefined]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one concat undefined: " + c977());
function c978(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.toSpliced(0, 0, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one toSpliced double: " + c978());
function c979(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.toSpliced(0, 0, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one toSpliced text: " + c979());
function c980(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.toSpliced(0, 0, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one toSpliced undefined: " + c980());
function c981(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push(7.5); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("withLength one pushMany double: " + c981());
function c982(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift(7.5); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("withLength one unshiftMany double: " + c982());
function c983(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push("t"); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("withLength one pushMany text: " + c983());
function c984(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift("t"); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("withLength one unshiftMany text: " + c984());
function c985(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push(undefined); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("withLength one pushMany undefined: " + c985());
function c986(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift(undefined); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("withLength one unshiftMany undefined: " + c986());
function c987(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one pop: " + c987());
function c988(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.shift(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one shift: " + c988());
function c989(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.reverse(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one reverse: " + c989());
function c990(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one sort: " + c990());
function c991(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.copyWithin(0, 1); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one copyWithin: " + c991());
function c992(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.splice(0, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one spliceOut: " + c992());
function c993(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.length = 0; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one lengthZero: " + c993());
function c994(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one slice: " + c994());
function c995(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.map((x: unknown) => x); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one map: " + c995());
function c996(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.filter(() => true); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one filter: " + c996());
function c997(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.flat(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one flat: " + c997());
function c998(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.join(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one join: " + c998());
function c999(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.includes(3); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one includes: " + c999());
function c1000(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.indexOf(3); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one indexOf: " + c1000());
function c1001(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a.at(0); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one at: " + c1001());
function c1002(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = [...a]; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one spread: " + c1002());
function c1003(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = [...a.entries()]; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one entries: " + c1003());
function c1004(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve push double: " + c1004());
function c1005(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve push text: " + c1005());
function c1006(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve push undefined: " + c1006());
function c1007(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push(7.5, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve pushTwo double: " + c1007());
function c1008(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push("t", "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve pushTwo text: " + c1008());
function c1009(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.push(undefined, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve pushTwo undefined: " + c1009());
function c1010(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.unshift(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve unshift double: " + c1010());
function c1011(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.unshift("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve unshift text: " + c1011());
function c1012(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.unshift(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve unshift undefined: " + c1012());
function c1013(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(1, 0, 7.5, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve spliceIn double: " + c1013());
function c1014(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(1, 0, "t", "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve spliceIn text: " + c1014());
function c1015(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(1, 0, undefined, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve spliceIn undefined: " + c1015());
function c1016(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(0, 1, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve spliceOver double: " + c1016());
function c1017(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(0, 1, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve spliceOver text: " + c1017());
function c1018(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(0, 1, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve spliceOver undefined: " + c1018());
function c1019(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill(7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve fill double: " + c1019());
function c1020(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill("t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve fill text: " + c1020());
function c1021(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill(undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve fill undefined: " + c1021());
function c1022(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill(7.5, 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve fillPart double: " + c1022());
function c1023(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill("t", 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve fillPart text: " + c1023());
function c1024(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.fill(undefined, 1, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve fillPart undefined: " + c1024());
function c1025(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[1] = 7.5; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve store double: " + c1025());
function c1026(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[1] = "t"; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve store text: " + c1026());
function c1027(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[1] = undefined; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve store undefined: " + c1027());
function c1028(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[a.length] = 7.5; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve storeAtEnd double: " + c1028());
function c1029(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[a.length] = "t"; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve storeAtEnd text: " + c1029());
function c1030(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a[a.length] = undefined; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve storeAtEnd undefined: " + c1030());
function c1031(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.with(0, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve with double: " + c1031());
function c1032(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.with(0, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve with text: " + c1032());
function c1033(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.with(0, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve with undefined: " + c1033());
function c1034(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.concat([7.5]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve concat double: " + c1034());
function c1035(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.concat(["t"]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve concat text: " + c1035());
function c1036(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.concat([undefined]); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve concat undefined: " + c1036());
function c1037(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.toSpliced(0, 0, 7.5); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve toSpliced double: " + c1037());
function c1038(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.toSpliced(0, 0, "t"); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve toSpliced text: " + c1038());
function c1039(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.toSpliced(0, 0, undefined); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve toSpliced undefined: " + c1039());
function c1040(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push(7.5); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("withLength twelve pushMany double: " + c1040());
function c1041(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift(7.5); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("withLength twelve unshiftMany double: " + c1041());
function c1042(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push("t"); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("withLength twelve pushMany text: " + c1042());
function c1043(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift("t"); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("withLength twelve unshiftMany text: " + c1043());
function c1044(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.push(undefined); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("withLength twelve pushMany undefined: " + c1044());
function c1045(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.unshift(undefined); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("withLength twelve unshiftMany undefined: " + c1045());
function c1046(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve pop: " + c1046());
function c1047(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.shift(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve shift: " + c1047());
function c1048(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.reverse(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve reverse: " + c1048());
function c1049(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve sort: " + c1049());
function c1050(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.copyWithin(0, 1); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve copyWithin: " + c1050());
function c1051(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.splice(0, 2); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve spliceOut: " + c1051());
function c1052(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.length = 0; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve lengthZero: " + c1052());
function c1053(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve slice: " + c1053());
function c1054(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.map((x: unknown) => x); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve map: " + c1054());
function c1055(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.filter(() => true); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve filter: " + c1055());
function c1056(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.flat(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve flat: " + c1056());
function c1057(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.join(); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve join: " + c1057());
function c1058(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.includes(3); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve includes: " + c1058());
function c1059(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.indexOf(3); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve indexOf: " + c1059());
function c1060(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a.at(0); } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve at: " + c1060());
function c1061(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = [...a]; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve spread: " + c1061());
function c1062(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = [...a.entries()]; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve entries: " + c1062());
console.log(lines.join("\n"));
