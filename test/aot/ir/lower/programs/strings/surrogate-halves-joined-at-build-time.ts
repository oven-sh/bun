// RUN: lower
// OPTIONS: builtin-modules

// Two constants that are the halves of a surrogate pair, joined where the build can see both: the result is the pair, the same string as the character written out, for ===, switch, property keys, Map and Set.
const smile: string = "🙂";
function join(a: string, b: string): string { return a + b; }
function template(a: string, b: string): string { return `${a}${b}`; }
function viaConcat(a: string, b: string): string { return a.concat(b); }
const parts: string[] = ["\uD83D", "\uDE42"];
console.log(join("\uD83D", "\uDE42") === smile, template("\uD83D", "\uDE42") === smile, viaConcat("\uD83D", "\uDE42") === smile, parts.join("") === smile, join(parts[0]!, parts[1]!) === smile);
console.log("\uD83D" + "\uDE42" === smile, `\uD83D${"\uDE42"}` === smile, String.raw`${"\uD83D"}${"\uDE42"}` === smile, "a\uD83D" + "\uDE42b" === "a🙂b", "\uDE42" + "\uD83D" === smile, ("\uDE42" + "\uD83D").length);
const table: Record<string, number> = { "🙂": 1 };
console.log(table["\uD83D" + "\uDE42"], table[join("\uD83D", "\uDE42")], ("\uD83D" + "\uDE42") in table, new Set([smile]).has("\uD83D" + "\uDE42"), new Map([[smile, 2]]).get(join("\uD83D", "\uDE42")));
switch ("\uD83D" + "\uDE42") { case "🙂": console.log("switch: the pair"); break; default: console.log("switch: not the pair"); }
switch (join("\uD83D", "\uDE42")) { case "🙂": console.log("switch: the pair"); break; default: console.log("switch: not the pair"); }
const enum Half { High = "\uD83D", Low = "\uDE42" }
console.log(Half.High + Half.Low === smile, (Half.High + Half.Low).codePointAt(0), encodeURIComponent("\uD83D" + "\uDE42"), JSON.stringify("\uD83D" + "\uDE42"), JSON.stringify("\uD83D" + "x"), ("\uD83D" + "\uDE42").isWellFormed(), ("\uD83D" + "x").isWellFormed());
enum Joined { Pair = "\uD83D" + "\uDE42", Template = `\uD83D${"\uDE42"}`, Apart = "\uDE42" + "\uD83D" }
console.log(Joined.Pair === smile, Joined.Template === smile, (Joined.Apart as string) === smile, Joined.Pair.length, [...Joined.Pair].length, [...Joined.Apart].length);
const high: string = "\uD83D";
const low: string = "\uDE42";
console.log(high + low === smile, (high + low).length, (high + low).codePointAt(0)!.toString(16), `${high}${low}` === smile, [...(high + low)].length, high + low + high + low === smile + smile, high + high + low + low === high + smile + low);
if ("\uD83D" + "\uDE42" === "🙂") console.log("if: the pair"); else console.log("if: not the pair");
if ("\uD83D" + "\uDE42" !== "🙂") console.log("if not: not the pair"); else console.log("if not: the pair");
if (high + low === smile) console.log("names: the pair"); else console.log("names: not the pair");
console.log("\uD83D" + "\uDE42" === "🙂" ? "conditional: the pair" : "conditional: not the pair", ("\uD83D" + "\uDE42" === "🙂" && "and: the pair") || "and: not the pair");
switch ("🙂") { case "\uD83D" + "\uDE42": console.log("case: the pair"); break; default: console.log("case: not the pair"); }
switch ("\uD83D" + "\uDE42") { case "\uD83D\uDE42": console.log("escapes: the pair"); break; default: console.log("escapes: not the pair"); }
while ("\uD83D" + "\uDE42" !== "🙂") { console.log("while: not the pair"); break; }

// GENERATED: join template viaConcat
// CHECK-LABEL: function {{*}}name="join"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Add v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="template"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = ToString v0
// CHECK-NEXT: v3 = ToString v1
// CHECK-NEXT: v4 = Strcat v2, v3
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="viaConcat"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = PropGet v0 key="concat"
// CHECK-NEXT: v3 = Call v2, v0, v1 calleeKey="concat" calleeName="a.concat"
// CHECK-NEXT: ReturnCall v3 casts=[{declared={type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
