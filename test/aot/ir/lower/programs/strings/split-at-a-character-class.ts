// RUN: lower
// OPTIONS: builtin-modules

// text.split(/\s+/), /,/, /[;,]/, /[^a-z0-9]+/, /\W/ ..: a literal that is one character or one class, once or repeated: the pieces, and what RegExp's legacy static properties say afterwards, are those of plain Bun for Latin-1 and for wide texts; so are the patterns next to that form, limits, and literals that were changed.
const statics = RegExp as unknown as Record<string, string>;
function seen(): string {
  return [statics.lastMatch, statics.input, statics.leftContext, statics.rightContext].map(text => JSON.stringify(text)).join();
}
function show(name: string, pieces: string[]) {
  console.log(name, pieces.length, JSON.stringify(pieces), seen());
}
const texts: string[] = [
  "",
  " ",
  "a",
  "one two  three\tfour\nfive",
  "  leading and trailing  ",
  "a,b;c,,d;",
  ",",
  ",,",
  "no-separator-at-all",
  "café au lait, s'il vous plaît",
  "東京 大阪　名古屋 x y z﻿w v u t",
  "wide 😀 pairs \ud83d and\ude00 halves",
  "x1y22z333",
  "A-B_C.D/E\\F]G[H^I",
  "tab\tcr\rlf\nff\fvt\vend",
  "UPPER lower 0123 _under",
];
function joined(first: string, second: string): string {
  return first + "|" + second;
}
for (const text of texts) {
  show("spaces", text.split(/\s+/));
  show("one space", text.split(/\s/));
  show("not spaces", text.split(/\S+/));
  show("comma", text.split(/,/));
  show("commas", text.split(/,+/));
  show("either", text.split(/[;,]/));
  show("either, repeated", text.split(/[;,]+/));
  show("digits", text.split(/\d+/));
  show("not digits", text.split(/\D+/));
  show("word", text.split(/\w/));
  show("not word", text.split(/\W+/));
  show("not in ranges", text.split(/[^a-z0-9]+/));
  show("ranges", text.split(/[A-Fx-z]/));
  show("escaped in a class", text.split(/[\]\[\\\^\-\/.]/));
  show("escaped", text.split(/\./));
  show("classes in a class", text.split(/[\s,;]+/));
  show("negated classes in a class", text.split(/[^\s\d]+/));
  show("not spaces in a class", text.split(/[\S]/));
  show("controls", text.split(/[\t\r\n\f\v]+/));
  show("a rope", joined(text, text).split(/\s+/));
  show("a slice", joined(text, text).slice(1, -1).split(/[|,]/));
}
for (const text of texts) {
  show("with a limit", text.split(/\s+/, 2));
  show("limit zero", text.split(/\s+/, 0));
  show("two terms", text.split(/,\s*/));
  show("may be empty", text.split(/\s*/));
  show("lazy", text.split(/\s+?/));
  show("counted", text.split(/\s{2}/));
  show("a group", text.split(/(\s+)/));
  show("alternatives", text.split(/,|;/));
  show("any character", text.split(/./));
  show("ignoring case", text.split(/[a-f]+/i));
  show("unicode", text.split(/\s+/u));
  show("global", text.split(/\s+/g));
  show("anchored", text.split(/^\s/));
  show("a wide character", text.split(/　/));
  show("a wide character in a class", text.split(/[　 ]+/));
  show("a range of other characters", text.split(/[ -,]+/));
  show("a dash at the end", text.split(/[a-]/));
  show("a hexadecimal escape", text.split(/\x20+/));
  show("a word boundary", text.split(/\b/));
}
function changed(text: string): string[] {
  const spaces = /\s+/;
  (spaces as unknown as { exec: unknown }).exec = () => null;
  return text.split(spaces);
}
show("exec of its own", changed("one two"));
function kept(text: string): string[] {
  const spaces = /\s+/;
  spaces.lastIndex = 3;
  const pieces = text.split(spaces);
  pieces.push(String(spaces.lastIndex));
  return pieces;
}
show("lastIndex is left alone", kept("one two three"));
let total = 0;
for (let round = 0; round < 3000; round++) {
  const words = ("round " + round + "  of\tmany é" + (round % 7 ? "" : " 東京")).split(/\s+/);
  total += words.length + words[1].length;
}
console.log("rounds", total);
const long = "word ".repeat(300_000);
console.log("long", long.split(/\s+/).length, long.split(/\s/).length);

// GENERATED: seen show joined changed
// CHECK-LABEL: function {{*}}name="seen"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="statics"
// CHECK-NEXT: v2 = PropGet v1 key="lastMatch"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="statics"
// CHECK-NEXT: v6 = PropGet v5 key="input"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull]} illTypedCause=FromLooseType
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="statics"
// CHECK-NEXT: v10 = PropGet v9 key="leftContext"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string site=[[w_5]] flags=[OmitsNull]} illTypedCause=FromLooseType
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v13 = CheckInitialized v12 name="statics"
// CHECK-NEXT: v14 = PropGet v13 key="rightContext"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|string site=[[w_6]] flags=[OmitsNull]} illTypedCause=FromLooseType
// CHECK-NEXT: v16 = NewArray v3, v7, v11, v15 contents=undefined|null|string
// CHECK-NEXT: v17 = PropGet v16 key="map"
// CHECK-NEXT: v18 = NewClosure function=[[f_7]]
// CHECK-NEXT: v19 = Call v17, v16, v18 calleeKey="map" calleeName="map"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|Array<undefined|null|string> site=[[w_8]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v21 = PropGet v20 key="join"
// CHECK-NEXT: v22 = Call v21, v20 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v22 casts=[{declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|Array<undefined|null|string> site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|Array<undefined|null|string>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = PropGet v1 key="length"
// CHECK-NEXT: v8 = Convert v7 declared={type=number site=[[w_11]]} illTypedCause=Assertion
// CHECK-NEXT: v9 = Builtin builtin=JSON
// CHECK-NEXT: v10 = PropGet v9 key="stringify"
// CHECK-NEXT: v11 = Convert v10 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v12 = Call v11, v9, v1 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|string site=[[w_12]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v14 = GetModuleVariable variable=[[g_13]]
// CHECK-NEXT: v15 = Call v14 calleeName="seen"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|string site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v17 = Call v6, v4, v0, v8, v13, v16 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="joined"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|string site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_17]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = String string="|"
// CHECK-NEXT: v3 = Add v0, v2
// CHECK-NEXT: v4 = Add v3, v1
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string site=[[w_17]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="changed"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_18]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Array<undefined|null|string> site=[[w_19]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewRegExp pattern="\\s+"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|RegExp site=[[w_20]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[L_21]] site=[[w_22]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = NewClosure function=[[f_23]]
// CHECK-NEXT: PropSet v3, v4 key="exec"
// CHECK-NEXT: v6 = PropGet v0 key="split"
// CHECK-NEXT: v7 = Call v6, v0, v2 calleeKey="split" calleeName="text.split"
// CHECK-NEXT: ReturnCall v7 casts=[{declared={type=undefined|null|Array<undefined|null|string> site=[[w_24]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|Array<undefined|null|string> site=[[w_19]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
