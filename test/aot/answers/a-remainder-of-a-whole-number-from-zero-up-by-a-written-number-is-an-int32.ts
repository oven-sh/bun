// answers: without-library
// # `let last = 42; last = (last * 3877 + 29573) % 139968`: Link holds of numbers that each is whole, finite and not below +0, or below 2^31 as well. The product of two below 2^31 is whole, finite and not below +0;
// # so is such a number plus one below 2^31, however often (from 2^85 on the sum is the number itself). Its remainder by a written whole number over 0 is an int32 from 0 up: never -0, never NaN.
// # So the variable is an integer and the whole line is integer arithmetic. The index of a ring and the remainder of a counter are so too.
// # Whatever breaks one link of that chain (a store of a negative number, of -0, of a fraction, of what nobody knows; a product or a sum that feeds itself; a divisor that is 0, below 0 or not written) leaves the number as it was: every answer is plain JavaScript's.
// # g0 = last, g1 = below, g2 = zero, g3 = part, g4 = any, g5 = squared, g6 = doubled, g7 = byZero, g8 = byMinus, g9 = byOther, g10 = other, g11 = edge, g12 = ring, g13 = counted, g14 = far, g15 = ofSquared, g16 = ofDoubled, g17 = ofFar: each holds a remainder, so that a false word on its dividend lays NaN in an integer; g18 = byHalf, g19 = byFraction: a written divisor that is no whole number; g21 = rounded: the rule holds, and the product passes 2^53: it is rounded to a double in front of the remainder, as plain JavaScript rounds it
// # By a written divisor from 2^31 to 2^32 the remainder is a whole number from 0 up below 2^32: g20 = byTwoTo31, g22 = wide (`% 4294967296`), g23 = squaredWide (its product passes 2^53). g24 = pastTwoTo32: a divisor over 2^32 says nothing.
// # RUN(HELD): link variables mechanisms=all
// # HELD: variable g0 proven=int[0, 2147483647]|absent
// # HELD-NOT: variable g1 proven=int[0, 2147483647]
// # HELD-NOT: variable g2 proven=int[0, 2147483647]
// # HELD-NOT: variable g3 proven=int[0, 2147483647]
// # HELD-NOT: variable g4 proven=int[0, 2147483647]
// # HELD-NOT: variable g5 proven=int[0, 2147483647]
// # HELD-NOT: variable g6 proven=int[0, 2147483647]
// # HELD-NOT: variable g7 proven=int[0, 2147483647]
// # HELD-NOT: variable g8 proven=int[0, 2147483647]
// # HELD-NOT: variable g9 proven=int[0, 2147483647]
// # HELD: variable g11 proven=int[0, 2147483647]|absent
// # HELD: variable g12 proven=int[0, 2147483647]|absent
// # HELD-NOT: variable g13 proven=int[0, 2147483647]
// # HELD-NOT: variable g14 proven=int[0, 2147483647]
// # HELD-NOT: variable g15 proven=int[0, 2147483647]
// # HELD-NOT: variable g16 proven=int[0, 2147483647]
// # HELD-NOT: variable g17 proven=int[0, 2147483647]
// # HELD-NOT: variable g18 proven=int[0, 2147483647]
// # HELD-NOT: variable g19 proven=int[0, 2147483647]
// # HELD: variable g20 proven=int[0, 4294967295]|absent
// # HELD: variable g21 proven=int[0, 2147483647]|absent
// # HELD: variable g22 proven=int[0, 4294967295]|absent
// # HELD: variable g23 proven=int[0, 4294967295]|absent
// # HELD-NOT: variable g24 proven=int[0,
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 132 of 132 of 132
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
let last = 42;
let below = 42;
let zero = 0;
let part = 42;
let any: any = 42;
let squared = 3;
let doubled = 1;
let byZero = 42;
let byMinus = 42;
let byOther = 42;
let other = 7;
let edge = 2147483647;
let ring = 0;
let counted = 0;
let far = 2147483647;
let ofSquared = 0;
let ofDoubled = 0;
let ofFar = 0;
let byHalf = 42;
let byFraction = 42;
let byTwoTo31 = 42;
let rounded = 1;
let wide = 42;
let squaredWide = 3;
let pastTwoTo32 = 42;
function tell(value: number) { report(Object.is(value, -0) ? "-0" : value); }
function next() { last = (last * 3877 + 29573) % 139968; return last / 139968; }
function nextBelow() { below = (below * 3877 + 29573) % 139968; return below; }
function nextZero() { zero = (zero * 3) % 5; return zero; }
function nextPart() { part = (part * 3 + 1) % 10; return part; }
function nextAny() { any = (any * 3 + 1) % 10; return any; }
function nextSquared() { squared = squared * squared; ofSquared = squared % 7; return ofSquared; }
function nextDoubled() { doubled = doubled + doubled; ofDoubled = doubled % 7; return ofDoubled; }
function nextByZero() { byZero = (byZero * 3 + 1) % 0; return byZero; }
function nextByMinus() { byMinus = (byMinus * 3 + 1) % -10; return byMinus; }
function nextByOther() { byOther = (byOther * 3 + 1) % other; return byOther; }
function nextEdge() { edge = (edge * 2147483647 + 2147483647) % 2147483647; return edge; }
function mixed(x: number) { return (x * 3 + 6) % 9; }
function nextByHalf() { byHalf = (byHalf * 3 + 1) % 0.5; return byHalf; }
function nextByFraction() { byFraction = (byFraction * 3 + 1) % 2.5; return byFraction; }
function nextByTwoTo31() { byTwoTo31 = (byTwoTo31 * 2147483647 + 2147483647) % 2147483648; return byTwoTo31; }
function nextRounded() { rounded = (rounded * 2147483629 + 2147483587) % 2147483647; return rounded; }
function nextWide() { wide = (wide * 1664525 + 1013904223) % 4294967296; return wide; }
function nextSquaredWide() { squaredWide = (squaredWide * squaredWide + 7) % 4294967296; return squaredWide; }
function nextPastTwoTo32() { pastTwoTo32 = (pastTwoTo32 * 1664525 + 1013904223) % 4294967297; return pastTwoTo32; }
function nextRing() { ring = (ring + 1) % 8; return ring; }
function nextCounted() { counted = counted + 1; return counted % 3; }
function nextFar() { far = far * 2147483647 + 2147483647; ofFar = far % 1000003; return ofFar; }
let sum = 0;
for (let i = 0; i < 1000; i++) sum += next();
report(sum);
report(last);
tell(nextBelow());
below = -139968;
tell(nextBelow());
below = -29573 / 3877;
tell(nextBelow());
tell(nextZero());
zero = -0;
tell(nextZero());
tell(nextZero());
tell(nextPart());
part = 0.5;
tell(nextPart());
tell(nextPart());
tell(nextAny());
any = "4";
tell(nextAny());
any = { valueOf() { return -7; } };
tell(nextAny());
any = undefined;
tell(nextAny());
for (let i = 0; i < 12; i++) tell(nextSquared());
let lastDoubled = 0;
for (let i = 0; i < 1100; i++) lastDoubled = nextDoubled();
tell(lastDoubled);
tell(doubled);
tell(nextByZero());
tell(nextByMinus());
tell(nextByOther());
other = 0;
tell(nextByOther());
other = -3;
byOther = -5;
tell(nextByOther());
tell(nextEdge());
tell(nextEdge());
tell(mixed(5));
tell(mixed(-2));
tell(mixed(-5));
let rings = "";
for (let i = 0; i < 20; i++) rings += nextRing();
report(rings);
let remainders = "";
for (let i = 0; i < 7; i++) remainders += nextCounted();
report(remainders);
for (let i = 0; i < 40; i++) tell(nextFar());
tell(far);
tell(nextByHalf());
tell(nextByFraction());
tell(nextByFraction());
for (let i = 0; i < 4; i++) tell(nextByTwoTo31());
for (let i = 0; i < 12; i++) tell(nextRounded());
for (let i = 0; i < 12; i++) tell(nextWide());
for (let i = 0; i < 12; i++) tell(nextSquaredWide());
for (let i = 0; i < 6; i++) tell(nextPastTwoTo32());
report("end");
