// answers: with-library
// # a key is put together of numbers in sight by a list that is joined, by concat and by String.raw: each is one join of its parts: no list is made and no built-in is called
// # f1 = byJoin, f2 = byConcat, f3 = byRaw
// # RUN(JOIN): walk f1 mechanisms=all
// # JOIN-LABEL: code f1:Body
// # JOIN: = Strcat
// # RUN(NOLIST): walk f1 mechanisms=all
// # NOLIST-NOT: = NewArray
// # RUN(CONCAT): walk f2 mechanisms=all
// # CONCAT-LABEL: code f2:Body
// # CONCAT: = Strcat
// # RUN(RAW): walk f3 mechanisms=all
// # RAW-LABEL: code f3:Body
// # RAW: = Strcat
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 10 of 10 of 10
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function byJoin(x: number, y: number): string { return [x, y].join("-"); }
function byConcat(x: number, y: number): string { return "p".concat(x as any, y as any); }
function byRaw(x: number, y: number): string { return String.raw`${x}:${y}`; }
report(byJoin(1, 2));
report(byConcat(1, 2));
report(byRaw(1, 2));
report(byJoin(-0, 0.5));
report(byConcat(-0, 0.5));
report(byRaw(-0, 0.5));
report(byJoin(NaN, 1e21));
report(byConcat(NaN, 1e21));
report(byRaw(NaN, 1e21));
report("end");
