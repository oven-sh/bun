// answers: with-library
// # joins, characters, pieces and methods of written texts answer what the shell's own run of the text answers, and so do rows of joins, end tests that are asked twice and switches behind a test on values that are not what is written
// # the library rides along: a fold answers as the engine does, and a stand-in for padStart or repeat would answer undefined in the shell's run alone
// # a template of constants alone is folded by the front end, so parts of joined() and joinedWithOthers() come out of methods that the walk folds: the Strcat is left for the walk
// # f5 = joined, f9 = place, f12 = pieces, f17 = tell
// # RUN(FORM): walk f5 mechanisms=all
// # FORM-LABEL: code f5:Body
// # FORM: = String string=made "2-px"
// # RUN(PLACE): walk f9 mechanisms=all
// # PLACE-LABEL: code f9:Body
// # PLACE: = Integer integer=1
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 27 of 27 of 27
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function joined() { return `${"abc".indexOf("c")}-${"p" + "x"}`; }
function joinedWithOthers() { return `${"abc".at(5)}|${null}|${"abc".includes("b")}|${-0}|${1.5}|${"abc".slice(3)}`; }
function character() { return "abc"[1]; }
function behindTheEnd() { return "abc"[3]; }
function place() { return "a,b".indexOf(","); }
function lastPlace() { return "a,b,c".lastIndexOf(",", 2); }
function code() { return "abc".charCodeAt(1) + ":" + "abc".charCodeAt(9) + ":" + "abc".codePointAt(9); }
function pieces() { return "GET /x".slice(0, 3) + "|" + "GET /x".substring(9, 4) + "|" + "GET /x".substr(-2, 1) + "|" + " x ".trim() + "|" + "abc".at(-1) + "|" + "abc".at(5); }
function ends() { return "file.ts".endsWith(".ts") + ":" + "file.ts".startsWith("ile", 1) + ":" + "file.ts".includes("x"); }
function padded() { return "ab".padStart(1) + "|" + "ab".padEnd(4, "") + "|" + "ab".repeat(1) + "|" + "ab".repeat(0) + "|" + "ab".padStart(4) + "|" + "ab".repeat(2); }
function cases() { return "abc".toUpperCase() + "ABC".toLowerCase() + "abc".toLowerCase(); }
function refusedRepeat() { return "ab".repeat(-1); }
function row(a: string) { return a + "x" + 1 + "" + "y"; }
function rowOfOne(a: string) { return a + ""; }
function asked(s: string) { if (s.startsWith("--")) return "in:" + s.startsWith("--"); return "out:" + s.startsWith("--"); } // @ts-expect-error
function named(kind: number) { if (kind === 2) { switch (kind) { case 1: return "one"; case 2: return "two"; } } return "other"; }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
tell(joined);
tell(joinedWithOthers);
tell(character);
tell(behindTheEnd);
tell(place);
tell(lastPlace);
tell(code);
tell(pieces);
tell(ends);
tell(padded);
tell(cases);
tell(refusedRepeat);
tell(() => row("a"));
tell(() => row(""));
tell(() => row(5 as any));
tell(() => rowOfOne("a"));
tell(() => rowOfOne(5 as any));
tell(() => rowOfOne(null as any));
tell(() => asked("--x"));
tell(() => asked("-x"));
tell(() => asked(""));
tell(() => named(2));
tell(() => named(1));
tell(() => named("2" as any));
tell(joined);
tell(pieces);
report("end");
