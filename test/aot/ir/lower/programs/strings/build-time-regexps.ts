// RUN: lower
// OPTIONS: builtin-modules

// Regular expressions that are not literals but are still known at build time: a function chooses the flags of one, templates name constants, raw texts and numbers.
// KNOWN regexp2 \d+(?:\.\d{1,3})? ?(?:kg|g|µg)|\$\d+(?:\.\d{1,3})?(?: each)?
// KNOWN regexp2 cho+sen
// PARTLY regexp2 unkno+wnflags
// KNOWN fold1 lo+ng0123456789012345678901234567890123456789012345678901234567890123456789|sho+rt
// KNOWN fold1 (?:<(?<tag>[a-z][a-z-]*)>|<\/(?<ended>[a-z][a-z-]*)>)|<(?:!(?<kind>\w+):(?<note>[^<>\u0000-\u0009]*)|[^<>\u0000-\u0009]*)>
// KNOWN fold1 ra+w\d1\n
// KNOWN fold1 nu+mber12-0.5
// KNOWN fold1 assi+gned
// KNOWN fold1 fromca+ll
// KNOWN fold1 [ab]joi+ned
// KNOWN fold1 obje+ct7
declare const console: { log(...values: unknown[]): void };
function make(text: string): string { return Array.from(text).join(""); }
const NUMBER = "\\d+(?:\\.\\d{1,3})?";
function weights(once = false): RegExp { return new RegExp(`${NUMBER} ?(?:kg|g|\\u00B5g)` + `|\\$${NUMBER}(?: each)?`, once ? "" : "g"); }
function chosen(kind: number): RegExp { return new RegExp("cho+sen", kind === 0 ? "i" : kind === 1 ? "gi" : kind === 2 ? undefined : "m"); }
function withFlags(flags: string): RegExp { return new RegExp("unkno+wnflags", flags); }
const LONG = "lo+ng0123456789012345678901234567890123456789012345678901234567890123456789";
const SHORT = "sho+rt";
const long = new RegExp(`${LONG}|${SHORT}`);
const LEFT = "<", RIGHT = ">", SLASH = "/", COLON = ":";
const NAME = "[a-z][a-z-]*";
const OPENED = `${LEFT}(?<tag>${NAME})${RIGHT}`;
const CLOSED = `${LEFT}\\${SLASH}(?<ended>${NAME})${RIGHT}`;
const WORDS = String.raw`[^<>\u0000-\u0009]*`;
const NOTE = String.raw`!(?<kind>\w+)${COLON}(?<note>${WORDS})`;
const marked = new RegExp(`(?:${OPENED}|${CLOSED})` + `|${LEFT}(?:${NOTE}|${WORDS})${RIGHT}`, "y");
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
const bill = make("2 kg of plums, 40g of salt, 3.25µg of saffron, $4.50 each, $12 and 7 jars");
const out: unknown[] = [bill.replace(weights(), ""), weights(true).exec(bill)?.index, weights().flags, weights(true).flags];
for (let kind = 0; kind < 4; kind++) out.push(chosen(kind).flags + chosen(kind).test(make("x CHOOSEN")));
for (const flags of ["", "g", "i", "dgimsuy", "v"]) out.push(withFlags(make(flags)).flags + withFlags(make(flags)).test(make("UNKNOOWNFLAGS unknoowNflags unknoownflags")));
out.push(long.exec(make("a shoort"))?.index, long.source.length, marked.flags, marked.exec(make("<plum-jam>"))?.groups?.tag, marked.exec(make("<!kept:in a cool room>"))?.groups?.note, marked.exec(make("x")), raw.test(make("raaw51\n")), raw.source, numbered.test(make("nuumber12-0x5")), numbered.source);
out.push(assigned.test(make("assiigned")), fromCall.test(make("fromcaall")), joined.test(make("bjoiined")), withObject.test(make("objeect7")), OPENED, NOTE.length, CLOSED);
try { withFlags(make("gg")); out.push("no error"); } catch (e) { out.push((e as Error).name); }
console.log(out.map(String).join(" | "));

// CHECK-LABEL: function {{*}}name="make"
// CHECK-LABEL: function {{*}}name="weights"
// CHECK-LABEL: function {{*}}name="withFlags"
