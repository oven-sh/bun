// answers: without-library
// # the parameter of the turns laid out that stands for a sum kept as an integer is an Int64. A Phi of the sum's own type was made for it first and left behind: nothing read it and no Upsilon fed it,
// # so every answer was right and the machine level's own verifier stopped: "the machine operations that the emitters appended do not hold together ... Jump() -> #8".
// # f1 = sumBytes, f2 = sumTwice
// # OPTIONS: check=Validate
// # RUN(ONE): emit f1 mechanisms=all
// # ONE-LABEL: unit f1:Body
// # RUN(TWO): emit f2 mechanisms=all
// # TWO-LABEL: unit f2:Body
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 6 of 6 of 6
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function sumBytes(view: Uint8Array): number { let t = 0; for (let i = 0; i < view.length; i++) t += view[i]; return t; }
function sumTwice(view: Uint8Array, other: Int8Array): number { let t = 0; let u = 5; for (let i = 0; i < view.length; i++) { t += view[i]; u += other[i]; } return t * 1000 + u; }
function bytesOf(length: number): Uint8Array { const view = new Uint8Array(length); for (let i = 0; i < length; i++) view[i] = i * 7 + 1; return view; }
function signedOf(length: number): Int8Array { const view = new Int8Array(length); for (let i = 0; i < length; i++) view[i] = i * 37 + 11; return view; }
function all(length: number): void { report([length, sumBytes(bytesOf(length)), sumTwice(bytesOf(length), signedOf(length))].join(" ")); }
all(0);
all(7);
all(8);
all(9);
all(40);
report("end");
