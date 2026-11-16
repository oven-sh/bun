// answers: without-library
// # `list.push(keep ? field : field.trim()); field = ""`: one arm of the choice hands the text that grows in the loop to where the arms meet, the other hands over what a call gave. What takes them is no name of the text: the arm reads the text, a string is made of it on that edge, and the text stays in its builder.
// # The string is the text as it stood: what is appended later does not show in it. Under a handler, where the choice comes back into the text, where the text begins as a number, and where it is handed to the head of a loop inside (the back edge has no place for the string) there is no builder.
// # f1 = cut, f2 = goesOnGrowing, f3 = ofThree, f4 = underHandler, f5 = comesBack, f6 = inside, f7 = beginsAsNumber, f8 = separated, f9 = comesRoundInside
// # RUN(FORM): walk f1 f2 f3 f6 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM: StringBuilderBegin
// # FORM: StringBuilderToString
// # FORM-LABEL: code f2:Body
// # FORM: StringBuilderBegin
// # FORM: StringBuilderToString
// # FORM-LABEL: code f3:Body
// # FORM: StringBuilderBegin
// # FORM: StringBuilderToString
// # FORM-LABEL: code f6:Body
// # FORM: StringBuilderBegin
// # FORM: StringBuilderToString
// # RUN(NOFORM): walk f4 f5 f7 f9 mechanisms=all
// # NOFORM-NOT: StringBuilder
// # `if (line) line += ","`: what the test of the text shows goes over the edges to a parameter that nobody reads: no string is made for it.
// # RUN(NOSTRING): walk f8 mechanisms=all
// # NOSTRING: StringBuilderBegin
// # NOSTRING-NOT: StringBuilderToString
// # RUN(ASWRITTEN): walk f9 mechanisms=all
// # ASWRITTEN: form=Strings
// # ASWRITTEN-NOT: form=StringAndPrimitive
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 28 of 28 of 28
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=none $SHELL
// # ALSO1: 28 of 28 of 28
// # ALSO1-NEXT: exited with 0
declare function report(value: unknown): void;
function cut(text: string, keep: boolean) { const list: string[] = []; let field = ""; for (let i = 0; i < text.length; i++) { const c = text[i]!; if (c === ",") { list.push(keep ? field : field.trim()); field = ""; } else field += c; } list.push(field); return list.join("|"); }
function goesOnGrowing(text: string, every: number) { const seen: string[] = []; let grown = ""; for (let i = 0; i < text.length; i++) { grown += text[i]!; const shown = i % every === 0 ? grown : String(i); seen.push(shown); } return seen.join("|") + "/" + grown; }
function ofThree(text: string, which: number) { const list: string[] = []; let field = ""; for (let i = 0; i < text.length; i++) { const c = text[i]!; if (c === ";") { const taken = which === 0 ? field : which === 1 ? field.toUpperCase() : field.slice(1); list.push(taken + taken.length); field = ""; } else field += c; } return list.join("|") + "/" + field; }
function underHandler(text: string, keep: boolean) { const list: string[] = []; let field = ""; for (let i = 0; i < text.length; i++) { const c = text[i]!; try { if (c === "!") throw new Error(field); if (c === ",") { list.push(keep ? field : field.trim()); field = ""; } else field += c; } catch (error) { list.push("caught " + (error as Error).message + " " + field); } } return list.join("|") + "/" + field; }
function comesBack(text: string, keep: boolean) { let field = ""; for (let i = 0; i < text.length; i++) { field += text[i]!; field = keep ? field : field.trim(); } return field; }
function inside(rows: string[], keep: boolean) { const out: string[] = []; for (let at = 0; at < rows.length; at++) { const row = rows[at]!; let field = ""; for (let i = 0; i < row.length; i++) { const c = row[i]!; if (c === " ") { out.push(keep ? field : field.padStart(4, ".")); field = ""; } else field += c; } out.push(field); } return out.join("|"); }
function beginsAsNumber(n: number, keep: boolean) { const seen: string[] = []; let text: any = 0; let i = 0; do { const shown = keep ? text : String(i); seen.push(typeof shown + ":" + shown); text += "k"; } while (++i < n); return seen.join("|") + "/" + text; }
function separated(cells: number[]) { let line = ""; for (let at = 0; at < cells.length; at++) { if (line) line += ","; line += cells[at]!; } return line; }
function comesRoundInside(text: string) { const list: string[] = []; let field = ""; for (let i = 0; i < text.length; i++) { const c = text[i]!; if (c !== ",") { field += c; continue; } let shown = c.toUpperCase(); let turn = 0; do { list.push(shown); shown = field; turn++; } while (turn < 2); field = ""; } return list.join("|"); }
report(cut(" a , b,c ,, d", true));
report(cut(" a , b,c ,, d", false));
report(cut("", true));
report(cut(",", false));
report(cut("café , 中文 ,x", false));
report(cut("café , 中文 ,x", true));
report(goesOnGrowing("abcdefgh", 3));
report(goesOnGrowing("abcdefgh", 1));
report(goesOnGrowing("", 1));
report(goesOnGrowing("中bc文", 2));
report(ofThree("ab;cde;;f", 0));
report(ofThree("ab;cde;;f", 1));
report(ofThree("ab;cde;;f", 2));
report(underHandler(" a,b !c , d", true));
report(underHandler(" a,b !c , d", false));
report(comesBack(" a b ", true));
report(comesBack(" a b ", false));
report(inside(["a bc def", "", " x "], true));
report(inside(["a bc def", "", " x "], false));
let wide = "x";
for (let turn = 0; turn < 9; turn++) wide = wide + wide;
report(cut(wide + " ,yyyyy", false).length);
report(beginsAsNumber(3, true));
report(beginsAsNumber(3, false));
report(beginsAsNumber(1, true));
report(separated([1, 22, 333]));
report(separated([]));
report(comesRoundInside("ab,cd,"));
report(comesRoundInside(","));
report("end");
