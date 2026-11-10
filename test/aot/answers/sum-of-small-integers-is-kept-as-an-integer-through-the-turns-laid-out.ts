// answers: without-library
// # `sum += view[i]` in the turns of a counted loop that are laid out: the integers are added by themselves, and the whole is added to the sum once, on the way to the written loop.
// # right because every sum on the way is an integer below 2^53, which a number holds exactly: the sum that enters is whole and at most 2^52, asked once at the entry, and all turns together add at most 2^52, by the types.
// # every start is run that fails one of the two: NaN, the infinities, what lies beyond 2^52 on either side, a fraction; and -0, which passes and comes out as 0 either way.
// # f2 = sumBytes, f3 = sumSigned, f4 = sumFromAnyNumber, f5 = sumWords, f6 = sumReadInTheTurn, f7 = sumMasked, f13 = sumFromHalves
// # no turn laid out makes a number of its byte: one conversion for floor, one on the way out of the turns laid out, one in the written loop
// # RUN(SUM): emit f2 mechanisms=all
// # SUM-LABEL: unit f2:Body
// # SUM-COUNT-3: = IToD(
// # SUM-NOT: = IToD(
// # RUN(SMALL): emit f2 mechanisms=all
// # SMALL: [[size]] = Abs(
// # SMALL: = LessEqual(@[[size]],
// # a term that may be negative is extended with its sign
// # RUN(SIGN): emit f3 mechanisms=all
// # SIGN-COUNT-8: = SExt32(
// # SIGN-NOT: = SExt32(
// # a sum of whole numbers that comes round has no fraction by its type, so the entry asks for its size alone
// # RUN(SIZE): emit f7 mechanisms=all
// # SIZE: [[size]] = Abs(
// # SIZE: = LessEqual(@[[size]],
// # SIZE-NOT: = Equal(@[[size]],
// # of a sum that may have a fraction by its type the entry asks that too: rounded to a whole number by adding 2^52, it is what it was
// # RUN(WHOLE): emit f13 mechanisms=all
// # WHOLE: [[size]] = Abs(
// # WHOLE: [[raised]] = Add(@[[size]],
// # WHOLE: [[rounded]] = Sub(@[[raised]],
// # WHOLE: = Equal(@[[size]], @[[rounded]]
// # 2^31 a turn over 2^34 turns is more than a number holds exactly: the integer is taken over into the number behind every stretch of 2^20 turns, and there the size of the number is asked again: the entry asks once, the end of a stretch once
// # RUN(LARGE): emit f5 mechanisms=all
// # LARGE-COUNT-2: = Abs(
// # LARGE-NOT: = Abs(
// # a sum that the turn reads for itself has to be there: it stays a number
// # RUN(READ): emit f6 mechanisms=all
// # READ-NOT: = Abs(
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 138 of 138 of 138
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=-Guesses $SHELL
// # ALSO1: 138 of 138 of 138
// # ALSO1-NEXT: exited with 0
// # RUN(ALSO2): run-in-shell mechanisms=-ParameterGuards $SHELL
// # ALSO2: 138 of 138 of 138
// # ALSO2-NEXT: exited with 0
// # RUN(ALSO3): run-in-shell mechanisms=-LoopInvariants $SHELL
// # ALSO3: 138 of 138 of 138
// # ALSO3-NEXT: exited with 0
declare function report(value: unknown): void;
function say(value: number): string { return Object.is(value, -0) ? "-0" : String(value); }
function sumBytes(view: Uint8Array, start: number): number { let t = Math.floor(start); for (let i = 0; i < view.length; i++) t += view[i]; return t; }
function sumSigned(view: Int8Array, start: number): number { let t = Math.floor(start); for (let i = 0; i < view.length; i++) t += view[i]; return t; }
function sumFromAnyNumber(view: Uint8Array, start: number): number { let t = start; for (let i = 0; i < view.length; i++) t += view[i]; return t; }
function sumWords(view: Int32Array): number { let t = 0; for (let i = 0; i < view.length; i++) t += view[i]; return t; }
function sumReadInTheTurn(view: Uint8Array): number { let t = 0; let u = 0; for (let i = 0; i < view.length; i++) { u ^= t & 15; t += view[i]; } return t * 16 + u; }
function sumMasked(view: Uint8Array): number { let t = 0; for (let i = 0; i < view.length; i++) t += view[i] & 15; return t; }
function bytesOf(length: number): Uint8Array { const view = new Uint8Array(length); for (let i = 0; i < length; i++) view[i] = i * 7 + 1; return view; }
function signedOf(length: number): Int8Array { const view = new Int8Array(length); for (let i = 0; i < length; i++) view[i] = i * 37 + 11; return view; }
function wordsOf(length: number): Int32Array { const view = new Int32Array(length); for (let i = 0; i < length; i++) view[i] = i & 1 ? 2147483647 : i - 2147483648; return view; }
function largestWords(length: number): Int32Array { const view = new Int32Array(length); for (let i = 0; i < length; i++) view[i] = 2147483647; return view; }
const starts = [0, -0, 1, -1, NaN, Infinity, -Infinity, 4503599627370495, 4503599627370496, 4503599627370497, -4503599627370496, -4503599627370497, 9007199254740990, 9007199254740992, -9007199254740992, 1e300];
function from(length: number, start: number): void { report([length, say(start), say(sumBytes(bytesOf(length), start)), say(sumSigned(signedOf(length), start)), say(sumFromAnyNumber(bytesOf(length), start)), say(sumFromAnyNumber(bytesOf(length), start + 0.5)), say(sumFromHalves(bytesOf(length), start))].join(" ")); }
function all(length: number): void { for (let k = 0; k < starts.length; k++) from(length, starts[k]); report([length, say(sumWords(wordsOf(length))), say(sumReadInTheTurn(bytesOf(length))), say(sumMasked(bytesOf(length)))].join(" ")); }
function sumFromHalves(view: Uint8Array, start: number): number { let t = start * 0.5; for (let i = 0; i < view.length; i++) t += view[i] & 15; return t; }
all(0);
all(1);
all(7);
all(8);
all(9);
all(16);
all(17);
all(100);
report(say(sumWords(largestWords(5242889))));
report("end");
