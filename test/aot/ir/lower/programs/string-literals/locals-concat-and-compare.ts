// RUN: lower
// OPTIONS: builtin-modules

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

// GENERATED: usedAsKey bySwitch attempt
// CHECK-LABEL: function {{*}}name="usedAsKey"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=boolean}, {type=undefined|null|object flags=[OmitsNull, OmitsUndefined]}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: boolean, v1: undefined|null|object):
// CHECK-NEXT: v2 = ToBoolean v0
// CHECK-NEXT: Branch v2 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v3):
// CHECK-NEXT: v4 = String string="write"
// CHECK-NEXT: Jump -> next b3(v4)
// CHECK-NEXT: b2(v5):
// CHECK-NEXT: v6 = String string="read"
// CHECK-NEXT: Jump -> next b3(v6)
// CHECK-NEXT: b3(v7):
// CHECK-NEXT: v8 = ElemGet v1, v7
// CHECK-NEXT: v9 = TypeTest v8 testedType=undefined|null
// CHECK-NEXT: Branch v9 -> taken b4(| 0), notTaken b5(| 0)
// CHECK-NEXT: b4(v10):
// CHECK-NEXT: v11 = Integer
// CHECK-NEXT: Jump -> next b6(v11)
// CHECK-NEXT: b5(v12):
// CHECK-NEXT: Jump -> next b6(v12)
// CHECK-NEXT: b6(v13):
// CHECK-NEXT: v14 = Integer integer=1
// CHECK-NEXT: v15 = Add v13, v14
// CHECK-NEXT: ElemSet v1, v7, v15
// CHECK-NEXT: v17 = ElemGet v1, v7
// CHECK-NEXT: v18 = Convert v17 declared={type=number}
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="bySwitch"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: v1 = Undefined
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|""|"append"|"read"|"write" flags=[OmitsNull]}
// CHECK-NEXT: Switch v0 cases=[0, 1, 2] -> case b1(| 0), case b2(| 0), case b3(), otherwise b4()
// CHECK-NEXT: b1(v3):
// CHECK-NEXT: v4 = String string="read"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|""|"append"|"read"|"write" flags=[OmitsNull]}
// CHECK-NEXT: Jump -> next b5(v5)
// CHECK-NEXT: b2(v6):
// CHECK-NEXT: v7 = String string="write"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|""|"append"|"read"|"write" flags=[OmitsNull]}
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v9 = String string="append"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|""|"append"|"read"|"write" flags=[OmitsNull]}
// CHECK-NEXT: Jump -> next b5(v10)
// CHECK-NEXT: b4():
// CHECK-NEXT: v11 = String string=""
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|""|"append"|"read"|"write" flags=[OmitsNull]}
// CHECK-NEXT: Jump -> next b5(v12)
// CHECK-NEXT: b5(v13: undefined|null|""|"append"|"read"|"write"):
// CHECK-NEXT: v14 = String string="["
// CHECK-NEXT: v15 = ToString v13
// CHECK-NEXT: v16 = String string="]"
// CHECK-NEXT: v17 = Strcat v14, v15, v16
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|number|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v1 = Call v0 calleeName="run"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|number|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v3 = CatchValue
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v5 = PropGet v4 key="constructor"
// CHECK-NEXT: v6 = PropGet v5 key="name"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|number|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
