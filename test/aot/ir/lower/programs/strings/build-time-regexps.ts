// RUN: lower
// OPTIONS: builtin-modules

// Regular expressions that are not literals but are still known at build time, built the way the packages ansi-regex and wrap-ansi build them.
// KNOWN regexp2 (?:(?:\u001B\]|\u009D)[^\u0007\u001B\u009C\u009D]*(?:\u0007|\u001B\u005C|\u009C))|[\u001B\u009B][[\]()#;?]*(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]
// KNOWN regexp2 cho+sen
// PARTLY regexp2 unkno+wnflags
// KNOWN fold1 lo+ng0123456789012345678901234567890123456789012345678901234567890123456789|sho+rt
// KNOWN fold1 (?:a\[|b)(?:(?<sgr>[0-9;:]*)m|[0-?]*[ -/]*[@-~])|a\](?:8;(?<parameters>[^;\u0000-\u001F\u007F-\u009F]*);(?<uri>[^\u0000-\u001F\u007F-\u009F]*)(?:c|a\\)|[^\u0000-\u001F\u007F-\u009F]*(?:c|a\\))
// KNOWN fold1 ra+w\d1\n
// KNOWN fold1 nu+mber12-0.5
// KNOWN fold1 assi+gned
// KNOWN fold1 fromca+ll
// KNOWN fold1 [ab]joi+ned
// KNOWN fold1 obje+ct7
declare const console: { log(...values: unknown[]): void };
function make(text: string): string { return Array.from(text).join(""); }
function ansiRegex({ onlyFirst = false } = {}): RegExp {
    const ST = "(?:\\u0007|\\u001B\\u005C|\\u009C)";
    const osc = `(?:(?:\\u001B\\]|\\u009D)[^\\u0007\\u001B\\u009C\\u009D]*${ST})`;
    const csi = "[\\u001B\\u009B][[\\]()#;?]*(?:\\d{1,4}(?:[;:]\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]";
    const pattern = `${osc}|${csi}`;
    return new RegExp(pattern, onlyFirst ? undefined : "g");
}
function chosen(kind: number): RegExp { return new RegExp("cho+sen", kind === 0 ? "i" : kind === 1 ? "gi" : kind === 2 ? undefined : "m"); }
function withFlags(flags: string): RegExp { return new RegExp("unkno+wnflags", flags); }
const LONG = "lo+ng0123456789012345678901234567890123456789012345678901234567890123456789";
const SHORT = "sho+rt";
const long = new RegExp(`${LONG}|${SHORT}`);
const ESCAPE = "a", BELL = "c", C1 = "b", CSI = "[", OSC = "]", SGR_TERMINATOR = "m";
const CSI_INTRODUCER = `(?:${ESCAPE}\\${CSI}|${C1})`;
const CSI_PARAMETERS = "[0-?]*[ -/]*[@-~]";
const SGR_PARAMETERS = `(?<sgr>[0-9;:]*)${SGR_TERMINATOR}`;
const OSC_STRING_TERMINATOR = `(?:${BELL}|${ESCAPE}\\\\)`;
const OSC_STRING_PAYLOAD = String.raw`[^\u0000-\u001F\u007F-\u009F]*`;
const LINK_PARAMETERS = String.raw`8;(?<parameters>[^;\u0000-\u001F\u007F-\u009F]*);(?<uri>${OSC_STRING_PAYLOAD})${OSC_STRING_TERMINATOR}`;
const OSC_STRING = `${OSC_STRING_PAYLOAD}${OSC_STRING_TERMINATOR}`;
const wrapped = new RegExp(`${CSI_INTRODUCER}(?:${SGR_PARAMETERS}|${CSI_PARAMETERS})` + `|${ESCAPE}\\${OSC}(?:${LINK_PARAMETERS}|${OSC_STRING})`, "y");
const ONE = 1;
const raw = new RegExp(String.raw`ra+w\d${ONE}\n`);
const numbered = new RegExp("nu+mber" + 12 + -0.5);
let assignedText = "assi+"; for (let i = 0; i < make("x").length; i++) assignedText += "gned";
const assigned = new RegExp(assignedText);
const fromCall = new RegExp(make("fromca+ll"));
const SET = new Set(["a", "b"]);
const joined = new RegExp(`[${[...SET].join("")}]joi+ned`);
const object = { toString() { return "7"; } };
const withObject = new RegExp(`obje+ct${object}`);
const styled = make("\u001B[31mred\u001B[39m \u001B]8;;http://x\u0007link\u001B]8;;\u0007 \u009B1mb");
const out: unknown[] = [styled.replace(ansiRegex(), ""), ansiRegex({ onlyFirst: true }).exec(styled)?.index, ansiRegex().flags, ansiRegex({ onlyFirst: true }).flags];
for (let kind = 0; kind < 4; kind++) out.push(chosen(kind).flags + chosen(kind).test(make("x CHOOSEN")));
for (const flags of ["", "g", "i", "dgimsuy", "v"]) out.push(withFlags(make(flags)).flags + withFlags(make(flags)).test(make("UNKNOOWNFLAGS unknoowNflags unknoownflags")));
out.push(long.exec(make("a shoort"))?.index, long.source.length, wrapped.flags, wrapped.exec(make("a[1;2m"))?.groups?.sgr, wrapped.exec(make("a]8;k=v;http://yc"))?.groups?.uri, wrapped.exec(make("x")), raw.test(make("raaw51\n")), raw.source, numbered.test(make("nuumber12-0x5")), numbered.source);
out.push(assigned.test(make("assiigned")), fromCall.test(make("fromcaall")), joined.test(make("bjoiined")), withObject.test(make("objeect7")), CSI_INTRODUCER, LINK_PARAMETERS.length, OSC_STRING);
try { withFlags(make("gg")); out.push("no error"); } catch (e) { out.push((e as Error).name); }
console.log(out.map(String).join(" | "));

