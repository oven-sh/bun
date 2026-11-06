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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Array
// CHECK-NEXT: v2 = Builtin builtin=ArrayFrom
// CHECK-NEXT: v3 = Call v2, v1, v0 calleeName="Array.from"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array<undefined|null|string> site=[[w_3]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = PropGet v4 key="join"
// CHECK-NEXT: v6 = String string=""
// CHECK-NEXT: v7 = Call v5, v4, v6 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v7 casts=[{declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="ansiRegex"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_4]] flags=[IsExpected]}] results=[{type=undefined|null|RegExp site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_4]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeTest v0 testedType=undefined
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v3 = Data data=[[d_6]]
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|number|string|symbol|bigint|[[L_4]] flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b5(v4)
// CHECK-NEXT: b4(v5):
// CHECK-NEXT: Jump -> next b5(v5)
// CHECK-NEXT: b5(v6):
// CHECK-NEXT: v7 = TypeTest v6 testedType=undefined|null
// CHECK-NEXT: Branch v7 -> taken b6(| 0), notTaken b8(| 0)
// CHECK-NEXT: b6(v8):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7() frequency=Unlikely:
// CHECK-NEXT: v9 = NewRuntimeError runtimeError=NotDestructurable name="onlyFirst"
// CHECK-NEXT: Throw v9
// CHECK-NEXT: b8(v10):
// CHECK-NEXT: v11 = PropGet v10 key="onlyFirst"
// CHECK-NEXT: v12 = TypeTest v11 testedType=undefined
// CHECK-NEXT: Branch v12 -> taken b9(| 0), notTaken b11(| 0)
// CHECK-NEXT: b9(v13):
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v14 = Boolean
// CHECK-NEXT: Jump -> next b12(v14)
// CHECK-NEXT: b11(v15):
// CHECK-NEXT: Jump -> next b12(v15)
// CHECK-NEXT: b12(v16):
// CHECK-NEXT: v17 = Convert v16 declared={type=boolean} illTypedCause=Assertion
// CHECK-NEXT: v18 = String string="(?:\\u0007|\\u001B\\u005C|\\u009C)"
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|"(?:\\u0007|\\u001B\\u005C|\\u009C)" site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v20 = String string="(?:(?:\\u001B\\]|\\u009D)[^\\u0007\\u001B\\u009C\\u009D]*"
// CHECK-NEXT: v21 = ToString v19
// CHECK-NEXT: v22 = String string=")"
// CHECK-NEXT: v23 = Strcat v20, v21, v22
// CHECK-NEXT: v24 = String string="(?:(?:\\u001B\\]|\\u009D)[^\\u0007\\u001B\\u009C\\u009D]*(?:\\u0007|\\u001B\\u005C|\\u009C))"
// CHECK-NEXT: v25 = Convert v24 declared={type=undefined|null|"(?:(?:\\u001B\\]|\\u009D)[^\\u0007\\u001B\\u009C\\u009D]*(?:\\u0007|\\u001B\\u005C|\\u009C))" site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v26 = String string="[\\u001B\\u009B]{{*}}[\\]()#;?]*(?:\\d{1,4}(?:[;:]\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]"
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|"[\\u001B\\u009B]{{*}}[\\]()#;?]*(?:\\d{1,4}(?:[;:]\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]" site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v28 = ToString v25
// CHECK-NEXT: v29 = String string="|"
// CHECK-NEXT: v30 = ToString v27
// CHECK-NEXT: v31 = Strcat v28, v29, v30
// CHECK-NEXT: v32 = String string="(?:(?:\\u001B\\]|\\u009D)[^\\u0007\\u001B\\u009C\\u009D]*(?:\\u0007|\\u001B\\u005C|\\u009C))|[\\u001B\\u009B]{{*}}[\\]()#;?]*(?:\\d{1,4}(?:[;:]\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]"
// CHECK-NEXT: v33 = Convert v32 declared={type=undefined|null|"(?:(?:\\u001B\\]|\\u009D)[^\\u0007\\u001B\\u009C\\u009D]*(?:\\u0007|\\u001B\\u005C|\\u009C))|[\\u001B\\u009B]{{*}}[\\]()#;?]*(?:\\d{1,4}(?:[;:]\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]" site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v34 = Builtin builtin=RegExp
// CHECK-NEXT: v35 = ToBoolean v17
// CHECK-NEXT: Branch v35 -> taken b13(| 0), notTaken b15(| 0)
// CHECK-NEXT: b13(v36):
// CHECK-NEXT: Jump -> next b14()
// CHECK-NEXT: b14():
// CHECK-NEXT: v37 = Undefined
// CHECK-NEXT: Jump -> next b17(v37)
// CHECK-NEXT: b15(v38):
// CHECK-NEXT: Jump -> next b16()
// CHECK-NEXT: b16():
// CHECK-NEXT: v39 = String string="g"
// CHECK-NEXT: Jump -> next b17(v39)
// CHECK-NEXT: b17(v40):
// CHECK-NEXT: v41 = Construct v34, -, v33, v40 calleeName="RegExp"
// CHECK-NEXT: v42 = Convert v41 declared={type=undefined|null|RegExp site=[[w_11]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Return v42
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="withFlags"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|RegExp site=[[w_13]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=RegExp
// CHECK-NEXT: v2 = String string="unkno+wnflags"
// CHECK-NEXT: v3 = Construct v1, -, v2, v0 calleeName="RegExp"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|RegExp site=[[w_14]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
