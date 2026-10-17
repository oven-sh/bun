// Objects filled and emptied by computed keys: property order, enumeration and attributes after many deletes.
const out: string[] = [];
function say(what: string, ...parts: unknown[]): void { out.push(what + ": " + parts.join(" ")); }

function slidingWindow(count: number, width: number): string {
    const o: Record<string, number> = {};
    let sum = 0;
    for (let i = 0; i < count; i++) {
        o["k" + i] = i;
        if (i >= width) delete o["k" + (i - width)];
    }
    for (const k in o) sum += o[k]!;
    return sum + " " + Object.keys(o).length + " " + Object.keys(o)[0] + " " + Object.keys(o)[width - 1];
}
say("sliding window", slidingWindow(5000, 100), slidingWindow(300, 3), slidingWindow(40, 39));

{
    const o: Record<string, number> = {};
    for (let i = 0; i < 12; i++) o["p" + i] = i;
    for (let i = 0; i < 12; i += 2) delete o["p" + i];
    for (let i = 0; i < 12; i += 4) o["p" + i] = 100 + i;
    say("deleted keys come back at the end", Object.keys(o).join(","), JSON.stringify(o));
    say("absent keys", delete o["nothing" + o.p1], "p2" in o, o["p" + 2], Object.keys(o).length);
    o[7] = 7; o["3"] = 3; delete o["p" + 1];
    say("indices stay first", Object.keys(o).join(","));
    delete o[7];
    say("index deleted", Object.keys(o).join(","), Object.entries(o).length);
}
{
    const o: Record<string, unknown> = {};
    for (let i = 0; i < 20; i++) o["a" + i] = i;
    Object.defineProperty(o, "fixed", { value: 1, configurable: false, enumerable: true, writable: true });
    Object.defineProperty(o, "hidden", { value: 2, configurable: true, enumerable: false });
    Object.defineProperty(o, "computed", { get() { return Object.keys(this).length; }, configurable: true, enumerable: true });
    let thrown = "";
    try { delete o["fix" + "ed".slice(0)]; } catch (e) { thrown = (e as Error).constructor.name; }
    say("not configurable", thrown, "fixed" in o);
    const names = ["a3", "hidden", "a19", "computed", "a0"];
    for (const name of names) delete o[name];
    say("after mixed deletes", Object.getOwnPropertyNames(o).join(","), o.computed, o.hidden);
    const tag = Symbol("tag");
    (o as Record<symbol, unknown>)[tag] = "s";
    say("symbol", Object.getOwnPropertySymbols(o).length, delete (o as Record<symbol, unknown>)[tag], Object.getOwnPropertySymbols(o).length);
}
{
    const frozen: Record<string, number> = {};
    for (let i = 0; i < 10; i++) frozen["f" + i] = i;
    delete frozen["f" + 4];
    Object.freeze(frozen);
    let thrown = "";
    try { delete frozen["f" + 5]; } catch (e) { thrown = (e as Error).constructor.name; }
    say("frozen", thrown, Object.keys(frozen).join(","), Object.isFrozen(frozen));
}
{
    const base: Record<string, number> = {};
    for (let i = 0; i < 10; i++) base["b" + i] = i;
    const derived: Record<string, number> = Object.create(base);
    for (let i = 5; i < 15; i++) derived["b" + i] = 100 + i;
    for (let i = 0; i < 15; i += 3) delete derived["b" + i];
    for (let i = 0; i < 10; i += 4) delete base["b" + i];
    const seen: string[] = [];
    for (const k in derived) seen.push(k + "=" + derived[k]);
    say("through a prototype", seen.join(","));
}
{
    const counts: Record<string, number> = {};
    let live = 0, checksum = 0, seed = 7;
    for (let round = 0; round < 20000; round++) {
        seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
        const key = "id" + (seed % 257);
        if (key in counts) { checksum = (checksum * 31 + counts[key]!) | 0; delete counts[key]; live--; } else { counts[key] = round; live++; }
    }
    say("random churn", live, Object.keys(counts).length, checksum, Object.keys(counts).slice(0, 4).join(","));
}
{
    const copies: Record<string, number>[] = [];
    for (let n = 0; n < 50; n++) {
        const o: Record<string, number> = {};
        for (let i = 0; i < n; i++) o["x" + i] = i;
        for (let i = 0; i < n; i += 2) delete o["x" + i];
        copies.push({ ...o });
    }
    say("spread after deletes", copies.map(c => Object.keys(c).length).join(","), JSON.stringify(copies[9]));
    const untyped: any = {};
    for (let i = 0; i < 30; i++) untyped["u" + i] = i;
    for (let i = 29; i >= 0; i -= 3) delete untyped["u" + i];
    untyped.u29 = "again";
    say("untyped", Object.keys(untyped).length, untyped.u29, untyped.u28, Object.keys(untyped).pop());
}
console.log(out.join("\n"));
