// Local values of a union of string literals that come together from several paths: only printed, only tested, both, made from strings, in loops and around handlers. A string that is made at run time passes a cast to the union whether or not it is one of its members.
type Mode = "read" | "write" | "append" | "";
interface File { mode: Mode; name: string }
const log: string[] = [];
function onlyPrinted(a: boolean, b: boolean): string {
    const mode: Mode = a ? "read" : b ? "write" : "append";
    return "mode " + mode + "/" + mode.length;
}
function usedAsKey(writing: boolean, counts: Record<string, number>): number {
    const key = writing ? "write" : "read";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts[key];
}
function onlyTested(a: boolean, b: boolean): number {
    const mode: Mode = a ? "read" : b ? "write" : "";
    if (mode === "read") return 1;
    if (!mode) return 2;
    return mode === "write" ? 3 : 4;
}
function testedAndPrinted(n: number): string {
    const mode: Mode = n === 0 ? "read" : n === 1 ? "write" : n === 2 ? "append" : "";
    const tag = mode === "append" || mode === "write" ? "w" : mode === "" ? "-" : "r";
    return tag + mode;
}
function fromString(text: string): number {
    const mode = text as Mode;
    return mode === "read" ? 1 : mode === "write" ? 2 : mode === "" ? 3 : 0;
}
function fromStringOrConstant(text: string | undefined): string {
    const mode: Mode = text === undefined ? "append" : (text as Mode);
    return (mode === "append" ? "A" : mode === "read" ? "R" : "?") + mode;
}
function intoField(text: string, constant: boolean): File {
    const mode: Mode = constant ? "write" : (text as Mode);
    return { mode, name: "f" + mode };
}
function inLoop(steps: number): string {
    let mode: Mode = "read", trace = "";
    for (let i = 0; i < steps; i++) {
        trace += mode[0] ?? "_";
        mode = mode === "read" ? "write" : mode === "write" ? "append" : mode === "append" ? "" : "read";
    }
    return trace + ":" + mode;
}
function aroundHandlers(n: number): string {
    let mode: Mode = "read";
    try {
        if (n === 1) throw new Error("one");
        mode = "write";
        if (n === 2) throw new Error("two");
        mode = "append";
    } catch (error) {
        log.push((error as Error).message + " at " + mode);
        if (n === 2) mode = "";
    } finally {
        log.push("finally " + mode);
    }
    return mode;
}
function twoJoined(a: boolean, b: boolean): boolean {
    const x: Mode = a ? "read" : "write", y: Mode = b ? "read" : "append";
    return x === y;
}
function nullable(n: number): string {
    const mode: Mode | undefined | null = n === 0 ? undefined : n === 1 ? null : n === 2 ? "" : "read";
    return String(mode) + (mode == null ? " nil" : mode ? " set" : " empty") + (mode ?? "default");
}
function bySwitch(n: number): string {
    let mode: Mode;
    switch (n) {
        case 0: mode = "read"; break;
        case 1: mode = "write";
        case 2: mode = "append"; break;
        default: mode = "";
    }
    return `[${mode}]`;
}
function attempt(run: () => string | number): string | number {
    try { return run(); } catch (error) { return (error as Error).constructor.name; }
}
const counts: Record<string, number> = {};
const out: (string | number | boolean)[] = [];
for (const a of [true, false]) for (const b of [true, false]) out.push(onlyPrinted(a, b), usedAsKey(a, counts), onlyTested(a, b), twoJoined(a, b));
for (let n = 0; n < 4; n++) out.push(testedAndPrinted(n), aroundHandlers(n), nullable(n), bySwitch(n), inLoop(n * 3));
for (const text of ["read", "wri" + "te", "", "other", "append".slice(0, 6), "xread".slice(1)]) out.push(attempt(() => fromString(text)), attempt(() => fromStringOrConstant(text)), attempt(() => JSON.stringify(intoField(text, false))), intoField(text, true).mode);
out.push(fromStringOrConstant(undefined), JSON.stringify(counts));
console.log(out.join(" | "));
console.log(log.join(" | "));
