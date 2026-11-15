// answers: with-library
// # `let best: number | undefined; for (..) { .. best = next; }`: what goes round the head is a number or undefined: its natural form is an optional double, the form in which a field's read or a call's result gives it.
// # It was held as a box: an allocation-free box costs nine instructions at the back edge (an int32 is tried first) and six at each use. Beside the plain case: NaN and -0 go round unchanged, undefined and null stay
// # what they are, the value is handed on to a list and printed.
// # f1 = greatest
// # RUN(FORM): walk f1 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM: : undefined|number @OptionalDouble, {{*}}isLoopHead=true
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 16 of 16 of 16
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function greatest(list: (number | undefined)[]): number | undefined { let best: number | undefined = undefined; for (let i = 0; i < list.length; i++) { const next = list[i]; if (next !== undefined && (best === undefined || next > best)) best = next; } return best; }
report(greatest([0.5, undefined, 2.25, 1]));
report(greatest([undefined, undefined]));
report(greatest([]));
report(greatest([NaN, 1.5]));
report(Object.is(greatest([-0]), -0));

function lastSum(list: number[], from: number | undefined): string { let sum = from; for (let i = 0; i < list.length; i++) sum = (sum as number) + list[i]! * 0.5; return String(sum); }
report(lastSum([1, 2, 3], 0.25));
report(lastSum([1, 2, 3], undefined));
report(lastSum([], undefined));
report(lastSum([], 1.5));

function orNull(list: number[], start: number | null): string { let held = start; let turns = 0; for (const one of list) { held = held === null ? one * 1.5 : one > 2 ? null : held + one; turns++; } return held + ":" + turns; }
report(orNull([1, 2, 3, 4], null));
report(orNull([1, 2], 0.5));
report(orNull([], null));

function both(list: number[]): string { let low: number | undefined; let high: number | undefined; for (const one of list) { const half = one / 2; if (low === undefined || half < low) low = half; if (high === undefined || half > high) high = half; } return low + ":" + high; }
report(both([3, 1, 5]));
report(both([]));

function handedOn(list: (number | undefined)[]): unknown[] { const out: unknown[] = []; let last: number | undefined = 0.5; for (const one of list) { out.push(last); last = one; } out.push(last); return out; }
report(JSON.stringify(handedOn([1.5, undefined, NaN, -0])) + Object.is(handedOn([-0])[1], -0));
report("end");
