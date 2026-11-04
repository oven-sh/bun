// RUN: lower
// OPTIONS: builtin-modules

// s.replace(/a/g, "..").replace(/b/g, "..") ..: chains of global patterns of one character with constant replacements. Which chains may be done in one pass over the string and which may not; each is checked against the same steps done one at a time through variables that are used twice, and against what RegExp's legacy static properties say afterwards.
const report: string[] = [];
let wrong = 0;
const legacy = RegExp as unknown as Record<string, string>;
function left(): string {
  return JSON.stringify([legacy.lastMatch, legacy.input, legacy.leftContext, legacy.rightContext, legacy["$&"], legacy.$1]);
}
function reset(): void {
  /^mark$/.test("mark");
}

function forShell(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/ /g, "\\ ").replace(/\t/g, "\\t");
}
function forShellStepByStep(text: string): string {
  const one = text.replace(/\\/g, "\\\\");
  const two = one.replace(/'/g, "\\'");
  const three = two.replace(/ /g, "\\ ");
  return [one, two, three].length === 3 ? three.replace(/\t/g, "\\t") : one;
}
function toPath(text: string): string {
  return text.replace(/\./g, "/").replace(/\$/g, "_inner_");
}
function toPathStepByStep(text: string): string {
  const one = text.replace(/\./g, "/");
  return one.length >= 0 ? one.replace(/\$/g, "_inner_") : one;
}
function squash(text: string): string {
  return text.replace(/,/g, "").replace(/;/g, " ").replace(/ /g, "");
}
function eachFeedsTheNext(text: string): string {
  return text.replace(/p/g, "q").replace(/q/g, "r").replace(/r/g, "p");
}
function withReferences(text: string): string {
  return text.replace(/u/g, "<$&>").replace(/v/g, "$$").replace(/w/g, "W");
}
function withOtherPatterns(text: string): string {
  return text.replace(/k/gi, "1").replace(/l/, "2").replace(/m/g, "3").replace(/n/g, "4").replace(/oo/g, "5").replace(/[st]/g, "6");
}
function sameCharacterTwice(text: string): string {
  return text.replace(/e/g, "E").replace(/e/g, "never").replace(/z/g, "e");
}
function middleIsKept(text: string): string {
  const middle = text.replace(/\+/g, " plus ");
  return middle.replace(/-/g, " minus ") + "|" + middle.length;
}
function tenSteps(text: string): string {
  return text.replace(/a/g, "0").replace(/b/g, "1").replace(/c/g, "2").replace(/d/g, "3").replace(/e/g, "4").replace(/f/g, "5").replace(/g/g, "6").replace(/h/g, "7").replace(/i/g, "8").replace(/j/g, "9");
}

const texts: string[] = ["", "nothing to do", "\\", "'", " ", "\t", "it's a 'test'\tof\\paths", "   ", "\\\\''", "na\u00efve caf\u00e9 's", "\u4e2d\u6587 it's", "end\\", "'start", "m".repeat(90) + "'" + "n".repeat(90) + " "];
for (let i = 0; i < 5; i++) texts.push(texts[i + 5]! + "/" + texts[(i * 3) % 7]! + texts[6]!.slice(i, i + 9));
for (let turn = 0; turn < 3; turn++)
  for (const text of texts) {
    reset();
    const fused = forShell(text);
    const after = left();
    reset();
    if (fused !== forShellStepByStep(text) || after !== left()) wrong++;
    reset();
    const path = toPath(text + ".a$b.");
    const afterPath = left();
    reset();
    if (path !== toPathStepByStep(text + ".a$b.") || afterPath !== left()) wrong++;
    if (turn === 2 && text.length < 24) report.push(JSON.stringify(fused) + " " + after);
  }
for (const text of ["a,b;c d,,e", "pqr rqp", "uvw wvu", "KkLlMmNnoo sstt klmn", "eze zez", "1+2-3+4", "abcdefghij jihgfedcba k"]) {
  reset();
  report.push([squash(text), eachFeedsTheNext(text), withReferences(text), withOtherPatterns(text), sameCharacterTwice(text), middleIsKept(text), tenSteps(text)].join(" | ") + " " + left());
}
for (const absent of [undefined, null] as unknown as string[]) {
  try {
    report.push(forShell(absent));
  } catch (problem) {
    report.push((problem as Error).name);
  }
}
report.push("wrong " + wrong);
console.log(report.join("\n"));

// GENERATED: left reset toPath toPathStepByStep
// CHECK-LABEL: function {{*}}name="left"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Builtin builtin=JSON
// CHECK-NEXT: v1 = PropGet v0 key="stringify"
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="legacy"
// CHECK-NEXT: v5 = PropGet v4 key="lastMatch"
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v7 = CheckInitialized v6 name="legacy"
// CHECK-NEXT: v8 = PropGet v7 key="input"
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v10 = CheckInitialized v9 name="legacy"
// CHECK-NEXT: v11 = PropGet v10 key="leftContext"
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v13 = CheckInitialized v12 name="legacy"
// CHECK-NEXT: v14 = PropGet v13 key="rightContext"
// CHECK-NEXT: v15 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v16 = CheckInitialized v15 name="legacy"
// CHECK-NEXT: v17 = PropGet v16 key="$&"
// CHECK-NEXT: v18 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v19 = CheckInitialized v18 name="legacy"
// CHECK-NEXT: v20 = PropGet v19 key="$1"
// CHECK-NEXT: v21 = NewArray v5, v8, v11, v14, v17, v20 contents=anything
// CHECK-NEXT: v22 = Call v2, v0, v21 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: ReturnCall v22 casts=[{declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="reset"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewRegExp pattern="^mark$"
// CHECK-NEXT: v1 = PropGet v0 key="test"
// CHECK-NEXT: v2 = String string="mark"
// CHECK-NEXT: v3 = Call v1, v0, v2 calleeKey="test" calleeName="test"
// CHECK-NEXT: v4 = Convert v3 declared={type=boolean} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="toPath"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: v1 = PropGet v0 key="replace"
// CHECK-NEXT: v2 = NewRegExp pattern="\\." regExpFlags=[Global]
// CHECK-NEXT: v3 = String string="/"
// CHECK-NEXT: v4 = Call v1, v0, v2, v3 calleeKey="replace" calleeName="text.replace"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v6 = PropGet v5 key="replace"
// CHECK-NEXT: v7 = NewRegExp pattern="\\$" regExpFlags=[Global]
// CHECK-NEXT: v8 = String string="_inner_"
// CHECK-NEXT: v9 = Call v6, v5, v7, v8 calleeKey="replace" calleeName="replace"
// CHECK-NEXT: ReturnCall v9 casts=[{declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="toPathStepByStep"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: v1 = PropGet v0 key="replace"
// CHECK-NEXT: v2 = NewRegExp pattern="\\." regExpFlags=[Global]
// CHECK-NEXT: v3 = String string="/"
// CHECK-NEXT: v4 = Call v1, v0, v2, v3 calleeKey="replace" calleeName="text.replace"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v6 = PropGet v5 key="length"
// CHECK-NEXT: v7 = Integer
// CHECK-NEXT: v8 = GreaterEq v6, v7
// CHECK-NEXT: Branch v8 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v9 = PropGet v5 key="replace"
// CHECK-NEXT: v10 = NewRegExp pattern="\\$" regExpFlags=[Global]
// CHECK-NEXT: v11 = String string="_inner_"
// CHECK-NEXT: v12 = Call v9, v5, v10, v11 calleeKey="replace" calleeName="one.replace"
// CHECK-NEXT: ReturnCall v12 casts=[{declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: b2():
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
