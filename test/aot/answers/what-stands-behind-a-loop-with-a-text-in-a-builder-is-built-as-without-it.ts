// answers: without-library
// # The entry of a text in a builder ends with the walk of its loop. It used to stay in the walker's list to the end of the unit, and whatever asks "is a text in a builder?" said yes there:
// # no build for each member of a union, no turn that begins again in the other copy, no counter held where it comes round, no copy that leaves for its call.
// # A text that stays in its builder for the next loop waits until every build of that loop has taken or finished it. A text that begins as no text asks at every growth that a part is a string.
// # f1 = id, f2 = sumBehindText, f3 = pushBehindText
// # RUN(FORM): walk f2 f3 mechanisms=all
// # FORM-LABEL: code f2:Body
// # FORM: opaque(StringBuilder) @Cell{{*}}isLoopHead=true
// # The loop behind it has a typed build, whose turns begin again in the other copy where a point is not as expected.
// # FORM: number @Double{{*}}isInLoop=true isLoopHead=true
// # FORM-LABEL: code f3:Body
// # FORM: opaque(StringBuilder) @Cell{{*}}isLoopHead=true
// # The loop behind it is built for each member of `Sink | string[]`, beside the closed copy.
// # FORM: frequency=Rare isLoopHead=true
// # FORM: isInLoop=true isLoopHead=true
// # FORM: isInLoop=true isLoopHead=true
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 13 of 13 of 13
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function id<T>(value: T): T { (globalThis as any).leaked = value; return (globalThis as any).leaked; }
type Point = { x: number; y: number };
type Sink = { size: number; push(part: string): void };
function sumBehindText(few: string[], points: Point[]): number { let out = ""; for (let i = 0; i < few.length; i++) out += few[i]; let sum = 0; for (let k = 0; k < points.length; k++) { const p = points[k]; sum += p.x + p.y; } return sum + out.length; }
function pushBehindText(few: string[], words: string[], sink: Sink | string[]): number { let out = ""; for (let i = 0; i < few.length; i++) out += few[i]; for (let k = 0; k < words.length; k++) sink.push(words[k]); return out.length; }
function textWaitsForLoopBuiltTwice(n: number, b: string[]): string { const m = n | 0; let s = ""; for (let i = 0; i < m; i++) s += "ab"; for (let k = 0; k < b.length; k++) s += b[k]; return s; }
function textWaitsTwice(n: number, b: string[], c: number[]): string { const m = n | 0; let s = "<"; for (let i = 0; i < m; i++) s += "x"; for (let k = 0; k < b.length; k++) s += b[k]; for (let i = 0; i < m; i++) s += "y"; let sum = 0; for (let k = 0; k < c.length; k++) sum += c[k]; return s + sum; }
function textWaitsInsideLoop(n: number, rows: string[][]): string { const m = n | 0; let s = ""; for (let r = 0; r < rows.length; r++) { const row = rows[r]; for (let i = 0; i < m; i++) s += "-"; for (let k = 0; k < row.length; k++) s += row[k]; } return s; }
function beginsAsNumber(c: any[], from: number, to: number): unknown { let a: any = 0; let i = from | 0; do { const x: any = c[i]; a += x; i = (i + 1) | 0; } while (i < to); return a; }
function beginsAsNumberOverTexts(c: string[], to: number): unknown { let a: any = 0; for (let i = 0; i < to; i++) a += c[i]; return a; }
function beginsAsNumberAndTakesTwoParts(c: any[], to: number): unknown { let a: any = 0; for (let i = 0; i < to; i++) a = a + c[i] + ","; return a; }
function loopInsideTheLoopThatTakes(n: number, b: string[], c: number[]): string { const m = n | 0; let s = ""; let t = 0; for (let i = 0; i < m; i++) s += "ab"; for (let k = 0; k < b.length; k++) { for (let j = 0; j < c.length; j++) t += c[j]; s += b[k]; } return s + t; }
const few: string[] = id(["a", "bc"]);
const points: Point[] = id([{ x: 1, y: 2 }, { x: 3, y: 4.5 }, { x: 5, y: 6 }]);
report(sumBehindText(few, points));
report(sumBehindText(few, id([{ x: 1, y: 2 }, { y: 1, x: "s" } as any, { x: 5, y: 6 }])));
report(sumBehindText(id([]), id([])));
const sink: Sink = id({ size: 0, push(part: string): void { this.size += part.length; } });
report(pushBehindText(few, id(["w1", "w22", "w333"]), sink) + " " + sink.size);
const list: string[] = id([]);
report(pushBehindText(few, id(["w1", "w22"]), list) + " " + list.length + " " + list[1]);
report([textWaitsForLoopBuiltTwice(2, id(["hi", "jkl"])), textWaitsForLoopBuiltTwice(0, id([])), textWaitsForLoopBuiltTwice(1, id([1, null] as any))].join(" "));
report([textWaitsTwice(1, id(["hi", "m"]), id([1, 2.5])), textWaitsTwice(0, id([]), id([])), textWaitsTwice(2, id([undefined, 3] as any), id(["q"] as any))].join(" "));
report([textWaitsInsideLoop(1, id([["a", "b"], [], ["cd"]])), textWaitsInsideLoop(0, id([])), textWaitsInsideLoop(2, id([[7 as any]]))].join(" "));
const texts = id(["a", "b"]);
report([beginsAsNumber(texts, -1, 2), beginsAsNumber(texts, 0, 2), beginsAsNumber(texts, 0, 3), beginsAsNumber(id([1, 2]), 0, 2), beginsAsNumber(id([undefined, "x"]), 0, 2)].join(" "));
report([beginsAsNumberOverTexts(texts, 3), beginsAsNumberOverTexts(texts, 2), beginsAsNumberOverTexts(texts, 0)].join(" "));
report([beginsAsNumberAndTakesTwoParts(id([undefined, "x"]), 2), beginsAsNumberAndTakesTwoParts(texts, 2), beginsAsNumberAndTakesTwoParts(id([1, 2]), 2), beginsAsNumberAndTakesTwoParts(texts, 0)].join(" "));
report([loopInsideTheLoopThatTakes(2, id(["hi", "jkl"]), id([1, 2.5])), loopInsideTheLoopThatTakes(0, id([]), id([])), loopInsideTheLoopThatTakes(1, id([7 as any]), id(["q"] as any))].join(" "));
report("end");
