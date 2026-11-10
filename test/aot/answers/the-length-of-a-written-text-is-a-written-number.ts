// answers: without-library
// # `path.length > extension.length` copied in where extension is ".ts": the length of a written text is a number at build time: no cell is made of the text to read it.
// # f1 = isLonger, f2 = endsInTs, f3 = lengths, f4 = ofEither
// # RUN(FORM): walk f2 mechanisms=all
// # FORM-COUNT-1: = GetStringLength
// # FORM: = Greater
// # RUN(NOCELL): walk f2 f3 mechanisms=all
// # NOCELL-NOT: = String string=
// # RUN(EITHER): walk f4 mechanisms=all
// # EITHER: = GetStringLength
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 8 of 8 of 8
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=none $SHELL
// # ALSO1: 8 of 8 of 8
// # ALSO1-NEXT: exited with 0
declare function report(value: unknown): void;
function isLonger(path: string, extension: string) { return path.length > extension.length; }
function endsInTs(path: string) { return isLonger(path, ".ts"); }
function lengths() { const plain = "four"; const empty = ""; const wide = "中文"; const pair = "\u{1F600}"; const accent = "café"; return plain.length * 10000 + empty.length * 1000 + wide.length * 100 + pair.length * 10 + accent.length; }
function ofEither(flag: boolean) { const text = flag ? "ab" : "abc"; return text.length; }
report(endsInTs("a.ts"));
report(endsInTs(".ts"));
report(endsInTs(""));
report(endsInTs("中文.ts"));
report(lengths());
report(ofEither(true));
report(ofEither(false));
report("end");
