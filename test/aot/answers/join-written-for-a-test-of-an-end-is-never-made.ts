// answers: without-library
// # a join that is written for one startsWith or endsWith is never made: the call goes on the part that lies at the end of the text, the one written character is read beside it, and the answers are those of the joined text, for texts, ropes, primitives and objects that convert with code
// # f2 = under, f3 = named, f4 = below, f5 = listed, f6 = among, f7 = besidePrimitive, f1 = besideAnything, f8 = tell, f9 = grown
// # under, named and below get texts that are proven by their making, "" + text. listed gets them out of a list, so undefined stands in their types as it does behind a guard
// # the join stands in the rare block alone, where the two are too long for one text
// # RUN(FORM): walk f2 mechanisms=all
// # FORM-LABEL: code f2:Body
// # FORM-NOT: = Add
// # FORM: = CallInline {{*}}inlineBuiltin=StringStartsWith
// # FORM: frequency=Rare
// # FORM: = Add
// # FORM: = GetStringCodeUnit
// # FORM: = StrictEq {{*}}form=Integers
// # RUN(ENDS): walk f3 mechanisms=all
// # ENDS-LABEL: code f3:Body
// # ENDS-NOT: = Add
// # ENDS: = CallInline {{*}}inlineBuiltin=StringEndsWith
// # ENDS: = GetStringCodeUnit
// # RUN(TEMPLATE): walk f4 mechanisms=all
// # TEMPLATE-LABEL: code f4:Body
// # TEMPLATE-NOT: = Strcat
// # TEMPLATE: = CallInline {{*}}inlineBuiltin=StringStartsWith
// # TEMPLATE: frequency=Rare
// # TEMPLATE: = Strcat
// # TEMPLATE: = GetStringCodeUnit
// # RUN(LISTED): walk f5 mechanisms=all
// # LISTED-LABEL: code f5:Body
// # LISTED-NOT: = Add
// # LISTED: = CallInline {{*}}inlineBuiltin=StringStartsWith
// # LISTED: = GetStringCodeUnit
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 2328 of 2328 of 2328
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function under(path: string, dir: string, n: number) { let c = 0; for (let i = 0; i < n; i++) if (path.startsWith(dir + "/")) c++; return c; }
function named(name: string, extension: string, n: number) { let c = 0; for (let i = 0; i < n; i++) if (name.endsWith("." + extension)) c++; return c; }
function below(path: string, dir: string) { return path.startsWith(`${dir}/`); }
function listed(path: string, dir: string, n: number) { let c = 0; for (let i = 0; i < n; i++) if (path.startsWith(dir + "/")) c++; return c; }
function among(path: string, dirs: string[]) { let c = 0; for (let i = 0; i < dirs.length; i++) if (path.startsWith(dirs[i] + "/")) c += i + 1; return c; }
function besidePrimitive(path: string, part: string | number | boolean | bigint | null | undefined) { return (path.startsWith(part + "/") ? 1 : 0) + (path.endsWith("." + part) ? 2 : 0); }
function besideAnything(path: string, part: any) { return (path.startsWith(part + "/") ? 1 : 0) + (path.endsWith("." + part) ? 2 : 0); }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
function grown(n: number) { let text = ""; for (let i = 0; i < n; i++) text += "ab"; return text; }
let log = "";
const valued = { valueOf() { log += "v"; return "ab"; }, toString() { log += "t"; return "no"; } };
const speaking = { toString() { log += "t"; return "ab"; } };
const throwing = { toString(): string { throw new RangeError("no text"); } };
tell(() => besideAnything("ab/c", valued) + log);
tell(() => besideAnything("x.ab", speaking) + log);
tell(() => besideAnything("ab/c", throwing));
tell(() => besideAnything("ab/c", Symbol("ab")));
tell(() => besideAnything("undefined/", undefined));
const primitives = [undefined, null, true, false, 0, -0, -1, 1.5, NaN, 10n, "a", ""];
for (let p = 0; p < primitives.length; p++) { const part = primitives[p]; report(besidePrimitive(String(part) + "/x", part)); report(besidePrimitive("x." + String(part), part)); report(besidePrimitive("x", part)); }
const texts = ["", "a", "/", ".", "a/", "a/b", "ab", "ab/", "ab/c", "x.a", "x.ab", ".ab", "Ā", "Ā/b", "x.Ā", "a/Ā", grown(4), grown(30).slice(5, 12)];
for (let t = 0; t < texts.length; t++) { const s = "" + texts[t]; for (let u = 0; u < texts.length; u++) { const other = "" + texts[u]; report(under(s, other, 2)); report(named(s, other, 2)); report(below(s, other)); report(listed(texts[t], texts[u], 2)); report(under(other + "/" + s, other, 1)); report(named(s + "." + other, other, 1)); report(below(other + "/", other)); } report(among(s, texts)); }
report("end");
