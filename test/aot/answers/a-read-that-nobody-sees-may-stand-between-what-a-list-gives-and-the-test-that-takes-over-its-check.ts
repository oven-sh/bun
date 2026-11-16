// answers: without-library
// # `const b = dots[j]; const dx = a.x - b.x;`: `a.x` is read between what the list gives and the first look at it. The check of the list's contents is left to one test that asks in full (hole, cell, shape) and splits
// # undefined off, as where nothing stands between: no check and a trapping load behind it. A hole at each place still throws a TypeError, behind the read of `a.x`.
// # f1 = spread
// # RUN(FORM): walk f1 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM: [[given]]: undefined|L0 @JSValue = GetArrayElement {{*}}arrayStorage=Contiguous level=Proven
// # FORM: = CheckProof [[given]] checkedType=undefined|L0 {{*}}source=Contents [isLeftToTestBehind]
// # FORM: = TypeTest [[given]] testedType=L0 [asksInFull]
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 7 of 7 of 7
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
class Dot { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y; } }
function spread(dots: Dot[]): number { let sum = 0; const size = dots.length; for (let i = 0; i < size; i++) { const a = dots[i]; for (let j = i + 1; j < size; j++) { const b = dots[j]; const dx = a.x - b.x; const dy = a.y - b.y; sum += dx * dx + dy * dy; } } return sum; }
function tried(dots: Dot[]): string { try { return String(spread(dots)); } catch (error) { return (error as Error).constructor.name; } }
report(spread([new Dot(0, 0), new Dot(1.5, 2), new Dot(-1, 0.5)]));
report(spread([]));
report(tried([new Dot(0, 0), new Dot(1, 1)]));
report(tried([new Dot(0, 0), , new Dot(2, 2)] as unknown as Dot[]));
report(tried([, new Dot(0, 0)] as unknown as Dot[]));
report(tried([new Dot(0, 0), new Dot(2, 2), , ] as unknown as Dot[]));
report("end");
