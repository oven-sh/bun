// answers: without-library
// # In the typed copy of a loop, while the turn may still begin again in the other copy, a character read asks whether its position lies inside the string and leaves the turn where it does not.
// # So charCodeAt gives an integer there and no NaN, and two of them are compared as integers. Where string and position stand in front of the loop the question and the read stand there too.
// # f1 = tell, f2 = show, f3 = compare, f4 = row
// # RUN(ROW): walk f4 mechanisms=all-Inlining
// # ROW-LABEL: code f4:Body
// # ROW: isInLoop=true isLoopHead=true:
// # ROW: [[typed]]({{*}}) isInLoop=true isLoopHead=true:
// # ROW: [[unit]]: int[0, 65535] @Int32 = GetStringCodeUnit
// # ROW-NEXT: StrictEq [[unit]], [[other]] form=Integers
// # ROW: [[other]]: int[0, 65535] @Int32 = GetStringCodeUnit
// # ROW-NOT: isInLoop=true
// # ROW: Jump -> next [[typed]](
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: exited with 0
declare function report(value: unknown): void;
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
function show(out: any): string { let text = out.length + ":"; for (let i = 0; i < out.length && i < 12; i++) text += String(out[i]) + ","; return text; }
function compare(a: string, b: string, at: number, out: Uint32Array): void { for (let i = 1; i < out.length; i++) out[i] = (a.charCodeAt(i - 1) === b.charCodeAt(at) ? 0 : 1) + out[i - 1]; }
function row(a: string, b: string, at: number, count: number, out: Uint32Array): void { const place = at | 0; for (let i = 1; i <= count; i++) out[i] = (a.charCodeAt(i - 1) === b.charCodeAt(place - 1) ? 0 : 1) + out[i - 1]; }
function codes(s: string, from: number, out: Float64Array): void { for (let i = 0; i < out.length; i++) out[i] = s.charCodeAt(from + i); }
function behindStore(s: string, out: Float64Array): number { let total = 0; for (let i = 0; i < out.length; i++) { out[i] = i; total += s.charCodeAt(i); } return total; }
function byIndex(s: string, wanted: string, out: Uint32Array): void { for (let i = 1; i < out.length; i++) out[i] = (s[i - 1] === wanted ? 1 : 0) + out[i - 1]; }
function byAt(s: string, wanted: string, out: Uint32Array): void { for (let i = 1; i < out.length; i++) out[i] = (s.at(i - 3) === wanted ? 1 : 0) + out[i - 1]; }
function byCharAt(s: string, wanted: string, out: Uint32Array): void { for (let i = 1; i < out.length; i++) out[i] = (s.charAt(i - 1) === wanted ? 1 : 0) + out[i - 1]; }
function byCodePoint(s: string, out: Float64Array): void { for (let i = 0; i < out.length; i++) out[i] = s.codePointAt(i - 1) ?? -1; }
function join(a: string, b: string): string { return a + b; }
const texts: string[] = ["", "a", "abcabc", "abcabcabcabcabc", "ሴbሴ", "a😀b", join("abc", "abcabc"), join(join("ab", "ሴ"), "cabc")];
const places: number[] = [0, 1, 2, 5, 6, 100, -1, -100, 1.5, -0.5, NaN, Infinity, -Infinity, 4294967296, 4294967297, -4294967295];
const rooms: number[] = [0, 1, 2, 7, 11];
function compareEach(a: string, b: string): void { for (let r = 0; r < rooms.length; r++) for (let p = 0; p < places.length; p++) tell(() => { const out = new Uint32Array(rooms[r]); compare(a, b, places[p], out); compare(b, a, places[p], out); return show(out); }); }
for (let a = 0; a < texts.length; a++) for (let b = 0; b < texts.length; b += 3) compareEach(texts[a], texts[b]);
const counts: number[] = [0, 1, 5, 6, 10, 20];
function rowEach(a: string, b: string): void { for (let r = 0; r < rooms.length; r++) for (let c = 0; c < counts.length; c++) for (let p = 0; p < 8; p++) tell(() => { const out = new Uint32Array(rooms[r]); row(a, b, places[p], counts[c], out); row(b, a, places[p], counts[c], out); return show(out); }); }
for (let a = 0; a < texts.length; a++) for (let b = 1; b < texts.length; b += 3) rowEach(texts[a], texts[b]);
function readEach(s: string): void { for (let r = 0; r < rooms.length; r++) { for (let p = 0; p < places.length; p++) tell(() => { const out = new Float64Array(rooms[r]); codes(s, places[p], out); return show(out); }); tell(() => { const out = new Float64Array(rooms[r]); return behindStore(s, out) + " " + show(out); }); tell(() => { const out = new Uint32Array(rooms[r]); byIndex(s, "a", out); const first = show(out); byAt(s, "b", out); const second = show(out); byCharAt(s, "", out); return first + " " + second + " " + show(out); }); tell(() => { const out = new Float64Array(rooms[r]); byCodePoint(s, out); return show(out); }); } }
for (let s = 0; s < texts.length; s++) readEach(texts[s]);
report("end");