// GENERATED: make ansiRegex withFlags
// CHECK-LABEL: function {{*}}name="make"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: v1 = Builtin builtin=ArrayFrom
// CHECK-NEXT: v2 = IsPristineArray v0
// CHECK-NEXT: Branch v2 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = NewArray contents=anything
// CHECK-NEXT: AppendSpread v3, v0
// CHECK-NEXT: v5 = Convert v3 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: Jump -> next b5(v5)
// CHECK-NEXT: b2():
// CHECK-NEXT: v6 = TypeTest v0 testedType=string
// CHECK-NEXT: Branch v6 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v7):
// CHECK-NEXT: v8 = NewArray contents=anything
// CHECK-NEXT: AppendSpread v8, v7
// CHECK-NEXT: v10 = Convert v8 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: Jump -> next b5(v10)
// CHECK-NEXT: b4(v11):
// CHECK-NEXT: v12 = Builtin builtin=Array [isNotReadFromHolder]
// CHECK-NEXT: v13 = Builtin builtin=ArrayFrom [isNotReadFromHolder]
// CHECK-NEXT: v14 = Call v13, v12, v11
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: Jump -> next b5(v15)
// CHECK-NEXT: b5(v16):
// CHECK-NEXT: v17 = PropGet v16 key="join"
// CHECK-NEXT: v18 = String string=""
// CHECK-NEXT: v19 = Call v17, v16, v18 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v19 casts=[{declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="ansiRegex"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_1]] flags=[IsExpected]}] results=[{type=undefined|null|RegExp flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_1]]):
// CHECK-NEXT: v1 = TypeTest v0 testedType=undefined
// CHECK-NEXT: Branch v1 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: v3 = Data data=[[d_2]]
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|number|string|symbol|bigint|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b3(v4)
// CHECK-NEXT: b2(v5):
// CHECK-NEXT: Jump -> next b3(v5)
// CHECK-NEXT: b3(v6):
// CHECK-NEXT: v7 = TypeTest v6 testedType=undefined|null
// CHECK-NEXT: Branch v7 -> taken b4(| 0), notTaken b5(| 0)
// CHECK-NEXT: b4(v8):
// CHECK-NEXT: v9 = NewRuntimeError runtimeError=NotDestructurable name="onlyFirst"
// CHECK-NEXT: Throw v9
// CHECK-NEXT: b5(v10):
// CHECK-NEXT: v11 = PropGet v10 key="onlyFirst"
// CHECK-NEXT: v12 = TypeTest v11 testedType=undefined
// CHECK-NEXT: Branch v12 -> taken b6(| 0), notTaken b7(| 0)
// CHECK-NEXT: b6(v13):
// CHECK-NEXT: v14 = Boolean
// CHECK-NEXT: Jump -> next b8(v14)
// CHECK-NEXT: b7(v15):
// CHECK-NEXT: Jump -> next b8(v15)
// CHECK-NEXT: b8(v16):
// CHECK-NEXT: v17 = String string="(?:\\u0007|\\u001B\\u005C|\\u009C)"
// CHECK-NEXT: v18 = String string="(?:(?:\\u001B\\]|\\u009D)[^\\u0007\\u001B\\u009C\\u009D]*"
// CHECK-NEXT: v19 = ToString v17
// CHECK-NEXT: v20 = String string=")"
// CHECK-NEXT: v21 = Strcat v18, v19, v20
// CHECK-NEXT: v22 = String string="(?:(?:\\u001B\\]|\\u009D)[^\\u0007\\u001B\\u009C\\u009D]*(?:\\u0007|\\u001B\\u005C|\\u009C))"
// CHECK-NEXT: v23 = String string="[\\u001B\\u009B]{{*}}[\\]()#;?]*(?:\\d{1,4}(?:[;:]\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]"
// CHECK-NEXT: v24 = ToString v22
// CHECK-NEXT: v25 = String string="|"
// CHECK-NEXT: v26 = ToString v23
// CHECK-NEXT: v27 = Strcat v24, v25, v26
// CHECK-NEXT: v28 = String string="(?:(?:\\u001B\\]|\\u009D)[^\\u0007\\u001B\\u009C\\u009D]*(?:\\u0007|\\u001B\\u005C|\\u009C))|[\\u001B\\u009B]{{*}}[\\]()#;?]*(?:\\d{1,4}(?:[;:]\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]"
// CHECK-NEXT: v29 = Builtin builtin=RegExp
// CHECK-NEXT: v30 = ToBoolean v16
// CHECK-NEXT: Branch v30 -> taken b9(| 0), notTaken b10(| 0)
// CHECK-NEXT: b9(v31):
// CHECK-NEXT: v32 = Undefined
// CHECK-NEXT: Jump -> next b11(v32)
// CHECK-NEXT: b10(v33):
// CHECK-NEXT: v34 = String string="g"
// CHECK-NEXT: Jump -> next b11(v34)
// CHECK-NEXT: b11(v35):
// CHECK-NEXT: v36 = Construct v29, -, v28, v35 calleeName="RegExp"
// CHECK-NEXT: v37 = Convert v36 declared={type=undefined|null|RegExp flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Return v37
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="withFlags"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|RegExp flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: v1 = Builtin builtin=RegExp
// CHECK-NEXT: v2 = String string="unkno+wnflags"
// CHECK-NEXT: v3 = Construct v1, -, v2, v0 calleeName="RegExp"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|RegExp flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
