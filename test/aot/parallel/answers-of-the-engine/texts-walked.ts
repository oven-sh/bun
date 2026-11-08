// A for-of and a pattern over a text step it by code point: surrogates in pairs and alone, ropes, String objects with and without an @@iterator of their own.
// Under: --aot-testing=WritesBodiesStraight: the closed ways give the same answers
(globalThis as any).report = (value: unknown) => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
declare function report(value: unknown): void;
function pieces(text: string): string { let s = ""; for (const piece of text) s += "[" + piece + "]" + piece.length; return s; }
report(pieces("abc"));
report(pieces(""));
report(pieces("a😀b"));
report(pieces("😀😀"));
report(pieces("\ud83d"));
report(pieces("\ude00\ud83d"));
report(pieces("x\ud83dy\ude00"));
report(pieces("\ud83d😀"));
report(pieces("é漢字"));
report(pieces("ab".repeat(3) + "c" + String(12)));
function anyPieces(text: any): string { let s = ""; for (const piece of text) s += "[" + piece + "]"; return s; }
report(anyPieces("a😀"));
report(anyPieces(new String("ob")));
report(pieces(new String("ob") as any));
report(pieces(["l", "i"] as any));
const wrapped: any = new String("xy");
wrapped[Symbol.iterator] = function* () { yield "own"; };
report(pieces(wrapped));
function literal(): string { let s = ""; for (const piece of "h😀i") s += piece + "|"; return s; }
report(literal());
function firstTwo(text: string): string { const [a, b, c] = text; return a + "," + b + "," + c; }
report(firstTwo("😀z"));
report(firstTwo(""));
function restOf(text: string): string { const [a, ...rest] = text; return a + "/" + rest.join("|"); }
report(restOf("a😀c"));
function withDefault(text: string): string { const [a = "d", b = a + "e"] = text; return a + b; }
report(withDefault("q"));
function leaves(text: string): string { let s = ""; for (const piece of text) { if (piece === "c") break; s += piece; } return s; }
report(leaves("abcd"));
function counts(text: string): number { let n = 0; for (const _ of text) n++; return n; }
report(counts("a😀b😀"));
function nested(text: string): string { let s = ""; for (const a of text) for (const b of text) s += a + b + ","; return s; }
report(nested("x😀"));
function spreads(text: string): string { return [...text].length + ":" + [...text].join("|"); }
report(spreads("a😀b"));
function* yields(text: string): any { for (const piece of text) yield piece + piece; }
report([...yields("a😀")].join());
async function awaits(text: string): Promise<string> { let s = ""; for (const piece of text) s += await piece; return s; }
report(await awaits("a😀b"));
try { report(pieces(undefined as any)); } catch (error) { report(error instanceof TypeError); }
try { report(pieces(5 as any)); } catch (error) { report(error instanceof TypeError); }
report("end");
